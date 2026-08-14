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
 * `EXPANSION.pdflib` in `lib/router/budget.ts` promises the router that this
 * engine peaks at three times its input, and a hundred documents is where that
 * promise gets tested. Two habits keep it: source files are read one at a time
 * rather than buffered up front, and each parsed document goes out of scope as
 * soon as its pages have been copied. Peak is then the merged document plus the
 * one source being read plus the serialised output — under 3× — instead of
 * every source alive at once, which 100 files would push far past it.
 */

import { EncryptedPDFError, PDFDocument, type PDFPage } from 'pdf-lib'

import type { PdfOperation } from './pdflib'
import type { EngineInput, ProgressCallback } from './types'

/**
 * The most documents one merge accepts.
 *
 * Not a pdf-lib limit — it is the number issue #38 promises, and the point past
 * which the merged object graph stops fitting the memory budget on a phone. A
 * job that names 300 files is a person who wants batches, and telling them so
 * beats an out-of-memory tab kill 200 files in.
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
  const bytes = await merged.save()

  // A merge that finished after the user cancelled must still deliver nothing:
  // `lib/worker/types.ts` guarantees a cancelled job never produces output.
  throwIfAborted(signal)
  onProgress(1)

  // `save()` is typed as a `Uint8Array` over any buffer kind, which `BlobPart`
  // no longer accepts now that TypeScript separates shared from non-shared
  // buffers. pdf-lib allocates a plain `ArrayBuffer`, so this narrows rather
  // than converts — and narrowing beats copying through `new Uint8Array(bytes)`,
  // which would duplicate the whole merged document at its peak.
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
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
      `Merging needs at least two PDFs, but ${given}. Add another PDF to the list and try again.`,
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
 * Left alone, a truncated download surfaces as `Cannot read properties of
 * undefined (reading 'Pages')` — thrown not by `load` but by the first read of
 * the page tree — with no indication of which of a hundred files caused it.
 * Both calls therefore sit inside one guard, and CLAUDE.md §2.5 asks the same
 * of an engine as of the router: say what is wrong, and say what to do next.
 *
 * The source document is deliberately local. Once its pages have been deep
 * copied into `merged`, nothing else needs it, and letting it fall out of scope
 * here is what stops a hundred parsed documents accumulating.
 */
async function copyPagesFrom(
  merged: PDFDocument,
  bytes: Uint8Array,
  described: string,
): Promise<PDFPage[]> {
  try {
    // `ignoreEncryption` stays off: pdf-lib cannot decrypt, and ignoring the
    // flag would merge unreadable streams into a document that opens as noise.
    const source = await PDFDocument.load(bytes)

    return await merged.copyPages(source, source.getPageIndices())
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new Error(
        `${described} is password-protected, and merging cannot read an encrypted PDF. ` +
          `Remove its password in a PDF reader first, then merge.`,
      )
    }

    throw new Error(
      `${described} could not be read as a PDF — the file looks damaged or incomplete. ` +
        `Open it in a PDF reader to check it, or remove it from the list.`,
    )
  }
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
  const name = (files[index] as { name?: unknown }).name

  return typeof name === 'string' && name.length > 0
    ? `"${name}" (${position})`
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
