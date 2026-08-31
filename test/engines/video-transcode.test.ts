// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { readMp4 } from '@/lib/engines/mp4-demux'
import type { Mp4Media } from '@/lib/engines/mp4-media'
import { videoTrack } from '@/lib/engines/mp4-media'
import { writeMp4 } from '@/lib/engines/mp4-mux'
import type { Mp4BoxModule } from '@/lib/engines/mp4-runtime'
import { transcodeVideo } from '@/lib/engines/video-transcode'

import { fakeVideoCodecs } from './webcodecs-fake'

const loadMp4Box = async (): Promise<Mp4BoxModule> =>
  (await import('mp4box')) as unknown as Mp4BoxModule

const running = () => new AbortController().signal
const quiet = () => {}

const TIMESCALE = 90_000
const AVC_CONFIG = new Uint8Array([
  0, 0, 0, 27, 0x61, 0x76, 0x63, 0x43, 1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x1f, 1,
  0, 4, 0x68, 0xee, 0x3c, 0xb0,
])

/** An MP4 with one video track of `count` frames at 30 fps. */
async function sourceFile(count = 4, over: Partial<Mp4Media['tracks'][0]['format']> = {}) {
  const media: Mp4Media = {
    tracks: [
      {
        id: 1,
        kind: 'video',
        format: {
          codec: 'avc1.64001f',
          timescale: TIMESCALE,
          description: AVC_CONFIG,
          descriptionType: 'avcC',
          width: 640,
          height: 480,
          language: 'und',
          ...over,
        },
        samples: Array.from({ length: count }, (_, index) => ({
          data: new Uint8Array(16).fill(index + 1),
          dts: index * 3000,
          cts: index * 3000,
          duration: 3000,
          isSync: index === 0,
        })),
      },
    ],
  }

  return writeMp4(media, running(), loadMp4Box)
}

/** An MP4 with sound and no picture. */
async function audioOnlyFile() {
  return writeMp4(
    {
      tracks: [
        {
          id: 1,
          kind: 'audio',
          format: { codec: 'mp4a', timescale: 44_100, channelCount: 2, sampleRate: 44_100 },
          samples: [{ data: new Uint8Array(8), dts: 0, cts: 0, duration: 1024, isSync: true }],
        },
      ],
    },
    running(),
    loadMp4Box,
  )
}

const run = async (bytes: Uint8Array, codecs: ReturnType<typeof fakeVideoCodecs>, options = {}) =>
  transcodeVideo(bytes, options, running(), quiet, { codecs: () => codecs, loadMp4Box })

