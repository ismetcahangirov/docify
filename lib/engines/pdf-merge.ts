/**
 * Merging: many PDFs in, one PDF out, in the order the user put them.
 *
 * ## Why it is its own module
 *
 * `pdflib.ts` reaches every operation through `await import()`, so this file and
 * the half megabyte of pdf-lib it pulls in exist only for a job that actually
 * merges. A static import anywhere above this line would put the library in the
 * initial bundle and break CLAUDE.md §2.3.
 *
 * ## Order
 *
 * `EngineInput.files` is the user's order and is copied verbatim. Nothing here
 * sorts, dedupes or reasons about file names — the list is the instruction, and
 * rearranging it is the drag-to-reorder UI's job (EPIC 7), not this engine's.
 *
 * ## Memory
 *
 * `EXPANSION.pdflib` in `lib/router/budget.ts` budgets three times the input,
 * and a hundred documents is where that gets tested. What this module can
 * guarantee is the part it controls: sources are read one at a time rather than
 * buffered up front, and each parsed document is unreachable again as soon as
 * its pages have been copied, so the hundred never coexist. What is still live
 * at the peak — the merged object graph, the serialised output, and the Blob's
 * copy of it — has not been measured against the 3× factor on a real corpus.
 * The file count below is the only ceiling merge enforces today.
 *
 * ## What does not survive the copy
 *
 * `copyPages` brings each page and the annotations drawn on it, but not the
 * document-level `AcroForm`. A filled-in form therefore arrives looking right
 * and behaving as flat artwork, with no fields and no values behind it. Merging
 * form documents means merging the field tree too, name collisions and all,
 * which is a feature of its own rather than a line in this one.
 */

import { PDFDocument, type PDFPage } from 'pdf-lib'

import { openPdf } from './pdf-open'
import type { PdfOperation } from './pdflib'
import type { EngineInput, ProgressCallback } from './types'

/**
 * The most documents one merge accepts.
 *
 * The number issue #38 promises, and — since `route()` budgets one scalar input
 * size and has no multi-file caller yet — the only ceiling merge has. It counts
 * files rather than bytes, so it guards the runaway case (someone who selected
 * a directory) rather than memory: a hundred 50 MB scans will still exhaust a
 * phone. A job naming 300 files is a person who wants batches, and telling them
 * so beats an out-of-memory tab kill 200 files in.
 */
export const MAX_MERGE_FILES = 100

/** Below this, "merge" has nothing to do. */
const MIN_MERGE_FILES = 2

/**
 * How much of the progress bar the copy phase owns, leaving the rest for
 * serialisation.
 *
 * A reservation rather than a measurement: writing the merged document is one
 * more pass over everything that was copied, and a bar parked at 100% for the
 * length of it looks like a hang.
 */
const COPY_SHARE = 0.9

/** Reporting interval for the serialisation phase, inside the 250 ms rule. */
const SAVE_TICK_MS = 200

/**
 * How quickly the serialisation estimate approaches the end of its band. Chosen
 * so a merge that writes for a few seconds spends most of them visibly moving.
 */
const SAVE_PACE_MS = 3000

/**
 * How far into a file the PDF header may sit.
 *
 * `%PDF-` is meant to be the first thing in the file, but the specification
 * tolerates junk before it and every reader — pdf-lib included — scans for it.
 * A check pinned to offset zero would reject files that open everywhere else,
 * so it scans the same window readers do.
 */
const HEADER_SCAN_BYTES = 1024

const PDF_HEADER = '%PDF-'

export const mergePdfs: PdfOperation = async (
  input: EngineInput,
  signal: AbortSignal,
  onProgress: ProgressCallback,
): Promise<Blob> => {
  throwIfAborted(signal)
  await assertMergeable(input.files, signal)

  const merged = await PDFDocument.create()
  onProgress(0)

  for (const [index, file] of input.files.entries()) {
    throwIfAborted(signal)

    // Scoped to the iteration on purpose: the bytes and the parsed document are
    // unreachable the moment the next file starts, which is what keeps a
    // hundred-file merge inside the budget.
    const bytes = new Uint8Array(await file.arrayBuffer())
    await append(merged, bytes, describe(input.files, index))

    onProgress(((index + 1) / input.files.length) * COPY_SHARE)
    await yieldToMessageLoop()
  }

  throwIfAborted(signal)
  const bytes = await serialise(merged, onProgress)

  // A merge that finished after the user cancelled must still deliver nothing:
  // `lib/worker/types.ts` guarantees a cancelled job never produces output.
  throwIfAborted(signal)
  onProgress(1)

  // `save()` is typed as a `Uint8Array` over any buffer kind, which `BlobPart`
  // no longer accepts now that TypeScript separates shared from non-shared
  // buffers. pdf-lib allocates a plain `ArrayBuffer`, so the assertion states a
  // fact rather than converting one; `new Uint8Array(bytes)` would say the same
  // thing by copying the whole merged document first.
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}

/**
 * Writes the merged document out, keeping the bar alive while it happens.
 *
 * This is the one phase with no fraction to report: pdf-lib offers no hook into
 * `save`, and what it walks is an object graph whose size has little to do with
 * the page count already reported. On a hundred merged documents it is seconds
 * of silence, which is exactly what the 250 ms rule in `./types` forbids.
 *
 * It does yield between object batches, though — which is what makes a timer
 * possible at all — so the reserved band is driven by elapsed time, approaching
 * its end without ever arriving. Only the finished file gets to report 1.
 */
