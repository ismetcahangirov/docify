/**
 * The per-job settings an audio engine understands, and the table of what the
 * browser can actually encode.
 *
 * ## Why MP3 is not on the list
 *
 * `AudioEncoder` has no MP3 encoder — not in Chrome, not in Safari, not
 * anywhere. It *decodes* MP3 happily, which is why an MP3 can be converted *to*
 * something else, but nothing in WebCodecs writes one. The alternative is a
 * JavaScript port of LAME, and LAME is LGPL: bringing it into an MIT project is
 * a licensing decision for the repository's owner rather than something an
 * engine should quietly make. So `→ mp3` routes to `ffmpeg` (issue #49), which
 * has the encoder already.
 */

/** Bits per second below which speech stops being intelligible. */
export const MIN_BITRATE = 8_000

/**
 * Bits per second per channel when the job names no rate.
 *
 * 96 kbps a channel — 192 for stereo — is the point where AAC and Opus are both
 * transparent enough that ordinary listeners stop hearing the difference on
 * music, and it is what most download services encode at. Per channel rather
 * than fixed, so a mono podcast is not charged for a second one it does not
 * have.
 */
export const BITS_PER_CHANNEL = 96_000

export interface AudioOptions {
  /** Bits per second across all channels. Absent derives one — see {@link BITS_PER_CHANNEL}. */
  bitrate?: number
  /** Output sample rate in hertz. Absent keeps the source's. */
  sampleRate?: number
  /** Output channel count. Absent keeps the source's. */
  channels?: number
}

/** The bitrate this job should encode at, in bits per second. */
export function resolveAudioBitrate(options: AudioOptions | undefined, channels: number): number {
  const requested = options?.bitrate

  if (typeof requested === 'number' && Number.isFinite(requested) && requested > 0) {
    return Math.max(MIN_BITRATE, Math.round(requested))
  }

  return Math.max(MIN_BITRATE, channels * BITS_PER_CHANNEL)
}

/** The channel count to encode: the job's, or the source's. */
export function resolveChannels(options: AudioOptions | undefined, source: number): number {
  const requested = options?.channels

  if (typeof requested === 'number' && Number.isInteger(requested) && requested > 0) {
    return Math.min(requested, 8)
  }

  return source > 0 ? source : 2
}

/** The sample rate to encode at: the job's, or the source's. */
export function resolveSampleRate(options: AudioOptions | undefined, source: number): number {
  const requested = options?.sampleRate

  if (typeof requested === 'number' && Number.isFinite(requested) && requested > 0) {
    return Math.round(requested)
  }

  return source > 0 ? source : 48_000
}
