/**
 * Decode, re-encode, re-mux: the WebCodecs audio path.
 *
 * The same four stages as `./video-transcode`, with two differences that matter.
 *
 * **The container is chosen by the target, not fixed.** AAC goes back into an
 * ISO container through `./mp4-mux`; Opus goes into an Ogg stream through
 * `./ogg-opus`, because that is where Opus lives. Which is which is one table,
 * in `./audio-config`.
 *
 * **There is no frame to close.** An `AudioData` is a buffer rather than a GPU
 * surface, so leaking one costs kilobytes instead of megabytes — but it is
 * closed anyway, in a `finally`, because a codec that has run out of its
 * allowed outstanding objects stops silently.
 *
 * ## Timestamps
 *
 * WebCodecs works in microseconds, and the ISO output track is written in
 * microseconds so no second conversion is needed. Ogg is the exception: an Opus
 * stream's granule position counts *output* samples at 48 kHz, whatever rate the
 * source ran at, so the packet timeline is converted there and only there.
 */

import { throwIfAborted } from '@/lib/abort'

import { esdsBox } from './aac-esds'
import type { AudioTarget } from './audio-config'
import { audioTargetFor, planAudioEncode } from './audio-config'
import type { AudioOptions } from './audio-options'
import { codecDescription } from './codec-description'
import { readMp4 } from './mp4-demux'
import type { Mp4Media, Mp4Sample, Mp4Track } from './mp4-media'
import { audioTrack } from './mp4-media'
import { writeMp4 } from './mp4-mux'
import { drainSamples, keepOnlyTrack } from './mp4-samples'
import type { Mp4BoxLoader } from './mp4-runtime'
import { OPUS_OUTPUT_RATE, type OpusPacket, writeOggOpus } from './ogg-opus'
import type { ProgressCallback } from './types'
import type { AudioCodecs, AudioCodecsLoader } from './webcodecs-audio-runtime'
import { browserAudioCodecs, type EncodedAudioChunkLike } from './webcodecs-audio-runtime'

/** WebCodecs timestamps are microseconds; an ISO output track is written in them. */
const MICROSECONDS = 1_000_000

/** How many packets may be in flight before the loop waits. */
const QUEUE_LIMIT = 16

const DEMUXED = 0.1
const ENCODED = 0.9

export interface AudioTranscodeDependencies {
  codecs?: AudioCodecsLoader
  loadMp4Box?: Mp4BoxLoader
}

/** What a finished transcode produced, and how to label it. */
export interface TranscodedAudio {
  bytes: Uint8Array<ArrayBuffer>
  mimeType: string
}

/**
 * Transcodes the audio track of `bytes` into `to`.
 *
 * Video is deliberately dropped rather than carried: this is the audio
 * converter, and a `.m4a` with a video track in it is not a thing anyone asked
 * for. Pulling the sound *out* of a video is issue #50, which is a different
 * job with a different name.
 */
export async function transcodeAudio(
  bytes: Uint8Array,
  to: Parameters<typeof audioTargetFor>[0],
  options: AudioOptions | undefined,
  signal: AbortSignal,
  onProgress: ProgressCallback,
  dependencies: AudioTranscodeDependencies = {},
): Promise<TranscodedAudio> {
  const { codecs = browserAudioCodecs, loadMp4Box } = dependencies
  const target = audioTargetFor(to)

  throwIfAborted(signal)
  onProgress(-1)

  const media = await readMp4(bytes, signal, loadMp4Box)
  const source = audioTrack(media)
  if (source === undefined) throw noAudioTrack(media)
  // The picture, when the job is an extraction from a film: demuxed because the
  // reader reads whole containers, and useless from here on. It is also the
  // larger of the two tracks by an order of magnitude, which is what makes
  // dropping it worth a line.
  keepOnlyTrack(media, source)

  onProgress(DEMUXED)

  const platform = codecs()
  const encoderConfig = await planAudioEncode(
    target,
    {
      sampleRate: source.format.sampleRate ?? source.format.timescale,
      channels: source.format.channelCount ?? 2,
    },
    options,
    platform.isEncoderConfigSupported,
  )
  throwIfAborted(signal)

  const encoded = await run(platform, source, encoderConfig, signal, (fraction) =>
    onProgress(DEMUXED + (ENCODED - DEMUXED) * fraction),
  )

  const written =
    target.container === 'ogg'
      ? writeOgg(encoded, encoderConfig.numberOfChannels, encoderConfig.sampleRate)
      : await writeIso(encoded, target, encoderConfig, source, signal, loadMp4Box)

  onProgress(1)

  return { bytes: written, mimeType: target.mimeType }
}

interface Encoded {
  chunks: { data: Uint8Array; timestamp: number; duration: number; isSync: boolean }[]
  /** The codec's own configuration bytes, as WebCodecs reported them. */
  description?: Uint8Array
}

