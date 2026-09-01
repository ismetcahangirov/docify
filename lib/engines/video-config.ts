/**
 * Choosing an encoder configuration, and never assuming one.
 *
 * ## Why `isConfigSupported` is not optional
 *
 * `VideoEncoder.configure()` accepts a configuration synchronously and reports
 * the trouble asynchronously, through the `error` callback, some frames later.
 * A codec string the machine cannot encode therefore fails *after* the file has
 * been read, the decoder has started, and the user has watched a progress bar
 * move — and it fails with a `NotSupportedError` that names nothing they can act
 * on. `isConfigSupported` answers the same question before any of that, which is
 * why every configuration here goes through it and why nothing is ever
 * configured on a guess.
 *
 * It is also the only honest way to pick between codecs. Which H.264 profiles a
 * machine can *encode* depends on the GPU, the driver and the browser's build
 * flags; there is no table to consult and no user agent string that answers it.
 *
 * ## Hardware first, software second, and never a claim
 *
 * `hardwareAcceleration: 'prefer-hardware'` is a hint the browser is free to
 * ignore, and the specification deliberately gives no way to ask afterwards
 * which one you got. So the candidate list asks for hardware first and accepts
 * software next, and nothing anywhere claims which was used — a UI that promised
 * "hardware accelerated" from this would be guessing.
 *
 * ## Why several codec strings and not one
 *
 * An H.264 codec string encodes a profile and a level, and hardware encoders are
 * fussy about both: a machine that will not encode High profile will often
 * encode Main, and one that refuses Main will usually take Baseline. Walking
 * down that list costs three cheap asynchronous calls and turns "this device
 * cannot convert video" into "this device converts video at Baseline".
 */

import type { Mp4TrackFormat } from './mp4-media'
import type { ResolvedVideoEncode } from './video-compression'
import { bitrateForCrf, resolveVideoEncode } from './video-compression'
import type { VideoOptions } from './video-options'
import { MIN_BITRATE, prefersHardware, resolveBitrate, resolveFrameRate } from './video-options'
import type { ConfigSupport, EncoderConfig } from './webcodecs-runtime'

/**
 * H.264 profiles to try, best first.
 *
 * High (`64`), Main (`4d`), then Baseline (`42`), each at level 4.0 (`28`) —
 * enough for 1080p30, which is above anything this project resizes to by
 * default. The string is `avc1` followed by profile, constraint flags and level
 * as three bytes of hex, exactly as RFC 6381 defines it.
 */
export const H264_CANDIDATES: readonly string[] = ['avc1.640028', 'avc1.4d0028', 'avc1.420028']

/** Encoders sample chroma at half resolution, so neither dimension may be odd. */
export function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * The pixel size to encode at, from the source's and whatever the job asked for.
 *
 * Takes a plain `{ width?, height? }` rather than a `VideoOptions` because the
 * size may have come from the resize *method* instead of the bare fields, and
 * `resolveVideoEncode` is what reconciles the two. Everything a `VideoOptions`
 * would add here is something this function does not read.
 */
export function targetSize(
  source: { width: number; height: number },
  requested: { width?: number; height?: number } | undefined,
): { width: number; height: number } {
  const width = positive(requested?.width)
  const height = positive(requested?.height)

  if (width === undefined && height === undefined) {
    return { width: evenDimension(source.width), height: evenDimension(source.height) }
  }

  // Fitted inside the box, never stretched: a video with the wrong aspect ratio
  // is a mistake nobody wants and no player corrects.
  const scale = Math.min(
    width === undefined ? Number.POSITIVE_INFINITY : width / source.width,
    height === undefined ? Number.POSITIVE_INFINITY : height / source.height,
    // Never larger than the source. Upscaling a video spends bitrate inventing
    // detail and makes the file bigger for a worse picture.
    1,
  )

  return {
    width: evenDimension(source.width * scale),
    height: evenDimension(source.height * scale),
  }
}

/**
 * The frame rate the source ran at, or `null` when the track does not say
 * enough to work it out.
 *
 * Derived from the samples rather than read: an MP4 has no frame-rate field, and
 * the honest answer is the number of samples over the span they cover.
 */
export function sourceFrameRate(
  timescale: number,
  samples: readonly { duration: number }[],
): number | null {
  if (samples.length === 0 || timescale <= 0) return null

  const ticks = samples.reduce((total, sample) => total + sample.duration, 0)
  if (ticks <= 0) return null

  return (samples.length * timescale) / ticks
}

/**
 * Every configuration worth asking the browser about, best first.
 *
 * Each codec is offered twice — once preferring hardware and once with no
 * preference — so that a machine whose GPU refuses High profile is asked about
 * software High before being dropped to hardware Main. Quality before speed is
 * the right order for a converter: nobody is watching this in real time.
 */
