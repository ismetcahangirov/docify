// @vitest-environment node

/**
 * The demuxer and the muxer are checked against mp4box directly, not only
 * against each other.
 *
 * A round trip through our own two modules would pass just as happily if both
 * agreed on something the format does not say, so each direction is also driven
 * against a file the library itself built or read. `buildDirectly` is an
 * independent writer and `readDirectly` an independent reader.
 */

import { describe, expect, it } from 'vitest'

import { readMp4 } from '@/lib/engines/mp4-demux'
import type { Mp4Media, Mp4Sample } from '@/lib/engines/mp4-media'
import { audioTrack, videoTrack } from '@/lib/engines/mp4-media'
import { sampleEntryType, writeMp4 } from '@/lib/engines/mp4-mux'
import { BIG_ENDIAN, type Mp4BoxModule, rawBox, writtenBytes } from '@/lib/engines/mp4-runtime'

const load = async (): Promise<Mp4BoxModule> => (await import('mp4box')) as unknown as Mp4BoxModule

const running = () => new AbortController().signal

const VIDEO_TIMESCALE = 90_000
const AUDIO_TIMESCALE = 44_100

/**
 * A complete `avcC` box: header, then an AVC decoder configuration record for
 * H.264 High profile at level 3.1 with one parameter set of each kind.
 *
 * Its contents are never read by anything under test — that is the point. It is
 * here so the assertion can be that these exact bytes come back.
 */
const AVC_CONFIG = new Uint8Array([
  0, 0, 0, 27, 0x61, 0x76, 0x63, 0x43, 1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x1f, 1,
  0, 4, 0x68, 0xee, 0x3c, 0xb0,
])

/**
 * A complete `esds` box wrapping an AudioSpecificConfig for AAC-LC, 44.1 kHz,
 * stereo.
 *
 * Built here rather than imported because nothing in the app writes one: the
 * muxer carries whatever box it was handed, and this is what a real AAC track
 * hands it. The nesting is ISO/IEC 14496-1's descriptor tree — an ES descriptor
 * holding a decoder configuration holding the codec's own two bytes.
 */
function esdsBox(audioSpecificConfig: readonly number[]): Uint8Array {
  const specific = [0x05, audioSpecificConfig.length, ...audioSpecificConfig]
  // 0x40 = MPEG-4 audio, 0x15 = an audio elementary stream.
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

/** Encoded bytes that are not a real frame, and never need to be. */
const payload = (seed: number, length = 16) => new Uint8Array(length).fill(seed)

function videoSamples(count: number): Mp4Sample[] {
  return Array.from({ length: count }, (_, index) => ({
    data: payload(index + 1),
    dts: index * 3000,
    // One frame of reordering, which is what a B-frame looks like from here and
    // the reason both timestamps are carried.
    cts: index * 3000 + (index % 2 === 0 ? 0 : 3000),
    duration: 3000,
    isSync: index === 0,
  }))
}

const videoMedia = (samples = videoSamples(4)): Mp4Media => ({
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
      samples,
    },
  ],
})

const audioMedia = (): Mp4Media => ({
  tracks: [
    {
      id: 1,
      kind: 'audio',
      format: {
        codec: 'mp4a.40.2',
        timescale: AUDIO_TIMESCALE,
        description: AAC_CONFIG,
        descriptionType: 'esds',
        channelCount: 2,
        sampleRate: AUDIO_TIMESCALE,
        language: 'und',
      },
      samples: Array.from({ length: 3 }, (_, index) => ({
        data: payload(index + 10, 8),
        dts: index * 1024,
        cts: index * 1024,
        duration: 1024,
        isSync: true,
      })),
    },
  ],
})

/** An MP4 written by mp4box itself, with none of our muxer involved. */
async function buildDirectly(): Promise<Uint8Array> {
  const mp4 = await load()
  const file = mp4.createFile()

  const trackId = file.addTrack({
    type: 'avc1',
    timescale: VIDEO_TIMESCALE,
    width: 320,
    height: 240,
    language: 'und',
    description_boxes: [rawBox(AVC_CONFIG, 'avcC')],
  })

  for (const sample of videoSamples(2)) {
    file.addSample(trackId, sample.data, {
      duration: sample.duration,
      dts: sample.dts,
      cts: sample.cts,
      is_sync: sample.isSync,
    })
  }

  return writtenBytes(file)
}

/** What mp4box makes of a file, with none of our demuxer involved. */
async function readDirectly(
  bytes: Uint8Array,
): Promise<{ codec: string; timescale: number; sampleCount: number; description: Uint8Array }> {
  const mp4 = await load()
  const file = mp4.createFile()

  let answer: {
    codec: string
    timescale: number
    sampleCount: number
    description: Uint8Array
  } | null = null

  file.onReady = (info) => {
    const track = info.tracks[0]
    const entry = file.getTrackById(track.id)?.mdia.minf.stbl.stsd.entries[0]
    const configuration = entry?.boxes[0]
    const stream = new mp4.DataStream(undefined, 0, BIG_ENDIAN)
    configuration?.write(stream)

    answer = {
      codec: track.codec,
      timescale: track.timescale,
      sampleCount: track.nb_samples,
      description: new Uint8Array(stream.buffer),
    }
  }

  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  file.appendBuffer(mp4.MP4BoxBuffer.fromArrayBuffer(copy.buffer, 0))
  file.flush()

  if (answer === null) throw new Error('mp4box did not recognise the file')

  return answer
}

