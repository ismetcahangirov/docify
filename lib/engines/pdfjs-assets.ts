/**
 * Where pdf.js fetches the data it does not carry in its bundle.
 *
 * pdf.js splits four things out of its library and fetches them only when a
 * document turns out to need one: CJK character maps, the fourteen standard PDF
 * fonts, the CMYK ICC profile, and the WASM decoders for JPEG 2000, JBIG2 and
 * colour management. Each has an API option naming the directory it lives in,
 * and each is optional in the worst sense — unset, pdf.js substitutes a face,
 * skips the colour transform and draws nothing for the image, then renders the
 * page and reports success. The document comes out wrong in a way only someone
 * holding the original would notice.
 *
 * `scripts/vendor-pdfjs` copies the four directories into `public/vendor/pdfjs/`
 * and this module names them, so the two halves cannot drift apart without a
 * test failing. Serving them ourselves is not a preference: CLAUDE.md §3 forbids
 * CDN requests, and `Cross-Origin-Embedder-Policy: require-corp` would block a
 * cross-origin fetch of them anyway.
 */

/** Where `scripts/vendor-pdfjs` puts the tree, as a URL path. */
export const PDFJS_ASSET_PATH = '/vendor/pdfjs/'

/** Packed `.bcmap` character maps — what a CJK document is unreadable without. */
export const PDFJS_CMAP_PATH = `${PDFJS_ASSET_PATH}cmaps/`
/** The standard 14 fonts, as Liberation and Foxit substitutes for the originals. */
export const PDFJS_STANDARD_FONT_PATH = `${PDFJS_ASSET_PATH}standard_fonts/`
/**
 * The CMYK profile pdf.js converts `/DeviceCMYK` through.
 *
 * Fetched with a *synchronous* `XMLHttpRequest`, along with the qcms engine that
 * uses it — pdf.js has no other option there, and it is legal only off the main
 * thread, which is where this runs. It happens at most once per worker, on the
 * first document that names an ICC colour space, and for those two requests the
 * worker cannot answer a cancel.
 */
export const PDFJS_ICC_PATH = `${PDFJS_ASSET_PATH}iccs/`
/** JPEG 2000, JBIG2 and the qcms colour engine. */
export const PDFJS_WASM_PATH = `${PDFJS_ASSET_PATH}wasm/`

/**
 * The four URL options `getDocument` takes, all optional to pdf.js and all
 * supplied together here.
 *
 * Declared as a type rather than assembled inline so a test can pass an empty
 * object and observe what an unconfigured pdf.js actually does.
 */
export interface PdfAssetUrls {
  cMapUrl?: string
  standardFontDataUrl?: string
  iccUrl?: string
  wasmUrl?: string
}

/**
 * The absolute, same-origin URLs of the vendored directories.
 *
 * `base` is a parameter so the rule — always this origin, never a CDN — can be
 * asserted without a document. Left out, it reads the worker's own location.
 *
 * Every URL keeps its trailing slash. pdf.js appends the filename to it raw and
 * rejects a base without one, so the slashes are load-bearing rather than tidy.
 */
export function pdfjsAssetUrls(
  base: string = globalThis.location?.origin ?? '',
): Required<PdfAssetUrls> {
  // An empty base means this module is being evaluated somewhere it has no
  // business being — during server rendering, or in a test without a location.
  // `new URL()` would throw about an invalid base, which points nowhere useful.
  if (base === '') {
    throw new Error(
      'pdf.js can only be loaded in the browser: no origin is available to resolve ' +
        `${PDFJS_ASSET_PATH} against.`,
    )
  }

  const at = (path: string): string => new URL(path, base).href

  return {
    cMapUrl: at(PDFJS_CMAP_PATH),
    standardFontDataUrl: at(PDFJS_STANDARD_FONT_PATH),
    iccUrl: at(PDFJS_ICC_PATH),
    wasmUrl: at(PDFJS_WASM_PATH),
  }
}
