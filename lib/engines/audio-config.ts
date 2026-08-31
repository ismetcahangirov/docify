/**
 * Choosing an audio encoder configuration, and never assuming one.
 *
 * The same discipline as `./video-config` and for the same reason:
 * `AudioEncoder.configure()` accepts anything and reports the trouble
 * asynchronously, several packets later, through an error callback that names
 * nothing the user can act on. `isConfigSupported` answers before the file has
 * been read.
 *
 * ## What each target compiles to
 *
 * The mapping from a *file format* the user picked to a *codec* and a container
 * lives here, in one table, rather than being spread across the pipeline. A
 * `.m4a` is AAC in an ISO container; a `.ogg` is Opus in an Ogg stream. Adding
 * a third is an entry here plus a muxer, and nothing else.
 */

import type { FormatId } from '@/lib/router/types'

import type { AudioOptions } from './audio-options'
import { resolveAudioBitrate, resolveChannels, resolveSampleRate } from './audio-options'
import { OPUS_OUTPUT_RATE } from './ogg-opus'
import type { AudioConfigSupport, AudioEncoderConfig } from './webcodecs-audio-runtime'

/** How one output format is produced. */
export interface AudioTarget {
  /** The RFC 6381 codec string, and the first thing `isConfigSupported` sees. */
  codec: string
  /** Which writer takes the encoded packets. */
  container: 'mp4' | 'ogg'
  /** The MIME type the finished file is labelled with. */
  mimeType: string
  /**
   * A rate the codec insists on, whatever the source ran at.
   *
   * Opus is the case: it always decodes to 48 kHz, and asking its encoder for
   * anything else produces a configuration every browser refuses.
   */
  fixedSampleRate?: number
}

/**
 * The formats this engine can write, and what each one is.
 *
 * MP3 is deliberately absent — no browser has an MP3 encoder, and the reasoning
 * is in `./audio-options`. It routes to ffmpeg instead.
 */
export const AUDIO_TARGETS: Readonly<Partial<Record<FormatId, AudioTarget>>> = {
  m4a: { codec: 'mp4a.40.2', container: 'mp4', mimeType: 'audio/mp4' },
  mp4: { codec: 'mp4a.40.2', container: 'mp4', mimeType: 'audio/mp4' },
  ogg: {
    codec: 'opus',
    container: 'ogg',
    mimeType: 'audio/ogg',
    fixedSampleRate: OPUS_OUTPUT_RATE,
  },
}

/** Whether this engine can write `format` at all. */
export function isAudioTarget(format: FormatId): boolean {
  return AUDIO_TARGETS[format] !== undefined
}

/** What `format` compiles to, or an error naming what the engine does write. */
export function audioTargetFor(format: FormatId): AudioTarget {
  const target = AUDIO_TARGETS[format]
  if (target === undefined) {
    throw new Error(
      `The browser's own audio encoders cannot write ${format.toUpperCase()} files. ` +
        `They write ${Object.keys(AUDIO_TARGETS).join(', ').toUpperCase()}.`,
    )
  }

  return target
}

/** The source properties a plan is built from. */
export interface AudioSource {
  sampleRate: number
  channels: number
}

/**
 * The configuration for one job, negotiated with the browser.
 *
 * Only one candidate per target, unlike the video path: an audio codec string
 * carries no profile or level to walk down, so a refusal here means the browser
 * has no encoder for that codec at all and there is nothing else to try. The
 * message says which one it refused, because that is the actionable part.
 */
export async function planAudioEncode(
  target: AudioTarget,
  source: AudioSource,
  options: AudioOptions | undefined,
  isSupported: (config: AudioEncoderConfig) => Promise<AudioConfigSupport>,
): Promise<AudioEncoderConfig> {
  const numberOfChannels = resolveChannels(options, source.channels)
  const sampleRate = target.fixedSampleRate ?? resolveSampleRate(options, source.sampleRate)

  const candidate: AudioEncoderConfig = {
    codec: target.codec,
    sampleRate,
    numberOfChannels,
    bitrate: resolveAudioBitrate(options, numberOfChannels),
    // Raw AAC, not ADTS: an MP4 sample entry describes the stream once in its
    // `esds`, and a per-frame ADTS header on top of that is seven wasted bytes a
    // frame that some decoders then refuse.
    ...(target.codec.startsWith('mp4a') ? { aac: { format: 'aac' as const } } : {}),
  }

  const support: AudioConfigSupport = await isSupported(candidate).catch(() => ({
    supported: false,
  }))

  if (support.supported !== true) {
    throw new Error(
      `This browser cannot encode ${target.codec} audio at ${sampleRate} Hz in ` +
        `${numberOfChannels} channel${numberOfChannels === 1 ? '' : 's'}. Try a different ` +
        'output format, or a different browser.',
    )
  }

  return support.config ?? candidate
}
