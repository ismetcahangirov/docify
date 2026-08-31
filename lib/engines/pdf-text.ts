/**
 * PDF to plain text.
 *
 * ## What it is, and what it is not
 *
 * It gives you the words. It does not give you the document: headings stop being
 * headings, tables stop being tables, images and figures are simply absent, and
 * a two-column layout comes out with its columns interleaved. That is not a
 * shortcoming of this implementation but of the target format — a `.txt` has
 * nowhere to put any of it — and the router says so up front with the
 * `LAYOUT_LOSS` warning rather than letting the user find out from the file.
 *
 * A scanned document produces *nothing*, correctly: its pages are photographs of
 * text and carry no text objects at all. That case is detected and explained
 * rather than delivered as an empty file, because "your converter is broken" and
 * "your PDF is a photograph" look identical from the download folder.
 *
 * ## Why it is here and not in pdf-lib
 *
 * Reading text needs the font machinery — encodings, `ToUnicode` maps,
 * ligatures, the difference between a glyph and a character — which is exactly
 * what pdf.js has and pdf-lib does not. The layout half is separate again, in
 * `./pdf-text-layout`, because turning positioned runs back into lines is pure
 * arithmetic that deserves to be tested without a 1.8 MB download in the room.
 */

import { throwIfAborted } from '@/lib/abort'

import { layoutText, type PdfTextItem } from './pdf-text-layout'
import { selectedPages } from './pdf-render-plan'
import { loadPdfDocument, type PdfLoader } from './pdfjs-runtime'
import type { EngineInput, ProgressCallback } from './types'

/**
 * What separates one page's text from the next.
 *
 * A form feed, which is what `pdftotext` has written since 1996: invisible in
 * every editor, ignored by every tool that reads the file as words, and the one
 * character that lets a reader who cares about page boundaries find them again.
 */
export const PAGE_SEPARATOR = '\f'

/** The seam a test uses instead of loading pdf.js. */
export interface PdfTextDependencies {
  load?: PdfLoader
}

/**
 * Extracts the text of `input`'s single PDF.
 *
 * Signature-compatible with `PdfOperation` in `./pdflib.ts`, like
 * `./pdf-render`, so the engine calls it without knowing the seam exists.
 */
export async function extractPdfText(
  input: EngineInput,
  signal: AbortSignal,
  onProgress: ProgressCallback,
  dependencies: PdfTextDependencies = {},
): Promise<Blob> {
  const { load = loadPdfDocument } = dependencies

  throwIfAborted(signal)

  const source = onlyFile(input)

  // Parsing reports nothing until it is finished, and on a large document that
  // is several seconds. Indeterminate is the honest state until there is a page
  // count to divide by.
  onProgress(-1)

  const data = new Uint8Array(await source.arrayBuffer())
  throwIfAborted(signal)

  const task = await load(data)

  try {
    const document = await task.promise
    throwIfAborted(signal)

    const pages = selectedPages(input.pdf?.text, document.numPages)
    onProgress(0)

    const extracted: string[] = []

    for (const [index, pageIndex] of pages.entries()) {
      throwIfAborted(signal)

      const page = await document.getPage(pageIndex + 1)
      try {
        const content = await page.getTextContent()
        extracted.push(layoutText(content.items as readonly PdfTextItem[]))
      } finally {
        // The operator list and font references of a page already read are dead
        // weight; a two hundred page document holds all of them otherwise.
        page.cleanup()
      }

      onProgress((index + 1) / pages.length)
    }

    const text = extracted.join(`\n${PAGE_SEPARATOR}\n`)
    if (text.trim().length === 0) throw noTextFound(pages.length)

    throwIfAborted(signal)
    onProgress(1)

    // `text/plain` rather than a bare octet stream so the browser opens it in a
    // tab instead of insisting on a download the user then has to name.
    return new Blob([text], { type: 'text/plain;charset=utf-8' })
  } finally {
    await task.destroy()
  }
}

/**
 * The explanation for a document that yielded nothing.
 *
 * Almost always a scan: a photograph of a page has no text objects, only pixels.
 * Delivering an empty `.txt` would be technically correct and useless — the user
 * cannot tell it apart from a broken converter — so this names the likely cause
 * and the tool that actually solves it.
 */
function noTextFound(pageCount: number): Error {
  return new Error(
    `No text could be read from ${pageCount === 1 ? 'this page' : `these ${pageCount} pages`}. ` +
      'The document is most likely a scan — a picture of a page rather than text — and ' +
      'recovering words from a picture needs optical character recognition, which this tool ' +
      'does not do. Converting the pages to images instead will at least keep them readable.',
  )
}

function onlyFile(input: EngineInput): Blob {
  if (input.files.length !== 1) {
    throw new Error(
      `Text extraction reads one document at a time, but ${input.files.length} were given.`,
    )
  }

  return input.files[0]
}