describe('writeMp4', () => {
  it('produces a file mp4box reads back with the track it was given', async () => {
    const bytes = await writeMp4(videoMedia(), running(), load)

    const read = await readDirectly(bytes)

    expect(read.codec).toBe('avc1.64001f')
    expect(read.timescale).toBe(VIDEO_TIMESCALE)
    expect(read.sampleCount).toBe(4)
  })

  it('puts the codec configuration back byte for byte', async () => {
    // The promise the whole layer rests on. Nothing here understands an `avcC`;
    // carrying it unchanged is what makes a container conversion lossless.
    const bytes = await writeMp4(videoMedia(), running(), load)

    expect((await readDirectly(bytes)).description).toEqual(AVC_CONFIG)
  })

  it('refuses to write a container with nothing in it', async () => {
    await expect(writeMp4({ tracks: [] }, running(), load)).rejects.toThrow(/nothing to write/)
  })

  it('stops when the job is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(writeMp4(videoMedia(), controller.signal, load)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('readMp4', () => {
  it('reads a file mp4box wrote, without our muxer in the loop', async () => {
    const media = await readMp4(await buildDirectly(), running(), load)
    const track = videoTrack(media)

    expect(track?.format.codec).toBe('avc1.64001f')
    expect(track?.format.timescale).toBe(VIDEO_TIMESCALE)
    expect(track?.format.width).toBe(320)
    expect(track?.format.height).toBe(240)
    expect(track?.samples).toHaveLength(2)
  })

  it('hands back the configuration box whole, header included', async () => {
    const media = await readMp4(await buildDirectly(), running(), load)

    expect(videoTrack(media)?.format.description).toEqual(AVC_CONFIG)
    expect(videoTrack(media)?.format.descriptionType).toBe('avcC')
  })

  it('explains a file it cannot parse rather than resolving with nothing', async () => {
    await expect(
      readMp4(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), running(), load),
    ).rejects.toThrow(/could not be read/)
  })

  it('refuses a job that was cancelled before it started', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(readMp4(await buildDirectly(), controller.signal, load)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('a round trip through both', () => {
  it('returns every video sample with its timestamps and its keyframe flag', async () => {
    const original = videoMedia()

    const media = await readMp4(await writeMp4(original, running(), load), running(), load)

    expect(videoTrack(media)?.samples).toEqual(original.tracks[0].samples)
  })

  it('keeps composition and decode timestamps apart, as a reordered stream needs', async () => {
    const media = await readMp4(await writeMp4(videoMedia(), running(), load), running(), load)
    const samples = videoTrack(media)?.samples ?? []

    // Sample 1 is displayed a frame after it is decoded. Collapsing the two
    // would play a B-frame stream in the wrong order.
    expect(samples[1].dts).toBe(3000)
    expect(samples[1].cts).toBe(6000)
    // One keyframe at the front and nothing after it, which is what the fixture
    // declares: a flag invented on the way through would make a seek land on a
    // frame that cannot be decoded on its own.
    expect(samples.map((sample) => sample.isSync)).toEqual([true, false, false, false])
  })

  it('carries an AAC track, whose configuration is a descriptor tree', async () => {
    const original = audioMedia()

    const media = await readMp4(await writeMp4(original, running(), load), running(), load)
    const track = audioTrack(media)

    // The codec string comes back complete — `mp4a.40.2` rather than a bare
    // `mp4a` — which is only possible if the descriptor survived intact.
    expect(track?.format.codec).toBe('mp4a.40.2')
    expect(track?.format.channelCount).toBe(2)
    expect(track?.format.sampleRate).toBe(AUDIO_TIMESCALE)
    expect(track?.format.description).toEqual(AAC_CONFIG)
    expect(track?.samples).toEqual(original.tracks[0].samples)
  })

  it('carries video and audio together, each in its own timescale', async () => {
    const media: Mp4Media = { tracks: [...videoMedia().tracks, ...audioMedia().tracks] }

    const read = await readMp4(await writeMp4(media, running(), load), running(), load)

    expect(read.tracks).toHaveLength(2)
    expect(videoTrack(read)?.format.timescale).toBe(VIDEO_TIMESCALE)
    expect(audioTrack(read)?.format.timescale).toBe(AUDIO_TIMESCALE)
  })

  it('does not label every file French, which is mp4box’s own default', async () => {
    const media = await readMp4(await writeMp4(videoMedia(), running(), load), running(), load)

    expect(videoTrack(media)?.format.language).toBe('und')
  })
})

describe('sampleEntryType', () => {
  it('takes the four-character code off the front of an RFC 6381 string', () => {
    expect(sampleEntryType('avc1.64001f')).toBe('avc1')
    expect(sampleEntryType('mp4a.40.2')).toBe('mp4a')
    expect(sampleEntryType('hvc1.1.6.L93.B0')).toBe('hvc1')
    // A codec nothing here has heard of still round-trips, which is the point of
    // reading the string rather than keeping a table.
    expect(sampleEntryType('vp09.00.10.08')).toBe('vp09')
  })

  it('accepts a bare code, which is already the answer', () => {
    expect(sampleEntryType('mp4a')).toBe('mp4a')
  })

  it('refuses something that is not a codec string at all', () => {
    expect(() => sampleEntryType('h264')).not.toThrow()
    expect(() => sampleEntryType('mp3')).toThrow(/not a codec/)
    expect(() => sampleEntryType('')).toThrow(/not a codec/)
  })
})