export function encoderCandidates(
  size: { width: number; height: number },
  bitrate: number,
  frameRate: number,
  options: VideoOptions | undefined,
  codecs: readonly string[] = H264_CANDIDATES,
): EncoderConfig[] {
  const preferences: EncoderConfig['hardwareAcceleration'][] = prefersHardware(options)
    ? ['prefer-hardware', 'no-preference']
    : ['no-preference']

  return codecs.flatMap((codec) =>
    preferences.map((hardwareAcceleration) => ({
      codec,
      width: size.width,
      height: size.height,
      bitrate,
      framerate: frameRate,
      hardwareAcceleration,
      // The length-prefixed form an MP4 sample entry stores. `annexb` would put
      // start codes in the bitstream and parameter sets in every keyframe, which
      // is what a transport stream wants and what a file does not.
      avc: { format: 'avc' as const },
      // Nobody is watching this as it encodes, so spend the time on the picture.
      latencyMode: 'quality' as const,
    })),
  )
}

/**
 * The first candidate the browser says it can encode.
 *
 * `isConfigSupported` may also hand back a *corrected* configuration — a level
 * raised to cover the resolution, say — and that corrected one is what gets
 * used, because it is what the browser actually agreed to.
 */
export async function chooseEncoderConfig(
  candidates: readonly EncoderConfig[],
  isSupported: (config: EncoderConfig) => Promise<ConfigSupport>,
): Promise<EncoderConfig> {
  const refused: string[] = []

  for (const candidate of candidates) {
    // A browser that throws rather than answering `false` — which is what an
    // invalid codec string gets — is telling us the same thing.
    const support: ConfigSupport = await isSupported(candidate).catch(() => ({ supported: false }))

    if (support.supported === true) return support.config ?? candidate

    refused.push(`${candidate.codec} (${candidate.hardwareAcceleration ?? 'no-preference'})`)
  }

  throw new Error(
    'This browser cannot encode video at any setting this conversion could offer it — ' +
      `it refused ${refused.join(', ')}. Try a smaller output size, or use a different browser: ` +
      'hardware video encoding is often unavailable inside a virtual machine or over remote ' +
      'desktop.',
  )
}

/**
 * How long the track runs, in seconds.
 *
 * The sum of the sample durations over the timescale, which is the only place an
 * MP4 states it that does not require trusting a header the file may not have
 * updated. Zero for a track with no samples, which is what a target size is told
 * about rather than guessing around.
 */
export function sourceDurationSeconds(
  timescale: number,
  samples: readonly { duration: number }[],
): number {
  if (timescale <= 0) return 0

  return samples.reduce((total, sample) => total + sample.duration, 0) / timescale
}

/**
 * The bitrate to hand `VideoEncoder`, from whichever sizing method was chosen.
 *
 * This is where the one real difference between the two engines is absorbed:
 * WebCodecs has no constant-quality mode at all, so a CRF has to become a number
 * of bits per second before the encoder ever sees it — `bitrateForCrf` is that
 * translation, and it is the scale's own definition rather than a guess. A
 * ceiling with it becomes a `min`, which is the closest a fixed-rate encoder can
 * come to constrained quality.
 */
export function encodeBitrate(
  encode: ResolvedVideoEncode,
  options: VideoOptions | undefined,
  size: { width: number; height: number },
  frameRate: number,
): number {
  if (encode.bitrate !== undefined) {
    return Math.max(MIN_BITRATE, Math.round(encode.bitrate))
  }

  if (encode.crf !== undefined) {
    const quality = bitrateForCrf(encode.crf, size.width, size.height, frameRate)

    return encode.maxBitrate === undefined ? quality : Math.min(quality, encode.maxBitrate)
  }

  return resolveBitrate(options, size.width, size.height, frameRate)
}

/** The encoder configuration for one job, negotiated end to end. */
export async function planVideoEncode(
  source: Mp4TrackFormat,
  samples: readonly { duration: number }[],
  options: VideoOptions | undefined,
  isSupported: (config: EncoderConfig) => Promise<ConfigSupport>,
): Promise<EncoderConfig> {
  if (source.width === undefined || source.height === undefined) {
    throw new Error('This video does not say how large its picture is, so it cannot be re-encoded.')
  }

  // No audio is carried through this path, so a size target has the whole file
  // to spend rather than having to leave room for a soundtrack.
  const encode = resolveVideoEncode(options, {
    durationSeconds: sourceDurationSeconds(source.timescale, samples),
    audioBitrate: 0,
  })

  const size = targetSize({ width: source.width, height: source.height }, encode)
  const frameRate = resolveFrameRate(options, sourceFrameRate(source.timescale, samples))
  const bitrate = encodeBitrate(encode, options, size, frameRate)

  return chooseEncoderConfig(encoderCandidates(size, bitrate, frameRate, options), isSupported)
}

function positive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
