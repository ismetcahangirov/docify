// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { transcodeAudio } from '@/lib/engines/audio-transcode'
import { codecDescription } from '@/lib/engines/codec-description'
import { readMp4 } from '@/lib/engines/mp4-demux'
import type { Mp4Media } from '@/lib/engines/mp4-media'
import { audioTrack } from '@/lib/engines/mp4-media'
import { writeMp4 } from '@/lib/engines/mp4-mux'
import type { Mp4BoxModule } from '@/lib/engines/mp4-runtime'

import { fakeAudioCodecs } from './webcodecs-audio-fake'

const loadMp4Box = async (): Promise<Mp4BoxModule> =>
  (await import('mp4box')) as unknown as Mp4BoxModule

const running = () => new AbortController().signal
const quiet = () => {}

const TIMESCALE = 44_100

/** A complete `esds` box wrapping an AudioSpecificConfig, as a real AAC track has. */
function esdsBox(config: readonly number[]): Uint8Array {
  const specific = [0x05, config.length, ...config]
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

/** An M4A with one AAC track of `count` packets. */
async function sourceFile(count = 4) {
  const media: Mp4Media = {
    tracks: [
      {
        id: 1,
        kind: 'audio',
        format: {
          codec: 'mp4a.40.2',
          timescale: TIMESCALE,
          description: AAC_CONFIG,
          descriptionType: 'esds',
          channelCount: 2,
          sampleRate: TIMESCALE,
          language: 'und',
        },
        samples: Array.from({ length: count }, (_, index) => ({
          data: new Uint8Array(16).fill(index + 1),
          dts: index * 1024,
          cts: index * 1024,
          duration: 1024,
          isSync: true,
        })),
      },
    ],
  }

  return writeMp4(media, running(), loadMp4Box)
}

/** An MP4 with a picture and no sound. */
async function videoOnlyFile() {
  return writeMp4(
    {
      tracks: [
        {
          id: 1,
          kind: 'video',
          format: {
            codec: 'avc1.64001f',
            timescale: 90_000,
            width: 320,
            height: 240,
            description: new Uint8Array([
              0, 0, 0, 27, 0x61, 0x76, 0x63, 0x43, 1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x64,
              0, 0x1f, 1, 0, 4, 0x68, 0xee, 0x3c, 0xb0,
            ]),
            descriptionType: 'avcC',
          },
          samples: [{ data: new Uint8Array(16), dts: 0, cts: 0, duration: 3000, isSync: true }],
        },
      ],
    },
    running(),
    loadMp4Box,
  )
}

const run = async (
  bytes: Uint8Array,
  to: 'm4a' | 'ogg' | 'mp4',
  codecs: ReturnType<typeof fakeAudioCodecs>,
  options = {},
) => transcodeAudio(bytes, to, options, running(), quiet, { codecs: () => codecs, loadMp4Box })

describe('transcodeAudio', () => {
  it('asks the browser before configuring the encoder, never after', async () => {
    const codecs = fakeAudioCodecs()

    await run(await sourceFile(2), 'm4a', codecs)

    expect(codecs.asked).toHaveLength(1)
    expect(codecs.encoderConfig?.codec).toBe('mp4a.40.2')
  })

  it('fails before reading a packet when the codec is refused', async () => {
    const codecs = fakeAudioCodecs()
    codecs.accept = () => false

    await expect(run(await sourceFile(2), 'm4a', codecs)).rejects.toThrow(/cannot encode mp4a/)
    expect(codecs.decoded).toEqual([])
  })

  it('hands the decoder the AudioSpecificConfig, not the descriptor tree around it', async () => {
    const codecs = fakeAudioCodecs()

    await run(await sourceFile(2), 'm4a', codecs)

    expect(codecs.decoderConfig?.description).toEqual(new Uint8Array([0x12, 0x10]))
    expect(codecs.decoderConfig?.sampleRate).toBe(TIMESCALE)
    expect(codecs.decoderConfig?.numberOfChannels).toBe(2)
  })

  it('writes AAC back into an ISO container, with a readable esds', async () => {
    const codecs = fakeAudioCodecs()

    const output = await run(await sourceFile(3), 'm4a', codecs)
    const media = await readMp4(output.bytes, running(), loadMp4Box)
    const track = audioTrack(media)

    // `mp4a.40.2` rather than a bare `mp4a` is the proof: mp4box only reports
    // the full codec string when it could read the descriptor tree back.
    expect(track?.format.codec).toBe('mp4a.40.2')
    expect(track?.samples).toHaveLength(3)
    expect(codecDescription(track!.format)).toEqual(codecs.configurationRecord)
    expect(output.mimeType).toBe('audio/mp4')
  })

  it('writes the ISO track in microseconds, so nothing is converted twice', async () => {
    const codecs = fakeAudioCodecs()

    const output = await run(await sourceFile(3), 'm4a', codecs)
    const media = await readMp4(output.bytes, running(), loadMp4Box)

    // 1024 samples at 44.1 kHz is 23 220 microseconds.
    expect(audioTrack(media)?.format.timescale).toBe(1_000_000)
    expect(audioTrack(media)?.samples[1].cts).toBe(23_220)
  })

  it('writes Opus into an Ogg stream, at the 48 kHz the codec insists on', async () => {
    const codecs = fakeAudioCodecs()

    const output = await run(await sourceFile(3), 'ogg', codecs)

    expect(codecs.encoderConfig?.codec).toBe('opus')
    // Asking an Opus encoder for the source's 44.1 kHz produces a configuration
    // every browser refuses; the codec always decodes at 48 kHz.
    expect(codecs.encoderConfig?.sampleRate).toBe(48_000)
    expect(String.fromCharCode(...output.bytes.subarray(0, 4))).toBe('OggS')
    expect(output.mimeType).toBe('audio/ogg')
  })

  it('takes the job’s bitrate and channel count when it names them', async () => {
    const codecs = fakeAudioCodecs()

    await run(await sourceFile(2), 'm4a', codecs, { bitrate: 128_000, channels: 1 })

    expect(codecs.encoderConfig?.bitrate).toBe(128_000)
    expect(codecs.encoderConfig?.numberOfChannels).toBe(1)
  })

  it('derives a bitrate per channel when the job names none', async () => {
    const codecs = fakeAudioCodecs()

    await run(await sourceFile(2), 'm4a', codecs)

    // 96 kbps a channel, so a stereo track is 192 and a mono podcast is not
    // charged for a second channel it does not have.
    expect(codecs.encoderConfig?.bitrate).toBe(192_000)
  })

  it('closes every decoded block, and both codecs when it is done', async () => {
    const codecs = fakeAudioCodecs()

    await run(await sourceFile(4), 'm4a', codecs)

    expect(codecs.encoded.every((data) => data.closed === 1)).toBe(true)
    expect(codecs.closes).toEqual({ decoder: 1, encoder: 1 })
  })

  it('closes both codecs when one fails part way through', async () => {
    const codecs = fakeAudioCodecs()
    codecs.duringDecode = (index, fail) => {
      if (index === 1) fail(new Error('this packet is not decodable'))
    }

    await expect(run(await sourceFile(6), 'm4a', codecs)).rejects.toThrow(/not decodable/)
    expect(codecs.closes).toEqual({ decoder: 1, encoder: 1 })
  })

  it('explains a file with a picture and no sound', async () => {
    const codecs = fakeAudioCodecs()

    await expect(run(await videoOnlyFile(), 'm4a', codecs)).rejects.toThrow(/picture but no sound/)
  })

  it('says which formats it writes when asked for one it does not', async () => {
    const codecs = fakeAudioCodecs()

    await expect(
      transcodeAudio(await sourceFile(1), 'flac', undefined, running(), quiet, {
        codecs: () => codecs,
        loadMp4Box,
      }),
    ).rejects.toThrow(/cannot write FLAC/)
  })

  it('reports progress from indeterminate to finished', async () => {
    const codecs = fakeAudioCodecs()
    const seen: number[] = []

    await transcodeAudio(await sourceFile(4), 'm4a', undefined, running(), (p) => seen.push(p), {
      codecs: () => codecs,
      loadMp4Box,
    })

    expect(seen[0]).toBe(-1)
    expect(seen.at(-1)).toBe(1)
    expect(seen.slice(1)).toEqual([...seen.slice(1)].sort((a, b) => a - b))
  })

  it('stops mid-stream when the user cancels, and still closes the codecs', async () => {
    const codecs = fakeAudioCodecs()
    const controller = new AbortController()
    codecs.duringDecode = (index) => {
      if (index === 1) controller.abort()
    }

    await expect(
      transcodeAudio(await sourceFile(20), 'm4a', undefined, controller.signal, quiet, {
        codecs: () => codecs,
        loadMp4Box,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(codecs.decoded.length).toBeLessThan(20)
    expect(codecs.closes).toEqual({ decoder: 1, encoder: 1 })
  })
})
