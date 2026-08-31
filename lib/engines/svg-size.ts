/**
 * Reading an SVG's own idea of how big it is, and rewriting it to a size we
 * choose.
 *
 * Rasterising a vector file is the one conversion where the output resolution is
 * a *decision* rather than a property of the input: the same drawing is equally
 * correct at 64 px and at 4096. Something therefore has to answer "how big?"
 * before a pixel exists, and the answer has to match what the user has already
 * seen in their viewer — which is the browser's own sizing rules, reimplemented
 * here on the source text.
 *
 * ## Why text and not a parser
 *
 * `DOMParser` does not exist in a Web Worker, and every conversion runs in one
 * (CLAUDE.md §2.2). What is needed is three attributes off the root element, so
 * the root element's opening tag is matched and read directly. That is a real
 * limitation and a deliberate one: it is not a general XML parser, it does not
 * validate, and it does not care what is inside the document.
 *
 * ## Why the size has to be written back into the file
 *
 * `createImageBitmap` renders an SVG at its *intrinsic* size and gives no way to
 * ask for another one — there is no width argument. Chromium additionally
 * refuses an SVG with no intrinsic size outright. Both are solved the same way:
 * put the size we want into the root element and hand the decoder a file that
 * already means what we intend, which is what {@link sizedSvg} is for.
 */

import type { ImageSize } from './raster-size'

/**
 * What a browser gives an SVG that declares no size of its own.
 *
 * 300 × 150 is the CSS default for a replaced element with no intrinsic
 * dimensions, so it is exactly what the user was looking at in the tab they
 * dragged the file out of. Any other number here would convert a drawing into a
 * raster that does not match its own preview.
 */
export const DEFAULT_SVG_SIZE: ImageSize = { width: 300, height: 150 }

/**
 * CSS absolute units, in pixels.
 *
 * Drawing programs export in the units their users think in — Illustrator in
 * points, Inkscape in millimetres — and a file that says `72pt` is 96 pixels
 * across. Reading it as 72 would rasterise a quarter of the resolution its
 * author chose. Relative units (`%`, `em`, `rem`, `vw`) are deliberately absent:
 * they are a share of a viewport a standalone file does not have, and the
 * viewBox answers better.
 */
const UNIT_PIXELS: Readonly<Record<string, number>> = {
  '': 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
}

/** The opening tag of the root `<svg>` element, and nothing nested inside one. */
const ROOT_TAG = /<svg\b[^>]*>/i

const ATTRIBUTE = (name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`, 'i')

/**
 * The size this drawing declares, in pixels, following the browser's own rules.
 *
 * In order: the `width`/`height` attributes where they carry an absolute unit;
 * the `viewBox` where they do not, or to complete a size that only named one
 * axis; and {@link DEFAULT_SVG_SIZE} when the file says nothing at all.
 *
 * Throws only when the text is not an SVG document — a `.svg` that is really an
 * HTML error page is a common way for a download to go wrong, and failing here
 * says so in one sentence rather than leaving `createImageBitmap` to report an
 * unlabelled decode error several steps later.
 */
export function svgSize(source: string): ImageSize {
  const root = rootTag(source)
  const box = viewBox(root)
  const width = length(attribute(root, 'width'))
  const height = length(attribute(root, 'height'))

  if (width !== null && height !== null) return round({ width, height })

  // One axis and a viewBox is enough: the box supplies the proportions.
  if (box !== null) {
    if (width !== null) return round({ width, height: (width * box.height) / box.width })
    if (height !== null) return round({ width: (height * box.width) / box.height, height })

    return round(box)
  }

  if (width !== null) return round({ width, height: width })
  if (height !== null) return round({ width: height, height })

  return DEFAULT_SVG_SIZE
}

/**
 * The same document, resized to `target`, ready to hand to a decoder.
 *
 * Only the root element's opening tag is touched: `width` and `height` are
 * replaced with the pixel numbers we want, and a `viewBox` is added when the file
 * had none. That last part is what makes the resize a *scale* — without a
 * viewBox, a larger width and height enlarge the canvas and leave the artwork
 * sitting at its original size in the corner of it. An author's own viewBox is
 * never rewritten; it is the mapping they chose.
 */
export function sizedSvg(source: string, target: ImageSize): string {
  const root = rootTag(source)
  const intrinsic = svgSize(source)

  let rewritten = withAttribute(root, 'width', String(target.width))
  rewritten = withAttribute(rewritten, 'height', String(target.height))

  if (viewBox(root) === null) {
    rewritten = withAttribute(rewritten, 'viewBox', `0 0 ${intrinsic.width} ${intrinsic.height}`)
  }

  return source.replace(ROOT_TAG, rewritten)
}

function rootTag(source: string): string {
  const match = ROOT_TAG.exec(source)
  if (match === null) {
    throw new Error(
      'This file is not an SVG: no <svg> element was found in it. If it was downloaded, ' +
        'check that the download completed rather than saving an error page.',
    )
  }

  return match[0]
}

function attribute(tag: string, name: string): string | null {
  const match = ATTRIBUTE(name).exec(tag)
  if (match === null) return null

  return (match[1] ?? match[2] ?? '').trim()
}

/** `min-x min-y width height`, or `null` when there is no usable box. */
function viewBox(tag: string): ImageSize | null {
  const raw = attribute(tag, 'viewBox')
  if (raw === null) return null

  const parts = raw
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
    .map(Number)
  if (parts.length !== 4) return null

  const [, , width, height] = parts
  if (!isPositive(width) || !isPositive(height)) return null

  return { width, height }
}

/** A CSS length in pixels, or `null` for a relative unit or an unreadable value. */
function length(raw: string | null): number | null {
  if (raw === null) return null

  const match = /^([+-]?[\d.]+)\s*([a-z%]*)$/i.exec(raw)
  if (match === null) return null

  const scale = UNIT_PIXELS[match[2].toLowerCase()]
  if (scale === undefined) return null

  const pixels = Number(match[1]) * scale

  return isPositive(pixels) ? pixels : null
}

/**
 * Sets `name` on an opening tag, replacing any value already there.
 *
 * A new attribute is inserted immediately after the element name rather than
 * appended, because the tag may be self-closing and appending would put it after
 * the `/>`.
 */
function withAttribute(tag: string, name: string, value: string): string {
  const existing = ATTRIBUTE(name)

  if (existing.test(tag)) return tag.replace(existing, `${name}="${value}"`)

  return tag.replace(/^<svg\b/i, `<svg ${name}="${value}"`)
}

function round(size: ImageSize): ImageSize {
  return {
    width: Math.max(1, Math.round(size.width)),
    height: Math.max(1, Math.round(size.height)),
  }
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}
