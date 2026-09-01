// @vitest-environment node

/**
 * The stream-copy engine, driven against real mp4box in both directions.
 *
 * A remux is only worth having if it is byte-identical where it claims to be,
 * so the assertions are about the samples themselves — the encoded bytes, the
 * timestamps, the codec configuration box — and not about a file that merely
 * parses. Building the fixture with `writeMp4` and reading the result with
 * `readMp4` puts the library on both ends, which is what makes "the same bytes
 * came back" mean something.
 */

import { describe, expect, it, vi } from 'vitest'

import { readMp4 } from '@/lib/engines/mp4-demux'
import type { Mp4Media, Mp4Sample } from '@/lib/engines/mp4-media'
import { audioTrack, videoTrack } from '@/lib/engines/mp4-media'
import { writeMp4 } from '@/lib/engines/mp4-mux'
import { createRunner, descriptor, REMUX_LOAD_COST } from '@/lib/engines/remux'
import type { EngineInput } from '@/lib/engines/types'
import type { Capabilities, ConversionTask, FormatId, Operation } from '@/lib/router/types'

const desktop: Capabilities = {
  crossOriginIsolated: true,
  wasmSimd: true,
  deviceMemoryGb: 8,
  cores: 8,
  webCodecsVideo: true,
  webCodecsAudio: true,
  offscreenCanvas: true,
  createImageBitmap: true,
  platform: 'desktop',
  browser: 'chromium',
}

/** A device with no codecs at all: a stream copy must not care. */
const codecless: Capabilities = { ...desktop, webCodecsVideo: false, webCodecsAudio: false }

const task = (from: FormatId, to: FormatId, op: Operation = 'extract'): ConversionTask => ({
  from,
  to,
  op,
})

const VIDEO_TIMESCALE = 90_000
const AUDIO_TIMESCALE = 44_100

/** A complete `avcC` box — carried whole, never read. */
const AVC_CONFIG = new Uint8Array([
  0, 0, 0, 27, 0x61, 0x76, 0x63, 0x43, 1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x1f, 1,
  0, 4, 0x68, 0xee, 0x3c, 0xb0,
])

/** A complete `esds` box wrapping an AudioSpecificConfig for AAC-LC, 44.1 kHz stereo. */
function esdsBox(audioSpecificConfig: readonly number[]): Uint8Array {
  const specific = [0x05, audioSpecificConfig.length, ...audioSpecificConfig]
  const decoder = [0x04, 13 + specific.length, 0x40, 0x15, ...new Array(11).fill(0), ...specific]
  const syncLayer = [0x06, 1, 0x02]
  const elementary = [
    0x03,
    3 + decoder.length + syncLayer.length,
    0,
    0,
    0,
    ...decoder,
    ...syncLayer,
  ]
  const payload = [0, 0, 0, 0, ...elementary]
  const size = 8 + payload.length

  return new Uint8Array([
    (size >> 24) & 0xff,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    0x65,
    0x73,
    0x64,
    0x73,
    ...payload,
  ])
}

const AAC_CONFIG = esdsBox([0x12, 0x10])

const payload = (seed: number, length = 24) => new Uint8Array(length).fill(seed)

function videoSamples(count: number): Mp4Sample[] {
  return Array.from({ length: count }, (_, index) => ({
    data: payload(index + 1),
    dts: index * 3000,
    cts: index * 3000 + (index % 2 === 0 ? 0 : 3000),
    duration: 3000,
    isSync: index === 0,
  }))
}

function audioSamples(count: number): Mp4Sample[] {
  return Array.from({ length: count }, (_, index) => ({
    data: payload(0x80 + index, 40),
    dts: index * 1024,
    cts: index * 1024,
    duration: 1024,
    isSync: true,
  }))
}

/** A film: one H.264 track and one AAC track, exactly as a camera writes it. */
function movie(video = videoSamples(6), audio = audioSamples(8)): Mp4Media {
  return {
    tracks: [
      {
        id: 1,
        kind: 'video',
        format: {
          codec: 'avc1.64001f',
          timescale: VIDEO_TIMESCALE,
          description: AVC_CONFIG,
          descriptionType: 'avcC',
          width: 320,
          height: 240,
          language: 'und',
        },
        samples: video,
      },
      {
        id: 2,
        kind: 'audio',
        format: {
          codec: 'mp4a.40.2',
          timescale: AUDIO_TIMESCALE,
          description: AAC_CONFIG,
          descriptionType: 'esds',
          channelCount: 2,
          sampleRate: AUDIO_TIMESCALE,
          language: 'eng',
        },
        samples: audio,
      },
    ],
  }
}

const running = () => new AbortController().signal

async function movieFile(media: Mp4Media = movie()): Promise<Blob> {
  return new Blob([await writeMp4(media, running())], { type: 'video/mp4' })
}

function input(files: Blob[], to: FormatId = 'm4a', op: Operation = 'extract'): EngineInput {
  return { task: task('mp4', to, op), files }
}

