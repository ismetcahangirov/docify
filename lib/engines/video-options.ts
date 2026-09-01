/**
 * The per-job settings a video engine understands.
 *
 * The third options slot on `EngineInput`, alongside `image` and `pdf`, and for
 * the same reason: a shared bag would have to be loose enough to hold a page
 * range and a video bitrate at once, which means every reader is guessing.
 *
 * Every field is optional and every default is stated here rather than inside an
 * engine, so a job routed to WebCodecs and the same job routed to ffmpeg produce
 * comparable output.
 */

import type { VideoCompression } from './video-compression'

/** Bits per second below which a video is unwatchable at any size. */
export const MIN_BITRATE = 50_000

/**
 * Bits per pixel per second for a target bitrate nobody chose.
 *
 * 0.08 is the middle of the range the streaming services publish for H.264 at
 * ordinary complexity: it puts 1080p30 at about 5 Mbps and 720p30 at 2.2 Mbps,
 * which is what YouTube's own upload guidance recommends for each. Deriving it
 * from pixels rather than fixing a number per resolution is what makes an
 * unusual size — a phone's 1080 × 1920 portrait clip, a 512 × 512 square —
 * come out at a sensible rate instead of the nearest preset's.
 */
export const BITS_PER_PIXEL_PER_SECOND = 0.08

/** Frames per second assumed when the container did not say. */
export const DEFAULT_FRAME_RATE = 30

export interface VideoOptions {
  /**
   * Target width in pixels. With `height`, the image fits *inside* the box; with
   * neither, the source's own size is kept.
   *
   * Rounded to an even number by the engine, because every codec this project
   * writes samples chroma at half resolution and cannot represent an odd
   * dimension.
   */
  width?: number
  height?: number
  /** Bits per second. Absent derives one from the output's pixels — see {@link BITS_PER_PIXEL_PER_SECOND}. */
  bitrate?: number
  /** Frames per second. Absent keeps the source's. */
  frameRate?: number
  /**
   * Ask the browser for a hardware encoder. Defaults to `true`.
   *
   * A preference and not a requirement: `prefer-hardware` is tried first and a
   * software encoder is accepted when the hardware one refuses the
   * configuration, which is what keeps a job working on a machine whose GPU has
   * no encoder for the profile asked for.
   */
  hardware?: boolean
  /**
   * Which sizing method the user chose, and its one setting.
   *
   * Absent means "no method" and not "a bad one": a plain container conversion
   * asks for no compression at all, and the fields above are then the whole
   * story. When it is present it is the *newer* answer and overrides whichever
   * of {@link width}, {@link height} and {@link bitrate} it speaks to — see
   * `resolveVideoEncode` in `./video-compression`, which is the one place that
   * reconciles the two and the only place either engine reads.
   */
  compression?: VideoCompression
}

/** The bitrate this job should encode at, in bits per second. */
export function resolveBitrate(
  options: VideoOptions | undefined,
  width: number,
  height: number,
  frameRate: number,
): number {
  const requested = options?.bitrate

  if (typeof requested === 'number' && Number.isFinite(requested) && requested > 0) {
    return Math.max(MIN_BITRATE, Math.round(requested))
  }

  return Math.max(MIN_BITRATE, Math.round(width * height * frameRate * BITS_PER_PIXEL_PER_SECOND))
}

/** The frame rate to encode at: the job's, the source's, or the default. */
export function resolveFrameRate(options: VideoOptions | undefined, source: number | null): number {
  const requested = options?.frameRate
  if (typeof requested === 'number' && Number.isFinite(requested) && requested > 0) {
    return requested
  }

  return source !== null && Number.isFinite(source) && source > 0 ? source : DEFAULT_FRAME_RATE
}

/** Whether the job wants a hardware encoder tried first. Defaults to yes. */
export function prefersHardware(options: VideoOptions | undefined): boolean {
  return options?.hardware !== false
}
