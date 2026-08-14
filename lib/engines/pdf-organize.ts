/**
 * `organize` and `rotate`: reordering, rotating and deleting the pages of one
 * PDF, with pdf-lib.
 *
 * ## One implementation for two operations
 *
 * `rotate` is `organize` with nothing but the rotation map filled in, so both
 * arms of `loadOperation` land here and neither gets its own defaults. Giving
 * them different behaviour would turn the operation label into a hidden input:
 * the same settings would produce two different documents depending on which
 * page the user happened to arrive from, and nothing in the UI would explain the
 * difference.
 *
 * ## Deletion is absence
 *
 * `order` lists the pages to keep, in output order. There is no delete list,
 * because two lists can contradict each other and something would then have to
 * decide which one wins. A page the user removed from the thumbnail grid is
 * simply a page that is no longer in `order`.
 *
 * ## Two ways to produce the result, chosen from the data
 *
 * When every source page survives, the loaded document is edited in place. Its
 * outlines, annotations, form fields and metadata all point at page objects that
 * keep their identity, so they keep working, and no page is copied — which
 * matters on the 200 MB scan that motivates `EXPANSION.pdflib`.
 *
 * When a page is dropped, the result is rebuilt into a fresh document instead.
 * pdf-lib's page-tree removal unlinks a page but never collects it: an in-place
 * delete leaves every dropped page in the file and writes it back out, so a user
 * who removes 29 pages of 30 gets a file the size of the one they started with.
 * Copying only the survivors is the only way to actually drop them, and it costs
 * the document-level structures that a deletion would have left dangling anyway.
 */

import { degrees, PDFDocument, type PDFPage } from 'pdf-lib'

import { type OrganizePlan, planOrganize, QUARTER_TURNS } from './pdf-organize-plan'
import type { PageRotation } from './pdf-options'
import type { PdfOperation } from './pdflib'
import type { EngineInput, ProgressCallback } from './types'

