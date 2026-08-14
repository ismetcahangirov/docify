/**
 * PDF pages to JPG or PNG, one image per page.
 *
 * ## What comes out
 *
 * One page in the selection yields that image directly; two or more yield a ZIP
 * (`./zip-output`). The asymmetry is deliberate. `EngineRunner.run` answers with
 * a single `Blob` and the browser downloads it under one name, so a multi-page
 * job has nowhere else to go — but handing someone who converted a one-page
 * invoice a ZIP containing one JPG is a step they have to undo before they can
 * use the file.
 *
 * ## Memory
 *
 * Pages are rendered one at a time and each canvas is released the moment its
 * bytes exist, so the live set is one page's pixels rather than the document's.
 * The encoded images do accumulate — `zipSync` needs them all at once — but a
 * JPEG is a fraction of the RGBA buffer it came from, which is why a two hundred
 * page render stays flat rather than climbing.
 *
 * ## Where the seams are
 *
 * `load` and `createCanvas` are parameters with real defaults. pdf.js needs a
 * browser and `OffscreenCanvas` needs a worker; neither exists in a unit test,
 * and neither is what the logic here is about.
 */

import type { EngineInput, ProgressCallback } from './types'
import {
  canvasSize,
  encodingFor,
  type PageEncoding,
  pageEntryName,
  renderDpi,
  renderScale,
  selectedPages,
} from './pdf-render-plan'
import {
  createOffscreenCanvas,
  loadPdfDocument,
  type PdfDocument,
  type PdfLoader,
  releaseCanvas,
  type RenderCanvasFactory,
} from './pdfjs-runtime'
import { toZip, uniqueEntryName, type ZipEntry } from './zip-output'

/** The two heavy things this module needs, so a test can supply neither. */
export interface PdfRenderDependencies {
  load?: PdfLoader
  createCanvas?: RenderCanvasFactory
}

/**
 * Renders the selected pages of `input`'s single PDF.
 *
 * Signature-compatible with `PdfOperation` in `./pdflib.ts` — the dependencies
 * are a fourth, optional parameter — so the engine can call it without knowing
 * that the seams exist.
 */
export async function renderPdfPages(
  input: EngineInput,
  signal: AbortSignal,
  onProgress: ProgressCallback,
  dependencies: PdfRenderDependencies = {},
): Promise<Blob> {
  const { load = loadPdfDocument, createCanvas = createOffscreenCanvas } = dependencies

  throwIfAborted(signal)

  const source = onlyFile(input)
  const options = input.pdf?.render

  // Both validate, and both are cheap. Doing them before the file is even read
  // means a bad resolution or an unwritable target fails in microseconds.
  const dpi = renderDpi(options)
  const encoding = encodingFor(input.task.to, options)

  // Parsing a PDF reports nothing until it is finished, and on a large document
  // that is several seconds. Indeterminate is the honest state until there is a
  // page count to divide by.
  onProgress(-1)

  const data = new Uint8Array(await source.arrayBuffer())
  throwIfAborted(signal)

  const task = await load(data)

  try {
    const document = await task.promise
    throwIfAborted(signal)

    const pages = selectedPages(options, document.numPages)
    const context: RenderContext = {
      dpi,
      scale: renderScale(options),
      encoding,
      createCanvas,
      signal,
      onProgress,
    }

    onProgress(0)

    if (pages.length === 1) {
      const image = await renderPage(document, pages[0] + 1, context)
      onProgress(1)

      return image
    }

    return toZip(await renderAll(document, pages, context))
  } finally {
    // Releases the parsed document and its font cache on both sides of pdf.js's
    // message handler. Skipping it on the error path is how a failed conversion
    // leaves a document's worth of objects alive until the tab closes.
    await task.destroy()
  }
}

interface RenderContext {
  /** Carried only so an oversized page can name the number the user chose. */
  dpi: number
  /** The same resolution as pdf.js wants it, against PDF user space. */
  scale: number
  encoding: PageEncoding
  createCanvas: RenderCanvasFactory
  signal: AbortSignal
  onProgress: ProgressCallback
}

/**
 * Renders `pages` in order as archive entries, reporting after each.
 *
 * Progress is per page, which is as fine-grained as pdf.js allows: a render task
 * reports only that it finished. A single very large page therefore sits at one
 * value for as long as it takes, and there is nothing honest to report in the
 * meantime.
 */
async function renderAll(
  document: PdfDocument,
  pages: readonly number[],
  context: RenderContext,
): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = []
  const taken = new Set<string>()

  for (const [done, index] of pages.entries()) {
    throwIfAborted(context.signal)

    const pageNumber = index + 1
    const image = await renderPage(document, pageNumber, context)
    const name = uniqueEntryName(
      pageEntryName(pageNumber, document.numPages, context.encoding.extension),
      taken,
    )

    taken.add(name)
    entries.push({ name, bytes: new Uint8Array(await image.arrayBuffer()) })
    context.onProgress((done + 1) / pages.length)
  }

  return entries
}

/**
 * Draws one page onto a surface of its own and encodes it.
 *
 * Every allocation is released in a `finally`, in the reverse of the order it
 * was made: the canvas' pixels first, then the page's operator list. A render
 * that throws — a corrupt content stream, a cancel — must cost the same as one
 * that succeeds.
 */
async function renderPage(
  document: PdfDocument,
  pageNumber: number,
  { dpi, scale, encoding, createCanvas, signal }: RenderContext,
): Promise<Blob> {
  const page = await document.getPage(pageNumber)

  try {
    throwIfAborted(signal)

    const viewport = page.getViewport({ scale })
    const { width, height } = canvasSize(viewport, pageNumber, dpi)
    const canvas = createCanvas(width, height)

    try {
      await draw(page.render({ canvas, viewport }), signal)

      return await canvas.convertToBlob({ type: encoding.type, quality: encoding.quality })
    } finally {
      releaseCanvas(canvas)
    }
  } finally {
    page.cleanup()
  }
}

/**
 * Awaits a render task, tearing it down if the user cancels.
 *
 * `cancel()` is the only handle on a render in flight — pdf.js runs the operator
 * list across microtasks and checks a flag between chunks, so a page that has
 * already started stops here rather than at the next page boundary. It rejects
 * the task with its own cancellation error, which is translated back into the
 * one abort error the worker recognises.
 */
async function draw(task: { promise: Promise<void>; cancel(): void }, signal: AbortSignal) {
  const cancel = () => task.cancel()

  signal.addEventListener('abort', cancel, { once: true })

  try {
    await task.promise
  } catch (error) {
    throwIfAborted(signal)
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

/**
 * The single source file, or an error naming what was actually passed.
 *
 * Rendering is one document in, one download out. `EngineInput.files` is a list
 * because merging needs one, so the constraint lives here rather than in the
 * type.
 */
function onlyFile(input: EngineInput): Blob {
  if (input.files.length !== 1) {
    throw new Error(
      `pdf.js renders one document at a time, but was given ${input.files.length} files.`,
    )
  }

  return input.files[0]
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The conversion was cancelled.', 'AbortError')
}
