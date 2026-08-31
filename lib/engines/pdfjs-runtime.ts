/**
 * Loading pdf.js, and the sliver of its API this project actually uses.
 *
 * ## What pdf.js does with workers, and what that means inside ours
 *
 * pdf.js normally splits itself in two: an API half that talks to a canvas, and
 * a worker half that parses the document. `getDocument()` spawns that second
 * worker itself, from `GlobalWorkerOptions.workerSrc`, as a *module* worker.
 *
 * Docify's runner is already on a worker thread, which changes the calculus
 * completely:
 *
 * - The reason pdf.js has a worker at all — keep parsing off the thread that
 *   paints the UI — is already satisfied. CLAUDE.md §2.2 is met by the
 *   conversion worker, not by pdf.js's.
 * - Spawning one from here would be a *nested* worker. Support for those is
 *   real but uneven across engines and WebViews, and the failure mode is a
 *   worker that dies before its first message rather than an exception anyone
 *   can route around.
 * - `workerSrc` has to resolve to a URL the bundler emitted next to our own
 *   worker chunk. That is precisely the class of breakage `./vips-runtime`
 *   documents: correct in development, wrong in production, invisible until
 *   then.
 * - pdf.js's own default path cannot even run here. `PDFWorker.#initialize`
 *   reads `window.location` to decide whether `workerSrc` is same-origin, and a
 *   worker has no `window`. It survives that only because the whole block sits
 *   in a `try`, and then falls into the fake-worker path anyway — by accident,
 *   which is not a thing to depend on.
 *
 * So the worker is declined deliberately instead. Assigning the worker module's
 * `WorkerMessageHandler` to `globalThis.pdfjsWorker` is pdf.js's own supported
 * hook for "the worker code is already here": `PDFWorker` finds it, skips
 * `new Worker()` entirely, and wires the two halves together over an in-process
 * `LoopbackPort`. Parsing and rasterising then share this thread — which they
 * would have done regardless, since every page has to be parsed before it can be
 * drawn and the drawing surface only exists here.
 *
 * ## Why the legacy build
 *
 * The default build of pdfjs-dist 6.2 is compiled for the newest engines and
 * calls `Promise.try`, `Uint8Array.prototype.toHex` and
 * `Map.prototype.getOrInsertComputed` on ordinary code paths. Those landed in
 * browsers far more recently than `OffscreenCanvas` did, so `supports()` would
 * hand the job to an engine that throws a `TypeError` deep inside a 1.7 MB
 * download. The legacy build is the same library with those calls compiled away;
 * it costs about 108 kB more and it runs wherever the descriptor says it will.
 *
 * ## Where the optional data comes from
 *
 * `cMapUrl`, `standardFontDataUrl`, `iccUrl` and `wasmUrl` point pdf.js at data
 * it fetches on demand, vendored into `public/vendor/pdfjs/`. `./pdfjs-assets`
 * has the reasoning; what matters here is that all four are passed together, and
 * that {@link loadPdfDocument} takes them as a parameter so a test can watch what
 * pdf.js does without them.
 */

import { type PdfAssetUrls, pdfjsAssetUrls } from './pdfjs-assets'
import { NoFilterFactory, OffscreenCanvasFactory } from './pdfjs-factories'

/**
 * The drawing surface, declared as the four members that are actually touched.
 *
 * `OffscreenCanvas` satisfies this structurally, which is the point: the engine
 * names this type, the browser supplies the real thing, and a unit test supplies
 * something that records what it was asked for. Node has no `OffscreenCanvas`
 * at all, so without this seam none of the render logic could be tested.
 */
export interface RenderCanvas {
  width: number
  height: number
  convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob>
}

/** How the engine obtains a surface. A parameter everywhere it is used. */
export type RenderCanvasFactory = (width: number, height: number) => RenderCanvas

/** A page's size in device pixels at the scale it was asked for. */
export interface PdfViewport {
  readonly width: number
  readonly height: number
}

export interface PdfRenderTask {
  readonly promise: Promise<void>
  /** Rejects `promise`. The only way to stop a render already under way. */
  cancel(): void
}

export interface PdfPage {
  getViewport(parameters: { scale: number }): PdfViewport
  render(parameters: { canvas: RenderCanvas; viewport: PdfViewport }): PdfRenderTask
  /**
   * The page's text as positioned runs. Structurally `PdfTextItem[]` from
   * `./pdf-text-layout`, declared loosely here so this module keeps describing
   * pdf.js rather than depending on what we do with it.
   */
  getTextContent(): Promise<{ items: readonly unknown[] }>
  /** Drops the page's operator list and font references. */
  cleanup(): boolean
}

