/**
 * Decode, re-encode, re-mux: the WebCodecs video path.
 *
 * ## The shape of it
 *
 * Four stages, and only the middle two touch a codec:
 *
 * 1. `./mp4-demux` reads the container into encoded samples.
 * 2. A `VideoDecoder` turns those into frames.
 * 3. A `VideoEncoder` turns the frames back into samples, at the size and
 *    bitrate `./video-config` negotiated with the browser.
 * 4. `./mp4-mux` writes a new container around them.
 *
 * The two codecs are wired output-to-input: the decoder's `output` callback
 * hands each frame straight to the encoder and closes it. A frame is a GPU
 * surface — several megabytes for 1080p, more on a phone — so holding a queue of
 * them is how a transcode kills a tab.
 *
 * The *encoded* samples are the other half of the same problem, and the one
 * that is easy to miss: stage 1 produces one whole copy of the file's payload
 * and stage 3 consumes another, so leaving the first intact while the second
 * fills would hold the file twice over. `./mp4-samples` is what stops that —
 * the source is released frame by frame as the decoder swallows it.
 *
 * ## Backpressure is the memory model
 *
 * Both codecs accept work faster than they do it, and neither pushes back. Left
 * alone, feeding a two-minute clip queues every one of its frames before the
 * first is encoded. So the loop watches `decodeQueueSize` and `encodeQueueSize`
 * and waits, which is what keeps the live set at a handful of frames rather than
 * a film's worth. That, and the release above, is what makes the factor
 * `MEMORY.webcodecs` charges in `lib/router/budget.ts` true.
 *
 * ## Timestamps
 *
 * WebCodecs works in microseconds; MP4 works in a track's own timescale. The
 * conversion happens exactly twice — once on the way in, once on the way out —
 * and the output track is written in microseconds so the second one is the
 * identity.
 *
 * The encoder emits chunks in decode order and stamps them with *presentation*
 * times, so decode timestamps are accumulated from the durations rather than
 * copied. For an encoder that emits no B-frames — which is every browser
 * encoder today — the two agree; for one that does, this is what keeps the
 * container honest.
 */

import { throwIfAborted } from '@/lib/abort'

import { codecDescription } from './codec-description'
import { readMp4 } from './mp4-demux'
import type { Mp4Media, Mp4Sample, Mp4Track } from './mp4-media'
import { videoTrack } from './mp4-media'
import { writeMp4 } from './mp4-mux'
import { drainSamples, keepOnlyTrack } from './mp4-samples'
import type { Mp4BoxLoader } from './mp4-runtime'
import type { ProgressCallback } from './types'
import { planVideoEncode } from './video-config'
import type { VideoOptions } from './video-options'
import {
  browserVideoCodecs,
  type EncodedChunkLike,
  type EncodedChunkMetadata,
  type VideoCodecs,
  type VideoCodecsLoader,
} from './webcodecs-runtime'

/** WebCodecs timestamps are microseconds; an output track is written in them. */
const MICROSECONDS = 1_000_000

/**
 * How many frames may be in flight before the loop waits.
 *
 * Enough to keep a hardware encoder fed across the gap between two decoded
 * frames, and few enough that the live set stays a handful of surfaces. Both
 * codecs get the same allowance because they run at similar rates and the slower
 * one is what the wait ends up tracking.
 */
const QUEUE_LIMIT = 8

/** Share of the bar spent reading the container before a codec starts. */
const DEMUXED = 0.1
/** Share spent transcoding; the rest is writing the container back out. */
const ENCODED = 0.9

export interface VideoTranscodeDependencies {
  codecs?: VideoCodecsLoader
  loadMp4Box?: Mp4BoxLoader
}

/**
 * Transcodes the video track of `bytes` and returns a new MP4.
 *
 * Audio is deliberately not carried: it needs its own decoder and encoder, which
 * is issue #48, and silently dropping a soundtrack would be worse than saying
 * so. Until that lands the engine only claims jobs where losing it is the point.
 */
export async function transcodeVideo(
  bytes: Uint8Array,
  options: VideoOptions | undefined,
  signal: AbortSignal,
  onProgress: ProgressCallback,
  dependencies: VideoTranscodeDependencies = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const { codecs = browserVideoCodecs, loadMp4Box } = dependencies

  throwIfAborted(signal)
  // Reading a container reports nothing until its index is parsed, which on a
  // large file is a second or two of silence.
  onProgress(-1)

  const media = await readMp4(bytes, signal, loadMp4Box)
  const source = videoTrack(media)
  if (source === undefined) throw noVideoTrack(media)
  // Everything the demuxer read that this path will not: a soundtrack, most
  // often, which is dropped rather than carried (see the note on this
  // function) and has no business staying resident while the codecs run.
  keepOnlyTrack(media, source)

  onProgress(DEMUXED)

  const platform = codecs()
  const encoderConfig = await planVideoEncode(
    source.format,
    source.samples,
    options,
    platform.isEncoderConfigSupported,
  )
  throwIfAborted(signal)

  const encoded = await run(platform, source, encoderConfig, signal, (fraction) =>
    onProgress(DEMUXED + (ENCODED - DEMUXED) * fraction),
  )

  const written = await writeMp4(
    {
      tracks: [
        {
          id: 1,
          kind: 'video',
          format: {
            codec: encoderConfig.codec,
            timescale: MICROSECONDS,
            description: encoded.description,
            descriptionType: encoded.description === undefined ? undefined : 'avcC',
            width: encoderConfig.width,
            height: encoderConfig.height,
            language: source.format.language,
          },
          samples: encoded.samples,
        },
      ],
    },
    signal,
    loadMp4Box,
  )

  onProgress(1)

  return written
}