describe('the remux descriptor', () => {
  it('outranks every engine that would re-encode the same job', () => {
    expect(descriptor.id).toBe('remux')
    // Ahead of WebCodecs at 15 and ffmpeg at 90: a copy is always better than an
    // encode, and the ordering is the only thing that says so.
    expect(descriptor.priority).toBeLessThan(15)
    expect(descriptor.label).toMatch(/copy/i)
  })

  it('quotes mp4box and nothing else, because it loads no codec', () => {
    expect(descriptor.loadCost).toBe(REMUX_LOAD_COST)
    expect(descriptor.loadCost).toBeLessThan(1_000_000)
  })

  it('claims audio extraction out of the ISO containers it can read', () => {
    expect(descriptor.supports(task('mp4', 'm4a'), desktop)).toBe(true)
    expect(descriptor.supports(task('mov', 'm4a'), desktop)).toBe(true)
  })

  it('claims them on a device with no codecs at all', () => {
    // The whole point: nothing is decoded, so nothing about the browser's
    // encoders can make this job impossible.
    expect(descriptor.supports(task('mp4', 'm4a'), codecless)).toBe(true)
  })

  it('leaves the targets that need an encoder alone', () => {
    // MP3, WAV, FLAC and Ogg all mean re-encoding the samples, which is ffmpeg's
    // job. Claiming them here would route a job to an engine that cannot finish.
    for (const to of ['mp3', 'wav', 'flac', 'ogg', 'aac'] as const) {
      expect(descriptor.supports(task('mp4', to), desktop)).toBe(false)
    }
  })

  it('leaves the containers mp4box cannot read alone', () => {
    for (const from of ['webm', 'mkv', 'avi'] as const) {
      expect(descriptor.supports(task(from, 'm4a'), desktop)).toBe(false)
    }
  })

  it('does not claim a plain conversion — only the extraction it can copy', () => {
    expect(descriptor.supports(task('mp4', 'm4a', 'convert'), desktop)).toBe(false)
    expect(descriptor.supports(task('mp4', 'm4a', 'compress'), desktop)).toBe(false)
  })
})

describe('the remux runner, extracting audio', () => {
  it('returns the audio track and drops the picture', async () => {
    const source = await movieFile()

    const result = await createRunner().run(input([source]), running(), () => {})
    const read = await readMp4(new Uint8Array(await result.arrayBuffer()), running())

    expect(videoTrack(read)).toBeUndefined()
    expect(audioTrack(read)).toBeDefined()
    expect(result.type).toBe('audio/mp4')
  })

  it('copies every sample byte for byte, which is what makes it lossless', async () => {
    const audio = audioSamples(8)
    const source = await movieFile(movie(videoSamples(6), audio))

    const result = await createRunner().run(input([source]), running(), () => {})
    const read = await readMp4(new Uint8Array(await result.arrayBuffer()), running())
    const track = audioTrack(read)

    expect(track?.samples).toHaveLength(audio.length)
    for (const [index, sample] of audio.entries()) {
      expect(Array.from(track?.samples[index]?.data ?? [])).toEqual(Array.from(sample.data))
      expect(track?.samples[index]?.duration).toBe(sample.duration)
    }
  })

  it('keeps the track own timescale and codec configuration', async () => {
    const source = await movieFile()

    const result = await createRunner().run(input([source]), running(), () => {})
    const track = audioTrack(await readMp4(new Uint8Array(await result.arrayBuffer()), running()))

    expect(track?.format.timescale).toBe(AUDIO_TIMESCALE)
    expect(track?.format.codec).toBe('mp4a.40.2')
    expect(track?.format.language).toBe('eng')
    expect(Array.from(track?.format.description ?? [])).toEqual(Array.from(AAC_CONFIG))
  })

  it('never grows the file: an extraction is smaller than what it came from', async () => {
    const source = await movieFile()

    const result = await createRunner().run(input([source]), running(), () => {})

    expect(result.size).toBeLessThan(source.size)
  })

  it('reports indeterminate progress and then completion', async () => {
    const onProgress = vi.fn()

    await createRunner().run(input([await movieFile()]), running(), onProgress)

    expect(onProgress).toHaveBeenCalledWith(-1)
    expect(onProgress).toHaveBeenLastCalledWith(1)
  })

  it('says so when the file has no sound in it', async () => {
    const silent = await movieFile({ tracks: [movie().tracks[0]] })

    await expect(createRunner().run(input([silent]), running(), () => {})).rejects.toThrow(
      /no audio/i,
    )
  })

  it('refuses a job that names more than one file', async () => {
    const two = [await movieFile(), await movieFile()]

    await expect(createRunner().run(input(two), running(), () => {})).rejects.toThrow(/one file/i)
  })

  it('stops before reading anything when the job is already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      createRunner().run(input([await movieFile()]), controller.signal, () => {}),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
