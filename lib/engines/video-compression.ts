/**
 * The four ways a person asks for a smaller video, and what each one becomes.
 *
 * Every converter worth using offers the same set, because they answer four
 * different questions:
 *
 * - **Target size** — "it has to fit in 8 MB." The only method with an external
 *   constraint, and the only one that needs to know how long the video runs.
 * - **Quality (CRF)** — "keep it looking like this, whatever that costs." The
 *   encoder spends bits where the picture is hard and saves them where it is
 *   easy, so the size is whatever the content turns out to need.
 * - **Max bitrate** — "look as good as you can, but never exceed this rate."
 *   Constrained quality: a CRF encode with a ceiling, which is what a streaming
 *   platform's upload limit actually means.
 * - **Resize** — "make the picture smaller." Not a rate at all; the rate follows
 *   from the pixels.
 *
 * ## Why this is a pure module and not a branch inside each engine
 *
 * There are two engines, and they have nothing in common at the codec level: one
 * hands x264 a `-crf` and the other hands `VideoEncoder` a bitrate in bits per
 * second, because WebCodecs has no constant-quality mode at all. If each worked
 * the methods out for itself, the same request would produce visibly different
 * files depending on which engine the router happened to pick — which is exactly
 * what `./video-options` exists to prevent. So the policy is decided once, here,
 * as arithmetic on numbers, and each engine only translates the answer into its
 * own vocabulary.
 *
 * ## The CRF scale, and how it becomes a bitrate
 *
 * CRF is x264's constant rate factor: 0 is lossless, 51 is unwatchable, and the
 * useful range is about 18 to 28. Its one arithmetic property is that a step of
 * six is a factor of two in bitrate — that is the definition of the scale, not
 * an approximation of it. {@link bitrateForCrf} is that identity applied to the
 * project's own default rate, which is what lets a quality slider mean the same
 * thing on the engine that has no CRF.
 */

import type { VideoOptions } from './video-options'
import { BITS_PER_PIXEL_PER_SECOND, MIN_BITRATE } from './video-options'

/** Lossless. Enormous, and almost never what anyone wants. */
export const MIN_CRF = 0

/** Unwatchable. The scale's own end, kept so a slider has one. */
export const MAX_CRF = 51

/**
 * x264's own default, and the middle of the useful range: 18 is visually
 * lossless at four times the size, 28 is where blocking starts to show on
 * motion.
 */
export const DEFAULT_CRF = 23

/** The step on the CRF scale that halves or doubles the bitrate, by definition. */
export const CRF_HALVING_STEP = 6

/**
 * Share of a size target the video is allowed to spend.
 *
 * The other 3% is the container: an MP4's sample table, its track headers and
 * the `moov` box grow with the number of frames, and none of it is in the
 * bitrate the encoder was told to hit. Aiming exactly at the target therefore
 * overshoots it every time, and a file that is 2% over the limit the user typed
 * has failed at the one thing this method promises.
 */
export const TARGET_SIZE_HEADROOM = 0.97

/**
 * Which of the four the user picked.
 *
 * A discriminated union rather than four optional fields, because they are
 * alternatives and not a combination: "target 8 MB *and* CRF 18" is two answers
 * to one question, and a shape that can express it makes every reader decide
 * which one wins. `resize` carries its own dimensions so the panel that renders
 * these methods (issue #60) has one field to bind per method.
 */
export type VideoCompression =
  | { method: 'target-size'; targetBytes: number }
  | { method: 'quality'; crf: number }
  | { method: 'max-bitrate'; bitrate: number }
  | { method: 'resize'; width?: number; height?: number }

/** What the source contributes to the arithmetic. */
export interface CompressionSource {
  /**
   * How long the video runs, in seconds. Zero or less means nothing could read
   * it, which only the target-size method cannot survive.
   */
  durationSeconds: number
  /**
   * Bits per second the sound will cost in the output, subtracted from a size
   * target. Zero for a job that keeps no audio.
   */
  audioBitrate: number
}

/**
 * One job's encoding decisions, in terms both engines can read.
 *
 * Deliberately not a `VideoOptions`: the fields here are *answers*, and three of
 * them cannot be asked for directly. `bitrate` and `crf` are mutually exclusive
 * by construction — a fixed rate and a constant quality are opposite
 * instructions — and a reader may assume at most one is set.
 */
