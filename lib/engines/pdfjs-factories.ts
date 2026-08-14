/**
 * The two factories pdf.js allocates its own surfaces through.
 *
 * Both of its defaults reach for a DOM that a worker thread does not have, and
 * both are passed to `getDocument` by `./pdfjs-runtime`. They live here rather
 * than beside it because they are pdf.js plumbing rather than Docify's use of
 * pdf.js, and because a module that both loads a library and reimplements two of
 * its classes has stopped having one responsibility (CLAUDE.md §5.2).
 */

/** A scratch surface pdf.js allocates for itself, in the shape it expects back. */
interface CanvasEntry {
  canvas: OffscreenCanvas | null
  context: OffscreenCanvasRenderingContext2D | null
}

/**
 * Where pdf.js gets the extra surfaces it needs mid-page — transparency groups,
 * soft masks, tiling patterns, type-3 glyphs.
 *
 * Its own default reaches for `document.createElement('canvas')`, which on this
 * thread is a `TypeError` the moment a document uses any of those features. Most
 * do. Passing this class is therefore not a nicety; it is the difference between
 * rendering a real PDF and rendering only the simple ones.
 */
export class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasEntry {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size')

    const canvas = new OffscreenCanvas(width, height)

    // `willReadFrequently` matches what pdf.js asks for on the page canvas: it
    // reads pixels back constantly for masks and blends, and the software path
    // is faster than a GPU round trip for that.
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) }
  }

  reset(entry: CanvasEntry, width: number, height: number): void {
    if (entry.canvas === null) throw new Error('Canvas is not specified')

    entry.canvas.width = width
    entry.canvas.height = height
  }

  destroy(entry: CanvasEntry): void {
    if (entry.canvas === null) throw new Error('Canvas is not specified')

    // Zeroing both axes is what actually frees the backing store; dropping the
    // reference alone leaves it alive until the next collection, and a document
    // full of soft masks allocates one of these per drawn image.
    entry.canvas.width = 0
    entry.canvas.height = 0
    entry.canvas = null
    entry.context = null
  }
}

/**
 * The no-op filter factory, matching what pdf.js itself installs outside a DOM.
 *
 * Its browser factory implements image decode arrays and soft-mask luminosity
 * as SVG filters, which it builds by appending a hidden `<defs>` to
 * `document.body`. There is no body here. pdf.js ships exactly this fallback for
 * environments without one, and the cost is that an image with a `/Decode`
 * array renders without it rather than crashing the page.
 */
export class NoFilterFactory {
  addFilter(): string {
    return 'none'
  }
  addHCMFilter(): string {
    return 'none'
  }
  addAlphaFilter(): string {
    return 'none'
  }
  addLuminosityFilter(): string {
    return 'none'
  }
  addKnockoutFilter(): string {
    return 'none'
  }
  addHighlightHCMFilter(): string {
    return 'none'
  }
  addSelectionHCMFilter(): string {
    return 'none'
  }
  addSelectionFilter(): string {
    return 'none'
  }
  createSelectionStyle(): null {
    return null
  }
  destroy(): void {}
}
