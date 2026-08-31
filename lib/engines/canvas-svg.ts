/**
 * Preparing an SVG for the canvas engine to rasterise.
 *
 * The read side of `svg → png | jpg | webp | bmp`. Everything specific to
 * vectors lives here so `./canvas-runner` keeps one pipeline — decode, draw,
 * encode — with the SVG case supplying a different `Blob` to decode rather than
 * a second copy of the whole runner.
 *
 * ## Why the resolution is chosen rather than read
 *
 * Every other conversion inherits its output size from the input: a 4000 px JPEG
 * decodes to 4000 px whatever anyone wants. A drawing has no such size — it is
 * equally correct at 64 px and at 4096 — so rasterising one means *deciding*,
 * and the decision belongs to the user. `image.width` / `image.height` are that
 * decision, and where the job makes none, the drawing's own declared size is
 * used so the file matches the preview the user was looking at.
 *
 * That is also why enlarging is not gated here the way it is for a photograph.
 * `ImageOptions.enlarge` defaults to `false` because upscaling a raster invents
 * detail that was never in the file; scaling a vector invents nothing, and a
 * 4096 px render of a 24 px icon is the single most common thing anyone wants
 * from an SVG converter.
 *
 * ## Why nothing here reaches the network
 *
 * An SVG can reference external images and stylesheets. Rendering one through
 * `createImageBitmap` puts it in the same secure static mode an `<img>` uses:
 * scripts do not run and external references are not fetched. So a drawing that
 * points at a tracking pixel does not phone home from this converter, which is
 * what CLAUDE.md §2.1 requires of every path a user's file takes.
 */

import { type ImageSize } from './raster-size'
import { positiveDimension, resizedSize } from './image-geometry'
import type { ImageOptions } from './image-options'
import { sizedSvg, svgSize } from './svg-size'

/** What a rewritten drawing is labelled as, so the decoder treats it as one. */
export const SVG_MIME_TYPE = 'image/svg+xml'

/** A drawing rewritten to the size it should be rendered at. */
export interface PreparedSvg {
  /** Hand this to `createImageBitmap`; it declares {@link size} as its own. */
  source: Blob
  /** The raster dimensions the decode will produce. */
  size: ImageSize
}

/**
 * Reads the drawing, works out what size to render it at, and rewrites it to say
 * so.
 *
 * The rewrite is not decoration. `createImageBitmap` has no width argument — it
 * renders an SVG at whatever size the file claims — and Chromium refuses one
 * that claims no size at all. Putting the target into the root element is the
 * only way to ask for a resolution, and it fixes both problems at once.
 */
export async function prepareSvg(
  file: Blob,
  options: ImageOptions | undefined,
): Promise<PreparedSvg> {
  const source = await file.text()
  const size = rasterSize(svgSize(source), options)

  return { source: new Blob([sizedSvg(source, size)], { type: SVG_MIME_TYPE }), size }
}

/**
 * The pixel dimensions to render `intrinsic` at, given what the job asked for.
 *
 * Aspect-ratio locking works exactly as it does for a raster resize — fit inside
 * the box by default, stretch to exactly the requested size when the lock is
 * off and both axes are given — because a user who has just cropped a photograph
 * should not have to learn a second set of rules for a logo. The one difference
 * is that enlarging is always allowed; see the module header.
 */
export function rasterSize(intrinsic: ImageSize, options: ImageOptions | undefined): ImageSize {
  const width = positiveDimension(options?.width)
  const height = positiveDimension(options?.height)
  if (width === undefined && height === undefined) return intrinsic

  const stretch = options?.lockAspectRatio === false && width !== undefined && height !== undefined

  return resizedSize({ width, height, stretch, enlarge: true }, intrinsic)
}
