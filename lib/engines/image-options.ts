/**
 * The per-job settings an image engine understands.
 *
 * Kept in its own module rather than inside `EngineInput` so that the engine
 * contract stays a description of *how a job runs* and does not accumulate one
 * options bag per media type. A video or PDF engine adds its own slot the same
 * way when it lands.
 *
 * Every field is optional and every default is stated here rather than inside an
 * engine, so two engines asked to do the same job produce comparable output.
 */

/** Encoder quality for a lossy output, on libvips' 1..100 scale. */
export const MIN_QUALITY = 1
export const MAX_QUALITY = 100

/**
 * Used when the caller expresses no opinion.
 *
 * 80 is the point where JPEG and WebP artefacts stop being visible at 100% zoom
 * on photographic content, and it is what both `sharp` and `cwebp` default to —
 * so a file converted here matches what the rest of the ecosystem produces.
 */
export const DEFAULT_QUALITY = 80

/**
 * Clockwise degrees. Quarter turns only: they are the ones a photograph
 * actually needs, they are lossless in libvips, and they leave a rectangle
 * behind. A free angle would need a background colour for the corners it
 * exposes and a decision about whether to grow the canvas or clip — neither of
 * which a format converter should be inventing. Any other value is a bug, not a
 * rounding job.
 */
export type RotationAngle = 0 | 90 | 180 | 270

/** Which way a mirror image is taken. */
export type FlipAxis = 'horizontal' | 'vertical'

/**
 * A rectangle to keep, in source pixels, measured from the top-left corner.
 *
 * Clamped against the image it cuts rather than trusted — see `clampCrop` in
 * `./image-geometry`, which also decides what a rectangle covering everything
 * means.
 */
export interface CropRect {
  left: number
  top: number
  width: number
  height: number
}

export interface ImageOptions {
  /**
   * Encoder quality, `1..100`. Ignored by lossless outputs (PNG, and TIFF as we
   * write it). Values outside the range are clamped rather than rejected: a
   * slider that reports 0 should produce the worst legal image, not an error
   * halfway through a conversion.
   */
  quality?: number
  /** Target width in pixels. With `height`, the image fits *inside* the box. */
  width?: number
  /** Target height in pixels. With `width`, the image fits *inside* the box. */
  height?: number
  /**
   * Keep the source's proportions when resizing. Defaults to `true`.
   *
   * Only a resize can break an aspect ratio, so this is a resize setting and not
   * a job-wide one: a crop changes the ratio by definition, a quarter turn swaps
   * it, and a flip preserves it. Turning it off has an effect only when both
   * {@link width} and {@link height} are given — a single axis has no second
   * dimension to disagree with — and then the image is stretched to exactly that
   * size rather than fitted inside it.
   */
  lockAspectRatio?: boolean
  /**
   * The rectangle to keep. Absent means the whole image.
   *
   * Applied before {@link width} and {@link height}, so a resize is measured
   * against what survived the crop; see `./image-geometry` for the full order
   * and why it is that order.
   */
  crop?: CropRect
  /** Clockwise rotation, applied after the resize. Absent means none. */
  rotate?: RotationAngle
  /** Mirror the image, applied last. Absent means none. */
  flip?: FlipAxis
  /**
   * Refuse to enlarge past the source's own resolution. Defaults to `true`:
   * upscaling invents detail that was never in the file, and a user who asked
   * for 4000px from a 500px source is better served by the sharp original.
   */
  enlarge?: boolean
  /**
   * A ceiling on the output file size, in bytes.
   *
   * The second of the two ways to ask for compression, and the one a person
   * actually has a number for: "under 500 kB for the upload form" rather than
   * "quality 63". No lossy encoder takes a size, so the engine reaches it by
   * encoding and adjusting — see `./image-target-size` for the search and what
   * it costs.
   *
   * Only meaningful for a lossy output. PNG and TIFF ignore `quality` entirely,
   * so there is no dial to search and the engine encodes once; the size such a
   * job produces is the size that format produces.
   *
   * When both this and {@link quality} are given, this wins: it is the more
   * specific request, and honouring the quality instead would silently produce
   * the file the user said was too big.
   */
  targetBytes?: number
  /**
   * Carry EXIF, ICC, XMP and IPTC across to the output. Defaults to `false`.
   *
   * Stripping is the safer default for a tool people point at holiday photos:
   * EXIF routinely carries GPS coordinates, and a converted file usually leaves
   * the device it was made on.
   */
  keepMetadata?: boolean
}

/** Whether the job asks for a different pixel size than the source has. */
export function wantsResize(options: ImageOptions | undefined): boolean {
  return isPositive(options?.width) || isPositive(options?.height)
}

/** The quality to encode with, clamped into the legal range. */
export function resolveQuality(options: ImageOptions | undefined): number {
  const requested = options?.quality
  if (!isPositive(requested)) return DEFAULT_QUALITY

  return Math.min(Math.max(Math.round(requested), MIN_QUALITY), MAX_QUALITY)
}

/**
 * The output size ceiling this job asks for, or `undefined` for "no ceiling".
 *
 * Unlike {@link resolveQuality} there is no default to fall back on: most jobs
 * name no target, and inventing one would compress files nobody asked to
 * compress. A target that no file could meet — zero, negative, or unreadable —
 * is treated as no target rather than as an error: it is a broken form field,
 * and the search it would trigger costs eight full re-encodes to arrive at the
 * lowest-quality file by a much slower route.
 */
export function resolveTargetBytes(options: ImageOptions | undefined): number | undefined {
  const requested = options?.targetBytes
  if (!isPositive(requested)) return undefined

  return Math.floor(requested)
}

function isPositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