export const organizePages: PdfOperation = async (input, signal, onProgress) => {
  throwIfAborted(signal)

  const file = onlyFile(input)

  // Parsing is one opaque pdf-lib call with no callback to hang a percentage on,
  // so indeterminate is the honest opening state. Real ticks start once there is
  // a page count to divide by.
  onProgress(-1)

  const { source, pageCount } = await open(file)
  throwIfAborted(signal)

  const plan = planOrganize(input.pdf?.organize ?? {}, pageCount)

  const document =
    plan.order.length === pageCount
      ? reorderInPlace(source, plan.order)
      : await keepOnly(source, plan.order)

  applyRotations(document, plan, signal, onProgress)

  const saved = await document.save()
  throwIfAborted(signal)
  onProgress(1)

  // pdf-lib types its output as a view over any `ArrayBufferLike`, while `Blob`
  // accepts only a view over a plain `ArrayBuffer`. The buffer is freshly
  // allocated by pdf-lib and never shared, so narrowing the declaration beats
  // copying tens of megabytes to satisfy it.
  return new Blob([saved as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}

/**
 * The parsed document and its page count.
 *
 * The count is read inside the guard rather than by the caller because
 * `PDFDocument.load` is lenient: handed bytes with no usable catalog it resolves
 * happily and defers the failure to the first structural read, which surfaces as
 * a bare `Cannot read properties of undefined`. Touching the page tree here is
 * what makes "can this file be opened at all" an answered question.
 *
 * `updateMetadata: false` because most of this operation edits the loaded
 * document in place: pdf-lib would otherwise stamp its own producer and
 * modification date onto a file the user only asked to turn a page of.
 */
async function open(file: Blob): Promise<{ source: PDFDocument; pageCount: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer())

  try {
    const source = await PDFDocument.load(bytes, { updateMetadata: false })

    return { source, pageCount: source.getPageCount() }
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : String(reason)

    if (/encrypt/i.test(detail)) {
      throw new Error(
        'This PDF is password-protected, so its pages cannot be rearranged. Remove ' +
          'the password where the file was created, then organise the unprotected copy.',
      )
    }

    // The parser message is kept, after a sentence that says what it is about:
    // "Expected instance of PDFDict" alone tells the user nothing, but it is
    // what distinguishes a truncated download from a file that is not a PDF.
    throw new Error(`This file could not be read as a PDF: ${detail}`)
  }
}

/**
 * Turns each page and reports one tick per page — the only part of the job whose
 * cost scales with something the caller can be told about.
 */
function applyRotations(
  document: PDFDocument,
  plan: OrganizePlan,
  signal: AbortSignal,
  onProgress: ProgressCallback,
): void {
  const pages = document.getPages()

  for (let index = 0; index < pages.length; index += 1) {
    throwIfAborted(signal)

    // `rotations` is keyed by source page and `order[index]` is the source page
    // that ended up here, which is what keeps a rotation attached to the
    // thumbnail the user turned rather than to a position in the output.
    const source = plan.order[index]
    const turn = plan.rotations.get(source)
    if (turn !== undefined && turn !== 0) turnPage(pages[index], source, turn)

    onProgress((index + 1) / pages.length)
  }
}

/**
 * Reorders the loaded document without copying anything.
 *
 * Emptying the page tree and refilling it looks heavy-handed, but pdf-lib offers
 * no move: `addPage` accepts a page that already belongs to the document, and
 * removing from the back keeps every remaining index where it was. Page objects
 * keep their identity throughout, so outline entries and annotations pointing at
 * them survive the shuffle.
 */
function reorderInPlace(document: PDFDocument, order: readonly number[]): PDFDocument {
  const pages = document.getPages()

  // The overwhelmingly common case — a rotate-only job — touches the tree not at
  // all.
  if (order.every((page, index) => page === index + 1)) return document

  const kept = order.map((page) => pages[page - 1])

  for (let index = pages.length - 1; index >= 0; index -= 1) document.removePage(index)
  for (const page of kept) document.addPage(page)

  return document
}

/**
 * Rebuilds the document from the surviving pages only. See the module header for
 * why a deletion cannot be done in place.
 */
async function keepOnly(source: PDFDocument, order: readonly number[]): Promise<PDFDocument> {
  const document = await PDFDocument.create({ updateMetadata: false })
  const copied = await document.copyPages(
    source,
    order.map((page) => page - 1),
  )

  for (const page of copied) document.addPage(page)
  carryMetadata(source, document)

  return document
}

/**
 * Carries the document-level metadata across a rebuild.
 *
 * A fresh document starts blank, so without this a user who deleted one page
 * would also lose the title and author of the file they deleted it from. The
 * fields are the ones pdf-lib's own `copy()` carries; the modification date is
 * deliberately not among them, because the document genuinely was modified.
 */
function carryMetadata(from: PDFDocument, to: PDFDocument): void {
  const title = from.getTitle()
  if (title !== undefined) to.setTitle(title)

  const author = from.getAuthor()
  if (author !== undefined) to.setAuthor(author)

  const subject = from.getSubject()
  if (subject !== undefined) to.setSubject(subject)

  const creator = from.getCreator()
  if (creator !== undefined) to.setCreator(creator)

  const producer = from.getProducer()
  if (producer !== undefined) to.setProducer(producer)

  const created = from.getCreationDate()
  if (created !== undefined) to.setCreationDate(created)
}

/**
 * Turns one page, on top of whatever rotation it already carried.
 *
 * Additive rather than absolute because the user is looking at a thumbnail: a
 * sideways scan already sits at 90°, and one more nudge has to land at 180. An
 * absolute set would leave it exactly where it was and look like a dead button.
 */
function turnPage(page: PDFPage, sourcePage: number, turn: PageRotation): void {
  const existing = page.getRotation().angle

  // Normalised into `0..270`: producers write `-90` freely, users can add past a
  // full turn, and pdf-lib refuses to write either.
  const total = (((existing + turn) % 360) + 360) % 360

  if (!QUARTER_TURNS.has(total)) {
    // Only reachable from a source page whose `/Rotate` was already out of spec.
    // Snapping it to the nearest quarter turn would move content the user never
    // asked to move, and would do it invisibly.
    throw new Error(
      `Page ${sourcePage} already carries a rotation of ${existing}°, which is not a ` +
        'quarter turn. Repair the PDF in the tool that produced it before rotating it here.',
    )
  }

  page.setRotation(degrees(total))
}

/**
 * Exactly one document, or an error saying how many arrived.
 *
 * `EngineInput.files` is a list because `merge` needs one, so a single-document
 * operation has to enforce the count itself.
 */
function onlyFile(input: EngineInput): Blob {
  if (input.files.length !== 1) {
    throw new Error(
      `Organising pages works on one document at a time, but was given ${input.files.length} files.`,
    )
  }

  return input.files[0]
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The conversion was cancelled.', 'AbortError')
}
