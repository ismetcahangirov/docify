/**
 * Everything a page render decides *before* any pixels exist: how big, which
 * pages, what to encode as, what to call the result.
 *
 * All of it is pure and none of it touches pdf.js or a canvas, which is what
 * lets the arithmetic that users actually notice — "300 dpi gave me a 2550 px
 * wide image" — be tested directly rather than inferred from a mock.
 */

import type { FormatId } from '@/lib/router/types'

import { BITMAP_MIME_TYPES, JPEG_QUALITY } from './bitmap'
import { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE } from './canvas-limits'
import type { PdfRenderOptions } from './pdf-options'
import { allPageIndices, pageIndices } from './pdf-pages'
import type { PdfViewport } from './pdfjs-runtime'

/** PDF user space is 1/72 inch, so this is the scale-1 resolution. */
export const PDF_USER_SPACE_DPI = 72

/**
 * The default when the user does not choose.
 *
 * 72 would be 1:1 with the document's own units and looks soft on every screen
 * built this century; 300 is a print resolution that turns a 20-page report into
 * 200 MB of PNG. 150 is the middle that reads cleanly at full size and keeps a
 * whole document inside the memory budget.
 */
export const DEFAULT_RENDER_DPI = 150

export const MIN_RENDER_DPI = 12
export const MAX_RENDER_DPI = 1200

/** What `convertToBlob` is asked for, plus the extension that matches it. */
export interface PageEncoding {
  type: string
  /** Omitted for PNG, which is lossless and ignores it. */
  quality?: number
  /** Leading dot, ready to append to an entry name. */
  extension: string
}

export interface CanvasSize {
  width: number
  height: number
}

/**
 * The requested resolution, validated.
 *
 * Checked before the document is opened so that a typo costs nothing: a 1.8 MB
 * download followed by "0 dpi is not a resolution" is a worse answer than the
 * same sentence delivered instantly.
 */
export function renderDpi(options: PdfRenderOptions | undefined): number {
  const dpi = options?.dpi ?? DEFAULT_RENDER_DPI

  if (!Number.isFinite(dpi) || dpi < MIN_RENDER_DPI || dpi > MAX_RENDER_DPI) {
    throw new Error(
      `${dpi} dpi is outside the range this converter can render. ` +
        `Choose between ${MIN_RENDER_DPI} and ${MAX_RENDER_DPI} dpi.`,
    )
  }

  return dpi
}

/** The multiplier pdf.js wants, which is dpi expressed against PDF user space. */
export function renderScale(options: PdfRenderOptions | undefined): number {
  return renderDpi(options) / PDF_USER_SPACE_DPI
}

/**
 * The 0-based page indices to render, ascending and each once.
 *
 * No range means every page — a user who dropped a PDF on the converter and
 * pressed go asked for the whole thing.
 */
export function selectedPages(options: PdfRenderOptions | undefined, pageCount: number): number[] {
  const spec = options?.pages?.trim() ?? ''

  return spec === '' ? allPageIndices(pageCount) : pageIndices(spec, pageCount)
}

/**
 * How a page is written out.
 *
 * `quality` is only attached for JPEG. Passing it to `convertToBlob` for PNG is
 * harmless but dishonest — it suggests a knob that does nothing — and
 * `pdf-options.ts` says so in as many words.
 */
export function encodingFor(format: FormatId, options: PdfRenderOptions | undefined): PageEncoding {
  const type = BITMAP_MIME_TYPES[format]

  if (type === undefined) {
    // Reached only when `supports()` claims a target this cannot write, which
    // is a routing bug rather than anything the user did.
    throw new Error(`The pdf.js engine cannot write pages as "${format}".`)
  }

  const extension = `.${format}`

  if (format !== 'jpg') return { type, extension }

  return { type, extension, quality: clampQuality(options?.quality) }
}

/**
 * The pixel dimensions to allocate for `viewport`.
 *
 * Rounded rather than floored: at 96 dpi a US Letter page is 816.0000000000001
 * px wide, and truncating that class of float loses a column of pixels off every
 * page in the document.
 */
export function canvasSize(viewport: PdfViewport, pageNumber: number, dpi: number): CanvasSize {
  const width = Math.max(1, Math.round(viewport.width))
  const height = Math.max(1, Math.round(viewport.height))

  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_CANVAS_PIXELS) {
    throw new Error(
      `Page ${pageNumber} would be ${width} × ${height} pixels at ${dpi} dpi, ` +
        'which is larger than a browser canvas can hold. Render it at a lower resolution.',
    )
  }

  return { width, height }
}

/**
 * What one page is called inside the archive.
 *
 * Numbered by the page's place in the *document*, not in the selection, so
 * `"5, 9"` yields `page-05` and `page-09` rather than `page-1` and `page-2` —
 * the names have to match what the user typed. Zero-padded to the document's
 * width so a file manager sorting by name puts page 2 before page 10.
 */
export function pageEntryName(pageNumber: number, pageCount: number, extension: string): string {
  const width = String(pageCount).length

  return `page-${String(pageNumber).padStart(width, '0')}${extension}`
}

/**
 * JPEG quality as `convertToBlob` wants it: a fraction, not a percentage.
 *
 * Clamped rather than rejected. Unlike a page range or a resolution, a quality
 * outside `0..1` has an obvious intended meaning at each end, and refusing the
 * job over it would be pedantry.
 */
function clampQuality(quality: number | undefined): number {
  if (quality === undefined || !Number.isFinite(quality)) return JPEG_QUALITY

  return Math.min(Math.max(quality, 0), 1)
}