export interface PdfDocument {
  readonly numPages: number
  /** 1-based, matching how a page number is written everywhere a user sees one. */
  getPage(pageNumber: number): Promise<PdfPage>
}

export interface PdfLoadingTask {
  readonly promise: Promise<PdfDocument>
  /** Tears down the transport and releases the parsed document. */
  destroy(): Promise<void>
}

/**
 * How {@link renderPdfPages} obtains a document. Injectable so the engine can be
 * driven without loading pdf.js — see `test/engines/pdfjs-fake.ts`.
 */
export type PdfLoader = (data: Uint8Array) => Promise<PdfLoadingTask>

/**
 * The half of pdf.js this project calls, declared structurally rather than
 * imported.
 *
 * Same reasoning as `./vips-runtime`: the published typings describe a viewer,
 * `getDocument` is typed against `HTMLCanvasElement` — which cannot exist on a
 * worker thread — and a hand-written interface this small can be satisfied by a
 * fake. One cast, in {@link importPdfjs}, is the entire cost.
 */
interface PdfjsModule {
  getDocument(source: Record<string, unknown>): PdfLoadingTask
}

/** pdf.js's `VerbosityLevel.ERRORS`: warnings about absent optional assets are
 *  not the user's problem and not ours, exactly as with libvips' stderr. */
const VERBOSITY_ERRORS = 0

/** The real surface: an `OffscreenCanvas`, which only exists on a worker. */
export function createOffscreenCanvas(width: number, height: number): RenderCanvas {
  return new OffscreenCanvas(width, height)
}

/**
 * Frees a surface's pixels now rather than at the next collection.
 *
 * A 300 dpi A4 page is 8.7 million pixels, 35 MB of RGBA. Rendering two hundred
 * of them while waiting for the collector to notice is how a tab dies, so every
 * canvas this engine allocates goes through here the moment it has been encoded.
 */
export function releaseCanvas(canvas: RenderCanvas): void {
  canvas.width = 0
  canvas.height = 0
}

/**
 * Opens `data` as a PDF.
 *
 * pdf.js takes ownership of the buffer — it transfers it to its message handler
 * — so the caller must not read `data` again afterwards.
 *
 * `assets` defaults to the vendored directories on this origin. It is a
 * parameter because "the right font was used" is only observable next to a run
 * where it was not.
 */
export async function loadPdfDocument(
  data: Uint8Array,
  assets: PdfAssetUrls = pdfjsAssetUrls(),
): Promise<PdfLoadingTask> {
  const pdfjs = await importPdfjs()

  return pdfjs.getDocument({
    data,
    ...assets,
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,
    // The DOM `FontFace` route ends at `document.fonts`, which a worker does not
    // have. Disabled, pdf.js draws glyphs as paths instead — slower per page,
    // and the only thing that works here.
    disableFontFace: true,
    useSystemFonts: false,
    // The only value that works here, and stated rather than inferred because
    // pdf.js otherwise decides by reading `document.baseURI`, which is another
    // `window`-shaped hole in a worker. Its `false` branch routes every asset
    // fetch through the API half's `fetchData`, which dereferences
    // `document.baseURI` unconditionally and therefore throws on this thread —
    // caught, warned about, and turned into exactly the silently wrong page the
    // vendored assets exist to prevent. `false` also disables ICC colour
    // management outright, whatever `iccUrl` says. `true` fetches from the
    // worker half instead, with a plain same-origin `fetch` and no DOM.
    useWorkerFetch: true,
    // Both are worker-safe when present and absent from Firefox and older
    // Safari. pdf.js defaults them to "yes, this is a browser", which is the
    // wrong question — the right one is whether the global exists here.
    isOffscreenCanvasSupported: 'OffscreenCanvas' in globalThis,
    isImageDecoderSupported: 'ImageDecoder' in globalThis,
    verbosity: VERBOSITY_ERRORS,
  })
}

async function importPdfjs(): Promise<PdfjsModule> {
  // Both halves, in parallel, and both dynamic: this module is statically
  // imported by `./pdf-render`, and a static import here would put 1.8 MB
  // wherever that lands (CLAUDE.md §2.3).
  const [api, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ])

  installWorkerMessageHandler(worker.WorkerMessageHandler)

  return api as unknown as PdfjsModule
}

/**
 * Tells pdf.js its worker half is already loaded, so it never calls
 * `new Worker()`.
 *
 * `globalThis.pdfjsWorker` is the hook pdf.js reads before deciding, and it is
 * global because pdf.js's own lookup is. Assigned once and left alone: a second
 * document in the same worker must find the same handler.
 */
function installWorkerMessageHandler(handler: unknown): void {
  const scope = globalThis as { pdfjsWorker?: { WorkerMessageHandler: unknown } }

  scope.pdfjsWorker ??= { WorkerMessageHandler: handler }
}