export interface ResolvedVideoEncode {
  width?: number
  height?: number
  /** A rate the encoder must average, bits per second. */
  bitrate?: number
  /** A rate the encoder may not exceed, bits per second. Pairs with {@link crf}. */
  maxBitrate?: number
  /** Constant quality on the CRF scale. */
  crf?: number
  /** Frames per second, carried through untouched: it is not one of the methods. */
  frameRate?: number
}

/** A CRF value pulled onto the scale, rounded to the integers the scale is made of. */
export function clampCrf(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CRF

  return Math.min(MAX_CRF, Math.max(MIN_CRF, Math.round(value)))
}

/**
 * The video bitrate that fills `targetBytes` over the source's running time, or
 * `null` when the running time is unknown.
 *
 * `null` and not a guess: a target size is the one method with a promise in it,
 * and quietly encoding at some other rate breaks that promise without saying so.
 * The caller turns it into a sentence.
 */
export function bitrateForTargetSize(
  targetBytes: number,
  source: CompressionSource,
): number | null {
  const { durationSeconds, audioBitrate } = source
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  if (!Number.isFinite(targetBytes) || targetBytes <= 0) return MIN_BITRATE

  const budgetBits = targetBytes * 8 * TARGET_SIZE_HEADROOM
  const forVideo = budgetBits - Math.max(0, audioBitrate) * durationSeconds

  return Math.max(MIN_BITRATE, Math.round(forVideo / durationSeconds))
}

/**
 * What a CRF is worth in bits per second at this size, for an encoder that has
 * no CRF.
 *
 * The default rate scaled by two to the power of how far the request sits from
 * the default quality, six steps to the doubling. That is the scale's own
 * definition, so a user who moves the slider two steps gets the change they
 * would have got from x264.
 */
export function bitrateForCrf(
  crf: number,
  width: number,
  height: number,
  frameRate: number,
): number {
  const scale = 2 ** ((DEFAULT_CRF - clampCrf(crf)) / CRF_HALVING_STEP)
  const rate = width * height * frameRate * BITS_PER_PIXEL_PER_SECOND * scale

  return Math.max(MIN_BITRATE, Math.round(rate))
}

/**
 * The job's settings, with the chosen sizing method folded in.
 *
 * A job with no method resolves to exactly what it already said, which is what
 * keeps every conversion that predates this module behaving as it did.
 */
export function resolveVideoEncode(
  options: VideoOptions | undefined,
  source: CompressionSource,
): ResolvedVideoEncode {
  const base: ResolvedVideoEncode = {
    width: options?.width,
    height: options?.height,
    bitrate: options?.bitrate,
    frameRate: options?.frameRate,
  }

  const compression = options?.compression
  if (compression === undefined) return base

  switch (compression.method) {
    case 'target-size': {
      const bitrate = bitrateForTargetSize(compression.targetBytes, source)
      if (bitrate === null) throw unknownDuration()

      // The size is the newer and more specific answer, so it replaces any rate
      // the job was carrying rather than competing with it.
      return { ...base, bitrate }
    }

    case 'quality':
      // No bitrate at all: constant quality means the encoder decides the rate,
      // and leaving one set would tell it the opposite.
      return { ...base, bitrate: undefined, crf: clampCrf(compression.crf) }

    case 'max-bitrate':
      return {
        ...base,
        bitrate: undefined,
        maxBitrate: Math.max(MIN_BITRATE, Math.round(compression.bitrate)),
        crf: DEFAULT_CRF,
      }

    case 'resize':
      return {
        ...base,
        width: compression.width ?? base.width,
        height: compression.height ?? base.height,
      }

    default:
      return unhandledMethod(compression)
  }
}

/**
 * Exhaustiveness guard: adding a method without teaching this function about it
 * is a compile error rather than a silently ignored setting.
 */
function unhandledMethod(compression: never): never {
  throw new Error(`Unknown compression method: ${JSON.stringify(compression)}`)
}

function unknownDuration(): Error {
  return new Error(
    'This file does not say how long it is, so a target file size cannot be turned into a ' +
      'bitrate. Choose a quality or a maximum bitrate instead, or convert the file to MP4 first.',
  )
}