describe('transcodeVideo', () => {
  it('produces an MP4 whose frames came through the encoder', async () => {
    const codecs = fakeVideoCodecs()

    const output = await run(await sourceFile(4), codecs)
    const media = await readMp4(output, running(), loadMp4Box)

    expect(codecs.decoded).toHaveLength(4)
    expect(codecs.encoded).toHaveLength(4)
    expect(videoTrack(media)?.samples).toHaveLength(4)
  })

  it('asks the browser before configuring the encoder, never after', async () => {
    // The acceptance criterion. `configure()` accepts anything and reports the
    // trouble asynchronously, long after the user has watched a bar move.
    const codecs = fakeVideoCodecs()

    await run(await sourceFile(2), codecs)

    expect(codecs.asked.length).toBeGreaterThan(0)
    expect(codecs.encoderConfig).not.toBeNull()
    expect(codecs.asked[0].hardwareAcceleration).toBe('prefer-hardware')
  })

  it('falls back through the profiles when the first ones are refused', async () => {
    const codecs = fakeVideoCodecs()
    codecs.accept = (codec) => codec === 'avc1.420028'

    await run(await sourceFile(2), codecs)

    expect(codecs.encoderConfig?.codec).toBe('avc1.420028')
    expect(codecs.asked.map((config) => config.codec)).toContain('avc1.640028')
  })

  it('fails before reading a frame when no configuration is supported', async () => {
    const codecs = fakeVideoCodecs()
    codecs.accept = () => false

    await expect(run(await sourceFile(2), codecs)).rejects.toThrow(/cannot encode video/)
    expect(codecs.decoded).toEqual([])
  })

  it('hands the decoder the record out of the container, not the whole box', async () => {
    const codecs = fakeVideoCodecs()

    await run(await sourceFile(2), codecs)

    // The eight-byte box header is the container's; a decoder configured with it
    // reports a `NotSupportedError` that names nothing.
    expect(codecs.decoderConfig?.description).toEqual(AVC_CONFIG.subarray(8))
    expect(codecs.decoderConfig?.codec).toBe('avc1.64001f')
    expect(codecs.decoderConfig?.codedWidth).toBe(640)
  })

  it('converts timestamps into microseconds on the way into the codec', async () => {
    const codecs = fakeVideoCodecs()

    await run(await sourceFile(3), codecs)

    // 3000 ticks at 90 kHz is a thirtieth of a second: 33 333 microseconds.
    expect(codecs.decoded.map((chunk) => chunk.timestamp)).toEqual([0, 33_333, 66_667])
    expect(codecs.decoded[0].type).toBe('key')
    expect(codecs.decoded[1].type).toBe('delta')
  })

  it('writes the output track in microseconds, so nothing is converted twice', async () => {
    const codecs = fakeVideoCodecs()

    const media = await readMp4(await run(await sourceFile(3), codecs), running(), loadMp4Box)

    expect(videoTrack(media)?.format.timescale).toBe(1_000_000)
    expect(videoTrack(media)?.samples.map((sample) => sample.cts)).toEqual([0, 33_333, 66_667])
  })

  it('puts the encoder’s own configuration into the file it writes', async () => {
    const codecs = fakeVideoCodecs()

    const media = await readMp4(await run(await sourceFile(2), codecs), running(), loadMp4Box)

    // WebCodecs reports the record; a container stores a box. The header has to
    // go back on, or the file has a sample entry with no configuration at all.
    expect(videoTrack(media)?.format.description?.subarray(8)).toEqual(codecs.configurationRecord)
    expect(videoTrack(media)?.format.descriptionType).toBe('avcC')
  })

  it('closes every frame it was handed, and both codecs when it is done', async () => {
    // A frame is a GPU surface worth several megabytes. Leaking a clip's worth
    // is how a transcode kills a tab.
    const codecs = fakeVideoCodecs()

    await run(await sourceFile(4), codecs)

    expect(codecs.encoded.every((frame) => frame.closed === 1)).toBe(true)
    expect(codecs.closes).toEqual({ decoder: 1, encoder: 1 })
  })

  it('closes both codecs when a codec fails part way through', async () => {
    const codecs = fakeVideoCodecs()
    codecs.duringDecode = (index, fail) => {
      if (index === 1) fail(new Error('the bitstream is not decodable'))
    }

    await expect(run(await sourceFile(6), codecs)).rejects.toThrow(/not decodable/)

    // A codec left open holds a hardware session the next job cannot get.
    expect(codecs.closes).toEqual({ decoder: 1, encoder: 1 })
  })

  it('resizes when the job asks, and tells the encoder the new size', async () => {
    const codecs = fakeVideoCodecs()

    const media = await readMp4(
      await run(await sourceFile(2), codecs, { width: 320 }),
      running(),
      loadMp4Box,
    )

    expect(codecs.encoderConfig?.width).toBe(320)
    expect(codecs.encoderConfig?.height).toBe(240)
    expect(videoTrack(media)?.format.width).toBe(320)
  })

  it('explains a file with sound and no picture', async () => {
    const codecs = fakeVideoCodecs()

    await expect(run(await audioOnlyFile(), codecs)).rejects.toThrow(/sound but no picture/)
  })

  it('reports progress from indeterminate to finished', async () => {
    const codecs = fakeVideoCodecs()
    const seen: number[] = []

    await transcodeVideo(await sourceFile(4), undefined, running(), (p) => seen.push(p), {
      codecs: () => codecs,
      loadMp4Box,
    })

    expect(seen[0]).toBe(-1)
    expect(seen.at(-1)).toBe(1)
    expect(seen.slice(1)).toEqual([...seen.slice(1)].sort((a, b) => a - b))
  })

  it('stops when the job is cancelled before it starts', async () => {
    const codecs = fakeVideoCodecs()
    const controller = new AbortController()
    controller.abort()

    await expect(
      transcodeVideo(await sourceFile(2), undefined, controller.signal, quiet, {
        codecs: () => codecs,
        loadMp4Box,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stops mid-stream when the user cancels, and still closes the codecs', async () => {
    const codecs = fakeVideoCodecs()
    const controller = new AbortController()
    codecs.duringDecode = (index) => {
      if (index === 1) controller.abort()
    }

    await expect(
      transcodeVideo(await sourceFile(20), undefined, controller.signal, quiet, {
        codecs: () => codecs,
        loadMp4Box,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(codecs.decoded.length).toBeLessThan(20)
    expect(codecs.closes).toEqual({ decoder: 1, encoder: 1 })
  })
})
