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
   * Refuse to enlarge past the source's own resolution. Defaults to `true`:
   * upscaling invents detail that was never in the file, and a user who asked
   * for 4000px from a 500px source is better served by the sharp original.
   */
  enlarge?: boolean
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

function isPositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