/** Drives one decoder and one encoder from end to end. */
async function run(
  platform: AudioCodecs,
  source: Mp4Track,
  encoderConfig: Awaited<ReturnType<typeof planAudioEncode>>,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<Encoded> {
  const chunks: Encoded['chunks'] = []
  let description: Uint8Array | undefined
  let failure: Error | null = null

  const encoder = platform.createEncoder({
    output: (chunk, metadata) => {
      description ??= asBytes(metadata.decoderConfig?.description)
      chunks.push(toChunk(chunk))
    },
    error: (reason) => {
      failure ??= reason
    },
  })

  const decoder = platform.createDecoder({
    output: (data) => {
      try {
        encoder.encode(data)
      } finally {
        data.close()
      }
    },
    error: (reason) => {
      failure ??= reason
    },
  })

  try {
    encoder.configure(encoderConfig)
    decoder.configure({
      codec: source.format.codec,
      sampleRate: source.format.sampleRate ?? source.format.timescale,
      numberOfChannels: source.format.channelCount ?? 2,
      description: codecDescription(source.format),
    })

    // Released packet by packet as the decoder takes them, for the reason
    // `./mp4-samples` gives: the encoded output below is filling at the same
    // rate, and both being whole at once is a copy of the file nobody needs.
    const stream = drainSamples(source)
    const total = Math.max(stream.total, 1)
    let done = 0

    for (const sample of stream.samples) {
      throwIfAborted(signal)
      if (failure !== null) throw failure

      decoder.decode(
        platform.encodedChunk({
          type: sample.isSync ? 'key' : 'delta',
          timestamp: Math.round((sample.cts * MICROSECONDS) / source.format.timescale),
          duration: Math.round((sample.duration * MICROSECONDS) / source.format.timescale),
          data: sample.data,
        }),
      )
      await drain(decoder, encoder)

      done += 1
      onProgress(done / total)
    }

    await decoder.flush()
    await encoder.flush()
    throwIfAborted(signal)
    if (failure !== null) throw failure

    return { chunks, description }
  } finally {
    close(decoder)
    close(encoder)
  }
}

/** AAC back into an ISO container, with its configuration wrapped in an `esds`. */
async function writeIso(
  encoded: Encoded,
  target: AudioTarget,
  encoderConfig: Awaited<ReturnType<typeof planAudioEncode>>,
  source: Mp4Track,
  signal: AbortSignal,
  loadMp4Box: Mp4BoxLoader | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  let dts = 0
  const samples: Mp4Sample[] = encoded.chunks.map((chunk) => {
    const sample: Mp4Sample = {
      data: chunk.data,
      dts,
      cts: chunk.timestamp,
      duration: chunk.duration,
      isSync: chunk.isSync,
    }
    dts += chunk.duration

    return sample
  })

  return writeMp4(
    {
      tracks: [
        {
          id: 1,
          kind: 'audio',
          format: {
            codec: target.codec,
            timescale: MICROSECONDS,
            description:
              encoded.description === undefined ? undefined : esdsBox(encoded.description),
            descriptionType: encoded.description === undefined ? undefined : 'esds',
            channelCount: encoderConfig.numberOfChannels,
            sampleRate: encoderConfig.sampleRate,
            language: source.format.language,
          },
          samples,
        },
      ],
    },
    signal,
    loadMp4Box,
  )
}

/**
 * Opus into an Ogg stream.
 *
 * The granule position is the running count of *output* samples at 48 kHz, which
 * is what an Opus decoder produces whatever it was fed — and `planAudioEncode`
 * has already pinned the encoder to that rate, so the conversion below is from
 * microseconds and not from the source's rate.
 */
function writeOgg(encoded: Encoded, channels: number, sampleRate: number): Uint8Array<ArrayBuffer> {
  let granulePosition = 0

  const packets: OpusPacket[] = encoded.chunks.map((chunk) => {
    granulePosition += Math.round((chunk.duration * OPUS_OUTPUT_RATE) / MICROSECONDS)

    return { data: chunk.data, granulePosition }
  })

  return writeOggOpus(packets, channels, sampleRate)
}

async function drain(
  decoder: { readonly decodeQueueSize: number },
  encoder: { readonly encodeQueueSize: number },
): Promise<void> {
  while (decoder.decodeQueueSize > QUEUE_LIMIT || encoder.encodeQueueSize > QUEUE_LIMIT) {
    // A macrotask: a codec reports its progress from the event loop, and a
    // promise chain would spin without ever letting it run.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  }
}

function toChunk(chunk: EncodedAudioChunkLike): Encoded['chunks'][number] {
  const data = new Uint8Array(chunk.byteLength)
  chunk.copyTo(data)

  return {
    data,
    timestamp: chunk.timestamp,
    duration: chunk.duration ?? 0,
    // Every audio packet is independently decodable, and a container that says
    // otherwise makes a player refuse to seek.
    isSync: true,
  }
}

function asBytes(description: ArrayBuffer | ArrayBufferView | undefined): Uint8Array | undefined {
  if (description === undefined) return undefined

  return description instanceof ArrayBuffer
    ? new Uint8Array(description)
    : new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
}

function close(codec: { close(): void }): void {
  try {
    codec.close()
  } catch {
    // Already closed, or closed by its own error.
  }
}

function noAudioTrack(media: Mp4Media): Error {
  return media.tracks.length === 0
    ? new Error('There is nothing in this file to convert.')
    : new Error(
        'This file has a picture but no sound, so there is no audio to convert. If you meant ' +
          'to convert the video itself, choose a video format instead.',
      )
}