interface Encoded {
  samples: Mp4Sample[]
  /** The `avcC` box the encoder produced, ready for the muxer. */
  description?: Uint8Array
}

/**
 * Drives one decoder and one encoder from end to end.
 *
 * Both are closed in the `finally`, including on a cancel: a codec left open
 * holds a hardware session that the next job cannot get.
 */
async function run(
  platform: VideoCodecs,
  source: Mp4Track,
  encoderConfig: Awaited<ReturnType<typeof planVideoEncode>>,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<Encoded> {
  const samples: Mp4Sample[] = []
  let description: Uint8Array | undefined
  let dts = 0
  let failure: Error | null = null

  const encoder = platform.createEncoder({
    output: (chunk, metadata) => {
      description ??= configurationRecord(metadata)
      samples.push(toSample(chunk, dts))
      dts += chunk.duration ?? 0
    },
    error: (reason) => {
      failure ??= reason
    },
  })

  const decoder = platform.createDecoder({
    output: (frame) => {
      try {
        encoder.encode(frame)
      } finally {
        // A frame is a GPU surface. Closing it in a `finally` rather than after
        // the encode is what stops one rejected frame leaking the rest.
        frame.close()
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
      codedWidth: source.format.width,
      codedHeight: source.format.height,
      description: codecDescription(source.format),
    })

    // Released sample by sample rather than iterated: the encoded output is
    // accumulating in `samples` above at roughly the rate the source is being
    // consumed, and holding both whole is the copy `MEMORY.webcodecs` would
    // otherwise have to price. See `./mp4-samples`.
    const stream = drainSamples(source)
    let done = 0

    for (const sample of stream.samples) {
      throwIfAborted(signal)
      if (failure !== null) throw failure

      decoder.decode(platform.encodedChunk(toChunkInit(sample, source.format.timescale)))
      await drain(decoder, encoder)

      done += 1
      onProgress(done / Math.max(stream.total, 1))
    }

    await decoder.flush()
    await encoder.flush()
    throwIfAborted(signal)
    if (failure !== null) throw failure

    return { samples, description }
  } finally {
    close(decoder)
    close(encoder)
  }
}

/** Waits until both codecs have room, so the queue never becomes the memory model. */
async function drain(
  decoder: { readonly decodeQueueSize: number },
  encoder: { readonly encodeQueueSize: number },
): Promise<void> {
  while (decoder.decodeQueueSize > QUEUE_LIMIT || encoder.encodeQueueSize > QUEUE_LIMIT) {
    // A macrotask, not a microtask: a codec reports its progress from the event
    // loop, and a promise chain would spin without ever letting it run — the
    // same reason a cancel needs one, recorded in the agent memory as
    // `cancel-needs-a-macrotask-yield`.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  }
}

function toChunkInit(sample: Mp4Sample, timescale: number) {
  return {
    type: sample.isSync ? ('key' as const) : ('delta' as const),
    timestamp: Math.round((sample.cts * MICROSECONDS) / timescale),
    duration: Math.round((sample.duration * MICROSECONDS) / timescale),
    data: sample.data,
  }
}

function toSample(chunk: EncodedChunkLike, dts: number): Mp4Sample {
  const data = new Uint8Array(chunk.byteLength)
  chunk.copyTo(data)

  return {
    data,
    dts,
    cts: chunk.timestamp,
    duration: chunk.duration ?? 0,
    isSync: chunk.type === 'key',
  }
}

/**
 * The `avcC` the encoder hands over with its first chunk.
 *
 * WebCodecs gives the decoder configuration as a *record* — the payload — while
 * a container stores it as a box, so the eight-byte header is put back here.
 * That keeps `Mp4TrackFormat.description` meaning one thing everywhere: the
 * complete box.
 */
function configurationRecord(metadata: EncodedChunkMetadata): Uint8Array | undefined {
  const record = metadata.decoderConfig?.description
  if (record === undefined) return undefined

  const payload =
    record instanceof ArrayBuffer
      ? new Uint8Array(record)
      : new Uint8Array(record.buffer, record.byteOffset, record.byteLength)

  const box = new Uint8Array(8 + payload.length)
  new DataView(box.buffer).setUint32(0, box.length)
  box.set([0x61, 0x76, 0x63, 0x43], 4) // 'avcC'
  box.set(payload, 8)

  return box
}

/** Closing a codec that is already closed throws; nothing here cares if it was. */
function close(codec: { close(): void }): void {
  try {
    codec.close()
  } catch {
    // Already closed, or closed by its own error. Either way there is nothing
    // to release and nothing to report.
  }
}

function noVideoTrack(media: Mp4Media): Error {
  return media.tracks.length === 0
    ? new Error('There is no video in this file, so there is nothing to convert.')
    : new Error(
        'This file has sound but no picture. Converting it as video would produce an empty ' +
          'screen; use the audio converter instead.',
      )
}
