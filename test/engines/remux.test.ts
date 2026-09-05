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

/**
 * A complete `esds` box wrapping an AudioSpecificConfig.
 *
 * `objectType` is the object type indication: `0x40` is MPEG-4 audio, which in
 * practice means AAC, and `0x6b` is MPEG-1 audio, which is MP3 inside an `mp4a`
 * sample entry.
 */
function esdsBox(audioSpecificConfig: readonly number[], objectType = 0x40): Uint8Array {
  const specific = [0x05, audioSpecificConfig.length, ...audioSpecificConfig]
  const decoder = [
    0x04,
    13 + specific.length,
    objectType,
    0x15,
    ...new Array(11).fill(0),
    ...specific,
  ]
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

/**
 * A complete `dac3` box: the three-byte AC3SpecificBox a Dolby Digital track
 * carries, header and all.
 *
 * Its contents are never read here either. It exists so that the container
 * change can be asserted to put these exact bytes back, the same way `avcC` is.
 */
const AC3_CONFIG = new Uint8Array([0, 0, 0, 11, 0x64, 0x61, 0x63, 0x33, 0x50, 0x11, 0x40])

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

/**
 * A TV capture: the same film with an AC-3 soundtrack instead of an AAC one.
 *
 * The case issue #277 is about. Nothing in the router can see inside a file, so
 * a Dolby Digital track reaches the copy path exactly as an AAC one does and
 * has to be turned away where the file is open.
 */
function ac3Movie(): Mp4Media {
  const [video, audio] = movie().tracks

  return {
    tracks: [
      video,
      {
        ...audio,
        format: {
          ...audio.format,
          codec: 'ac-3',
          description: AC3_CONFIG,
          descriptionType: 'dac3',
        },
      },
    ],
  }
}

/** The same film with MP3 inside its `mp4a` sample entry, which a `.6b` says. */
function mp3InMp4Movie(): Mp4Media {
  const [video, audio] = movie().tracks

  return {
    tracks: [
      video,
      { ...audio, format: { ...audio.format, description: esdsBox([0x12, 0x10], 0x6b) } },
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

  it('claims a plain conversion into M4A, which is the same extraction by another name', () => {
    // The catalogue pages are keyed on the format pair and every one of them
    // asks for `convert` (issue #266). "MP4 to M4A" is the sound alone in its
    // own container whatever the op says, and a copy is the only honest way to
    // do it.
    expect(descriptor.supports(task('mp4', 'm4a', 'convert'), desktop)).toBe(true)
    expect(descriptor.supports(task('mov', 'm4a', 'convert'), desktop)).toBe(true)
    expect(descriptor.supports(task('mp4', 'm4a', 'convert'), codecless)).toBe(true)
  })

  it('still leaves a conversion into an encoded audio format alone', () => {
    for (const to of ['mp3', 'wav', 'flac', 'ogg', 'aac'] as const) {
      expect(descriptor.supports(task('mp4', to, 'convert'), desktop)).toBe(false)
    }
  })

  it('does not claim a compression into M4A, which carries a setting it cannot honour', () => {
    expect(descriptor.supports(task('mp4', 'm4a', 'compress'), desktop)).toBe(false)
  })

  it('claims a container change between the two ISO brands', () => {
    // MOV and MP4 are the same box structure with a different brand on it, so
    // the whole conversion is a rewrite of the index.
    expect(descriptor.supports(task('mov', 'mp4', 'convert'), desktop)).toBe(true)
    expect(descriptor.supports(task('mp4', 'mov', 'convert'), desktop)).toBe(true)
  })

  it('claims it on a device with no codecs, which is the point of a copy', () => {
    expect(descriptor.supports(task('mov', 'mp4', 'convert'), codecless)).toBe(true)
  })

  it('leaves the containers that are not the ISO structure alone', () => {
    for (const format of ['webm', 'mkv', 'avi'] as const) {
      expect(descriptor.supports(task(format, 'mp4', 'convert'), desktop)).toBe(false)
      expect(descriptor.supports(task('mp4', format, 'convert'), desktop)).toBe(false)
    }
  })

  it('does not claim a conversion with no container to change', () => {
    // Nothing to copy into: the job is asking for something else, and an
    // engine that re-encodes should answer it.
    expect(descriptor.supports(task('mp4', 'mp4', 'convert'), desktop)).toBe(false)
    expect(descriptor.supports(task('mov', 'mov', 'convert'), desktop)).toBe(false)
  })

  it('never claims an operation that carries settings it cannot honour', () => {
    // A target size, a quality or a width all mean re-encoding, and a copy has
    // no encoder in it. Claiming these would silently discard what the user
    // chose in the panel they just filled in.
    for (const op of ['compress', 'resize', 'crop', 'rotate'] as const) {
      expect(descriptor.supports(task('mov', 'mp4', op), desktop)).toBe(false)
    }
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

  it('does the same for a `convert` into M4A: the picture goes, the sound stays', async () => {
    // What a catalogue page sends (issue #266). Deciding by the target rather
    // than the op is what keeps the file from coming back as a silent movie in
    // an audio container.
    const audio = audioSamples(8)
    const source = await movieFile(movie(videoSamples(6), audio))

    const result = await createRunner().run(input([source], 'm4a', 'convert'), running(), () => {})
    const read = await readMp4(new Uint8Array(await result.arrayBuffer()), running())

    expect(videoTrack(read)).toBeUndefined()
    expect(result.type).toBe('audio/mp4')
    const track = audioTrack(read)
    expect(track?.samples).toHaveLength(audio.length)
    for (const [index, sample] of audio.entries()) {
      expect(Array.from(track?.samples[index]?.data ?? [])).toEqual(Array.from(sample.data))
    }
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
    // The same sentence for the page's `convert`, which is the same job.
    await expect(
      createRunner().run(input([silent], 'm4a', 'convert'), running(), () => {}),
    ).rejects.toThrow(/no audio/i)
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

describe('the remux runner, handed audio it cannot copy', () => {
  it('refuses an AC-3 soundtrack rather than labelling it audio/mp4', async () => {
    // An M4A is AAC by convention, and a file that says `audio/mp4` while
    // holding Dolby Digital is one most decoders simply refuse to open. A
    // rejection is the honest outcome; a file that does not play is not.
    const source = await movieFile(ac3Movie())

    await expect(createRunner().run(input([source]), running(), () => {})).rejects.toThrow(/AC-3/)
  })

  it('names a target that has an encoder, because a rejection has to say what to do', async () => {
    // CLAUDE.md §2.5: the message and the next step, never one without the
    // other. `convert` is what the catalogue page sends (issue #266).
    const source = await movieFile(ac3Movie())

    await expect(
      createRunner().run(input([source], 'm4a', 'convert'), running(), () => {}),
    ).rejects.toThrow(/MP3 or WAV/)
  })

  it('refuses MP3 wearing an `mp4a` sample entry, which the four-character code hides', async () => {
    // `mp4a` is the entry for everything MPEG-4 describes with an `esds`, not
    // for AAC alone, so the object type is what settles it.
    const source = await movieFile(mp3InMp4Movie())

    // Named, not merely refused: every rejection on this path already suggests
    // MP3, so the assertion has to be about what the file was found to hold.
    await expect(createRunner().run(input([source]), running(), () => {})).rejects.toThrow(
      /sound is MP3/,
    )
  })

  it('refuses a second soundtrack it cannot copy, not only the first', async () => {
    // Both audio tracks are copied into the M4A, so one unplayable track is
    // enough to make the file unplayable.
    const [video, aac] = movie().tracks
    const [, ac3] = ac3Movie().tracks
    const source = await movieFile({ tracks: [video, aac, { ...ac3, id: 3 }] })

    await expect(createRunner().run(input([source]), running(), () => {})).rejects.toThrow(/AC-3/)
  })

  it('still copies an AAC soundtrack, which is the whole point of the path', async () => {
    const result = await createRunner().run(input([await movieFile()]), running(), () => {})

    expect(result.type).toBe('audio/mp4')
  })
})

describe('the remux runner, changing the container', () => {
  const container = (to: FormatId): EngineInput => ({
    task: task('mov', to, 'convert'),
    files: [],
  })

  const convert = async (to: FormatId, media = movie()) => {
    const source = await movieFile(media)

    return createRunner().run({ ...container(to), files: [source] }, running(), () => {})
  }

  it('keeps both tracks, which is what a container change means', async () => {
    const result = await convert('mp4')
    const read = await readMp4(new Uint8Array(await result.arrayBuffer()), running())

    expect(videoTrack(read)).toBeDefined()
    expect(audioTrack(read)).toBeDefined()
  })

  it('copies every picture sample byte for byte, without a codec in the path', async () => {
    const video = videoSamples(6)
    const result = await convert('mp4', movie(video, audioSamples(8)))
    const track = videoTrack(await readMp4(new Uint8Array(await result.arrayBuffer()), running()))

    expect(track?.samples).toHaveLength(video.length)
    for (const [index, sample] of video.entries()) {
      expect(Array.from(track?.samples[index]?.data ?? [])).toEqual(Array.from(sample.data))
      // Both timestamps, because a codec that reorders frames needs both and a
      // copy that dropped one would silently reorder the picture.
      expect(track?.samples[index]?.dts).toBe(sample.dts)
      expect(track?.samples[index]?.cts).toBe(sample.cts)
      expect(track?.samples[index]?.isSync).toBe(sample.isSync)
    }
  })

  it('puts the codec configuration back as the exact box it came out of', async () => {
    const result = await convert('mp4')
    const track = videoTrack(await readMp4(new Uint8Array(await result.arrayBuffer()), running()))

    // Nothing in this project knows what an `avcC` contains, and it does not
    // have to: putting the same bytes back is what makes the copy lossless.
    expect(Array.from(track?.format.description ?? [])).toEqual(Array.from(AVC_CONFIG))
    expect(track?.format.codec).toBe('avc1.64001f')
    expect(track?.format.width).toBe(320)
    expect(track?.format.height).toBe(240)
  })

  it('keeps each track in its own timescale rather than normalising them', async () => {
    const result = await convert('mp4')
    const read = await readMp4(new Uint8Array(await result.arrayBuffer()), running())

    // Normalising two unrelated timescales to a shared one introduces rounding
    // into a path whose whole promise is that nothing changes.
    expect(videoTrack(read)?.format.timescale).toBe(VIDEO_TIMESCALE)
    expect(audioTrack(read)?.format.timescale).toBe(AUDIO_TIMESCALE)
  })

  it('labels a QuickTime output as QuickTime and an MP4 as an MP4', async () => {
    expect((await convert('mp4')).type).toBe('video/mp4')
    expect((await convert('mov')).type).toBe('video/quicktime')
  })

  it('carries an AC-3 soundtrack across, box and all, because a MOV may hold one', async () => {
    // A container change promises the container and never the codec, so the
    // same track that cannot become an M4A travels into an MP4 untouched — but
    // only if its `dac3` is recognised as a configuration box on the way in.
    const result = await convert('mp4', ac3Movie())
    const track = audioTrack(await readMp4(new Uint8Array(await result.arrayBuffer()), running()))

    expect(track?.format.codec).toBe('ac-3')
    expect(Array.from(track?.format.description ?? [])).toEqual(Array.from(AC3_CONFIG))
  })

  it('carries a silent film across without complaining about the missing sound', async () => {
    const silent = { tracks: [movie().tracks[0]] }
    const result = await convert('mp4', silent)
    const read = await readMp4(new Uint8Array(await result.arrayBuffer()), running())

    expect(videoTrack(read)).toBeDefined()
    expect(audioTrack(read)).toBeUndefined()
  })
})
