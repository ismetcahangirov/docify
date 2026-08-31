/**
 * `split`: one PDF in, one document per requested span out.
 *
 * ## Two modes, one code path
 *
 * `every-page` is not a separate algorithm — it is the span list
 * `1-1, 2-2, 3-3`. Expressing it that way means the naming, the progress
 * accounting, the cancellation checks and the single-document rule are written
 * once and cannot drift between the two modes.
 *
 * Spans come from `./pdf-pages`, which deliberately keeps the order and the
 * overlaps the user wrote. That is exactly what split wants and the opposite of
 * what rendering wants: `"3, 1-2, 3"` is three documents, in that sequence,
 * with page 3 in two of them.
 *
 * ## What comes back
 *
 * A ZIP when there are several documents, and the PDF itself when there is one.
 * The alternative — always an archive — is uniform in the code and worse in the
 * hand: a one-entry ZIP makes the user save it, find it, unpack it and only
 * then open the file they asked for, and it prevents nothing, because with a
 * single output there is no second file to keep apart from it. The download
 * layer already distinguishes the two by MIME type, since merge answers with a
 * PDF and rendering answers with an archive.
 *
 * ## Loading
 *
 * pdf-lib is imported statically *here* and nowhere that a page or the worker
 * entry can reach: this module exists only at the far end of the
 * `await import('./pdf-split')` in `./pdflib` (CLAUDE.md §2.3).
 */

import { throwIfAborted } from '@/lib/abort'
import { PDFDocument } from 'pdf-lib'

import { openPdf } from './pdf-open'
import { type PageSpan, parsePageSpans } from './pdf-pages'
import type { PdfSplitOptions } from './pdf-options'
import type { PdfOperation } from './pdflib'
import type { EngineInput } from './types'
import { toZip, uniqueEntryName, type ZipEntry } from './zip-output'

export const splitPdf: PdfOperation = async (input, signal, onProgress) => {
  throwIfAborted(signal)

  // Honest rather than decorative: pdf-lib parses the whole object tree in one
  // synchronous pass with no callback, and how many documents will come out is
  // not known until that pass and the range parse are both done.
  onProgress(-1)

  const { source, pageCount } = await open(onlyFile(input))
  throwIfAborted(signal)

  const spans = spansFor(input.pdf?.split, pageCount)
  const digits = String(pageCount).length

  const taken = new Set<string>()
  const entries: ZipEntry[] = []

  for (const [index, span] of spans.entries()) {
    // Between documents is the only place this loop can be interrupted: a
    // single `copyPages` plus `save` is synchronous inside pdf-lib.
    throwIfAborted(signal)
    onProgress(index / spans.length)

    const name = uniqueEntryName(entryName(span, digits), taken)
    taken.add(name)
    entries.push({ name, bytes: await extract(source, span) })
  }

  throwIfAborted(signal)

  const result = entries.length === 1 ? pdfBlob(entries[0].bytes) : toZip(entries)

  // Packing is the last real work, so this is the first moment the job is done.
  onProgress(1)

  return result
}

/**
 * The spans this job asks for, as 1-based page numbers.
 *
 * The default is `every-page` rather than an error, because `EngineInput.pdf`
 * is optional all the way down and "split this document" has to mean something
 * on its own — one document per page is the only reading that needs nothing
 * further from the user.
 */
function spansFor(options: PdfSplitOptions | undefined, pageCount: number): PageSpan[] {
  const mode = options?.mode ?? (options?.ranges === undefined ? 'every-page' : 'ranges')

  if (mode === 'every-page') {
    if (pageCount < 1) {
      // `toZip` would otherwise refuse the empty result with a message written
      // for a caller with a bug, not for a user holding an unusual file.
      throw new Error('This PDF has no pages, so there is nothing to split out of it.')
    }

    return Array.from({ length: pageCount }, (_, index) => ({ from: index + 1, to: index + 1 }))
  }

  if (options?.ranges === undefined) {
    throw new Error(
      'Splitting by range needs the range: name the pages to keep, such as "1-3, 7", ' +
        'or split the document into single pages instead.',
    )
  }

  return parsePageSpans(options.ranges, pageCount)
}

/** One output document holding the pages of `span`, in order. */
async function extract(source: PDFDocument, span: PageSpan): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const indices = Array.from(
    { length: span.to - span.from + 1 },
    (_, offset) => span.from - 1 + offset,
  )

  // `copyPages` deep-copies the page and everything it references — fonts,
  // images, annotations — into the new document. Adding the source's own page
  // objects instead would produce a file that renders only while the original
  // is still in memory.
  for (const page of await document.copyPages(source, indices)) document.addPage(page)

  return document.save()
}

/**
 * The parsed document and its page count.
 *
 * The count is read inside `openPdf`'s guard rather than after it because
 * `PDFDocument.load` defers a bad catalog to the first structural read — see
 * `./pdf-open` for why that guard exists at all. Both values come out of the one
 * read, so nothing parses the page tree twice.
 */
async function open(file: Blob): Promise<{ source: PDFDocument; pageCount: number }> {
  return openPdf(new Uint8Array(await file.arrayBuffer()), {
    read: (source) => ({ source, pageCount: source.getPageCount() }),
    encrypted:
      'This PDF is password-protected, so its pages cannot be read. Remove the ' +
      'password where the file was created, then split the unprotected copy.',
    // The parser message is kept, after a sentence that says what it is about:
    // "Expected instance of PDFDict" alone tells the user nothing, but it is
    // what distinguishes a truncated download from a file that is not a PDF.
    damaged: (detail) => `This file could not be read as a PDF: ${detail}`,
  })
}

/**
 * The lone output document, as a downloadable blob.
 *
 * The re-wrap is not decorative. pdf-lib types `save()` as a bare `Uint8Array`,
 * which since TypeScript 5.7 means "over any buffer, `SharedArrayBuffer`
 * included", while `BlobPart` accepts only a view over a plain `ArrayBuffer`.
 * fflate declares the narrower type and needs none of this, which is why the
 * archive path above is a straight pass-through.
 */
function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
}

/**
 * `page-7.pdf` or `pages-2-6.pdf`, zero-padded to the width of the last page.
 *
 * The padding is what makes a 12-page split readable: unpadded, `page-10.pdf`
 * sorts between `page-1.pdf` and `page-2.pdf` in every file browser that orders
 * names lexically, which is most of them.
 */
function entryName(span: PageSpan, digits: number): string {
  const from = String(span.from).padStart(digits, '0')

  if (span.from === span.to) return `page-${from}.pdf`

  return `pages-${from}-${String(span.to).padStart(digits, '0')}.pdf`
}

/**
 * The single source document, or an error naming what arrived instead.
 *
 * `EngineInput.files` is a list because merging needs one; splitting is the
 * other direction and takes exactly one file, so the constraint lives here.
 */
function onlyFile(input: EngineInput): Blob {
  if (input.files.length !== 1) {
    throw new Error(
      `Splitting works on one document at a time, but was given ${input.files.length} files. ` +
        'Merge them first if they belong together.',
    )
  }

  return input.files[0]
}