async function serialise(merged: PDFDocument, onProgress: ProgressCallback): Promise<Uint8Array> {
  const started = Date.now()
  const ticker = setInterval(() => {
    const elapsed = (Date.now() - started) / SAVE_PACE_MS

    onProgress(COPY_SHARE + (1 - COPY_SHARE) * (1 - Math.exp(-elapsed)))
  }, SAVE_TICK_MS)

  try {
    return await merged.save()
  } finally {
    clearInterval(ticker)
  }
}

/**
 * Checks the whole job before any of it runs.
 *
 * Sniffing every file's header costs one kilobyte per file and turns the most
 * common mistake — a stray image in a list of ninety PDFs — from a failure two
 * minutes in into a failure immediately. A corrupt *body* still cannot be found
 * without parsing, so this narrows the window rather than closing it.
 */
async function assertMergeable(files: readonly Blob[], signal: AbortSignal): Promise<void> {
  if (files.length < MIN_MERGE_FILES) {
    const given = files.length === 0 ? 'no files were given' : 'only 1 file was given'

    throw new Error(
      `Merging needs at least ${MIN_MERGE_FILES} PDFs, but ${given}. ` +
        `Add another PDF to the list and try again.`,
    )
  }

  if (files.length > MAX_MERGE_FILES) {
    throw new Error(
      `Merging handles up to ${MAX_MERGE_FILES} PDFs at a time, but ${files.length} files were ` +
        `given. Merge them in batches of ${MAX_MERGE_FILES}, then merge those results together.`,
    )
  }

  for (const [index, file] of files.entries()) {
    throwIfAborted(signal)

    if (!(await looksLikePdf(file))) {
      throw new Error(
        `${describe(files, index)} is not a PDF, so it cannot be merged into one. ` +
          `Convert it to PDF first, or remove it from the list.`,
      )
    }
  }
}

/** Whether the head of `file` carries a PDF header. */
async function looksLikePdf(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, HEADER_SCAN_BYTES).arrayBuffer())

  // Latin-1 rather than UTF-8: the header is ASCII, and decoding arbitrary
  // binary as UTF-8 replaces invalid sequences in ways that could invent or
  // destroy the match.
  return new TextDecoder('latin1').decode(head).includes(PDF_HEADER)
}

/** Copies every page of one source document onto the end of `merged`. */
async function append(merged: PDFDocument, bytes: Uint8Array, described: string): Promise<void> {
  const pages = await copyPagesFrom(merged, bytes, described)

  if (pages.length === 0) {
    // A PDF with no pages is either damaged or the output of something that
    // went wrong upstream. Merging it contributes nothing, so a silent skip
    // would hand back a document quietly missing a chapter.
    throw new Error(
      `${described} contains no pages, so there is nothing to merge from it. ` +
        `Remove it from the list and try again.`,
    )
  }

  for (const page of pages) merged.addPage(page)
}

/**
 * Parses one source document and lifts its pages out, translating pdf-lib's
 * failures into something a person can act on.
 *
 * The copy is the structural read `openPdf` closes its guard around: left alone,
 * a truncated download surfaces as `Cannot read properties of undefined (reading
 * 'Pages')` — thrown not by `load` but by the first read of the page tree — with
 * no indication of which of a hundred files caused it. Naming the file is what
 * merge adds over the other operations, and CLAUDE.md §2.5 asks the same of an
 * engine as of the router: say what is wrong, and say what to do next.
 *
 * pdf-lib's own parser message is dropped rather than quoted here, unlike in
 * split and organize: a merge failure already carries a file name and a
 * position, and "Expected instance of PDFDict" after them buys the user nothing
 * they can act on.
 *
 * The source document is deliberately local to the read. Once its pages have
 * been deep copied into `merged`, nothing else needs it, and letting it fall out
 * of scope here is what stops a hundred parsed documents accumulating.
 */
function copyPagesFrom(
  merged: PDFDocument,
  bytes: Uint8Array,
  described: string,
): Promise<PDFPage[]> {
  return openPdf(bytes, {
    // `ignoreEncryption` stays off — the default: pdf-lib cannot decrypt, and
    // ignoring the flag would merge unreadable streams into a document that
    // opens as noise.
    read: (source) => merged.copyPages(source, source.getPageIndices()),
    encrypted:
      `${described} is password-protected, and merging cannot read an encrypted PDF. ` +
      `Remove its password in a PDF reader first, then merge.`,
    damaged: () =>
      `${described} could not be read as a PDF — the file looks damaged or incomplete. ` +
      `Open it in a PDF reader to check it, or remove it from the list.`,
  })
}

/**
 * How to refer to one of the input files in an error message.
 *
 * The worker is handed `Blob`s; only those that came straight from a file
 * picker are `File`s carrying a name. Position is the fallback, and it is
 * always included — with a hundred files in a list, "holiday.png" alone is not
 * enough to find the one that is wrong.
 */
function describe(files: readonly Blob[], index: number): string {
  const position = `file ${index + 1} of ${files.length}`
  const file = files[index]

  return file instanceof File && file.name.length > 0
    ? `"${file.name}" (${position})`
    : position.charAt(0).toUpperCase() + position.slice(1)
}

/**
 * Hands the thread back long enough for a queued message to be delivered.
 *
 * Cancellation reaches a running job as a `cancel(jobId)` call on the worker's
 * message loop — see the cancellation notes in `lib/worker/types.ts`. Awaiting
 * promises alone drains the microtask queue without ever letting that message
 * land, so a hundred-file merge would run to completion with `signal.aborted`
 * still false. A timer is what actually yields to the loop; a millisecond per
 * file is the price of a cancel button that works.
 */
function yieldToMessageLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The conversion was cancelled.', 'AbortError')
}
