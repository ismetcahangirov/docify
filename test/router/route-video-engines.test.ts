// @vitest-environment node
//
// Deliberately not jsdom, for the reason `route-pdf-engines.test.ts` gives:
// `route()` may look at nothing but its three arguments, so a `window` read
// inside it has to throw here rather than pass quietly.
//
// The real WebCodecs descriptor against the real budget model — the counterpart
// CLAUDE.md §5.4 requires for the suites that run on fakes.

import { describe, expect, it, vi } from 'vitest'

import { descriptor as realFfmpeg } from '@/lib/engines/ffmpeg'
import { descriptor as realRemux } from '@/lib/engines/remux'
import { descriptor as realWebCodecs } from '@/lib/engines/webcodecs'
import { route } from '@/lib/router/route'
import type { ConversionTask } from '@/lib/router/types'

import {
  chosen,
  desktop,
  ffmpeg,
  ios,
  MB,
  refused,
  register,
  resetRegistryBetweenTests,
} from './support/route-harness'

vi.mock('@/lib/engines/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engines/registry')>()

  return (await import('./support/route-harness')).mockedRegistry(actual)
})

resetRegistryBetweenTests()

const movToMp4: ConversionTask = { from: 'mov', to: 'mp4', op: 'convert' }
const shrinkMp4: ConversionTask = { from: 'mp4', to: 'mp4', op: 'compress' }
const mp4ToWebm: ConversionTask = { from: 'mp4', to: 'webm', op: 'convert' }

/**
 * An iPhone new enough to have the codecs.
 *
 * The harness's own `ios` predates them, which is the right default for the
 * suites that check what happens without them — but it makes every budget
 * assertion here about ffmpeg instead.
 */
const iphone = { ...ios, webCodecsVideo: true }

describe('route — the real WebCodecs descriptor', () => {
  it('wins the ISO container pairs outright, ahead of ffmpeg', () => {
    register(realWebCodecs, ffmpeg())

    const result = chosen(route(movToMp4, 50 * MB, desktop))

    expect(result.engine).toBe('webcodecs')
    // The hardware path, chosen for the hardware and not for the download —
    // though it is also a two-hundredth of ffmpeg's size.
    expect(result.loadCost).toBeLessThan(1 * MB)
  })

  it('warns about nothing but the re-encode, since it downloads almost nothing', () => {
    register(realWebCodecs)

    const codes = chosen(route(movToMp4, 50 * MB, desktop)).warnings.map((warning) => warning.code)

    // No SLOW_PATH: that warning is ffmpeg's, and it would be a lie here.
    expect(codes).toEqual(['QUALITY_LOSS'])
  })

  it('hands the job to ffmpeg on a browser with no video codecs', () => {
    register(realWebCodecs, ffmpeg())

    expect(chosen(route(movToMp4, 50 * MB, { ...desktop, webCodecsVideo: false })).engine).toBe(
      'ffmpeg',
    )
  })

  it('is not offered at all without them, rather than failing after the download', () => {
    register(realWebCodecs)

    expect(refused(route(movToMp4, 50 * MB, { ...desktop, webCodecsVideo: false })).code).toBe(
      'UNSUPPORTED_PAIR',
    )
  })

  it('leaves the containers it cannot read to ffmpeg rather than claiming them', () => {
    register(realWebCodecs, ffmpeg())

    expect(chosen(route(mp4ToWebm, 50 * MB, desktop)).engine).toBe('ffmpeg')
    expect(chosen(route({ from: 'mkv', to: 'mp4', op: 'convert' }, 50 * MB, desktop)).engine).toBe(
      'ffmpeg',
    )
  })

  it('takes a file on a phone that ffmpeg would refuse, because it holds less', () => {
    register(realWebCodecs, ffmpeg())

    // 90 MB / 2.5 = 36 MB on an iPhone, against ffmpeg's 90 / 4.5 = 20 MB.
    expect(chosen(route(shrinkMp4, 30 * MB, iphone)).engine).toBe('webcodecs')
    // Past that it is the phone's ceiling being reported, not the file's:
    // `DEVICE_TOO_WEAK` is what a mobile browser's fixed allowance produces.
    expect(refused(route(shrinkMp4, 40 * MB, iphone)).code).toBe('DEVICE_TOO_WEAK')
  })

  it('takes the audio pairs too, on a browser that has only the audio codecs', () => {
    register(realWebCodecs, ffmpeg())
    const audioOnly = { ...desktop, webCodecsVideo: false }

    expect(
      chosen(route({ from: 'm4a', to: 'ogg', op: 'convert' }, 20 * MB, audioOnly)).engine,
    ).toBe('webcodecs')
  })

  it('hands MP3 to ffmpeg, since no browser encodes it', () => {
    register(realWebCodecs, ffmpeg())

    expect(chosen(route({ from: 'm4a', to: 'mp3', op: 'convert' }, 20 * MB, desktop)).engine).toBe(
      'ffmpeg',
    )
  })

  it('quotes a ceiling the user can act on when the file is too large', () => {
    register(realWebCodecs)

    const result = refused(route(shrinkMp4, 40 * MB, iphone))

    expect(result.message).toMatch(/36 MB/)
    expect(result.suggestion.length).toBeGreaterThan(0)
  })
})

describe('route — the real ffmpeg descriptor', () => {
  it('takes the containers no faster engine claims, and warns about all three costs', () => {
    register(realWebCodecs, realFfmpeg)

    const result = chosen(route(mp4ToWebm, 50 * MB, { ...desktop, crossOriginIsolated: false }))

    expect(result.engine).toBe('ffmpeg')
    // The order is fixed so a UI can render the list verbatim: how slow, why it
    // is slow, the wait before it starts, then the cost to the file.
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'SLOW_PATH',
      'NO_ISOLATION',
      'LARGE_DOWNLOAD',
      'QUALITY_LOSS',
    ])
  })

  it('quotes its real download size, which is the number the warning is for', () => {
    register(realFfmpeg)

    const download = chosen(route(mp4ToWebm, 10 * MB, desktop)).warnings.find(
      (warning) => warning.code === 'LARGE_DOWNLOAD',
    )

    expect(download?.message).toMatch(/31 MB/)
  })

  it('never wins a pair WebCodecs could have taken', () => {
    register(realWebCodecs, realFfmpeg)

    // Both claim mov to mp4. 15 against 90 is what keeps a 30 MB download and a
    // software decode away from a job the GPU could have done.
    expect(chosen(route(movToMp4, 50 * MB, desktop)).engine).toBe('webcodecs')
  })

  it('holds less than WebCodecs, so it refuses a file the fast path would take', () => {
    register(realFfmpeg)

    // 4.5x the input against WebCodecs' 2.5x: 266 MB on this desktop rather
    // than 480 MB.
    expect(chosen(route(mp4ToWebm, 200 * MB, desktop)).engine).toBe('ffmpeg')
    expect(refused(route(mp4ToWebm, 400 * MB, desktop)).code).toBe('FILE_TOO_LARGE')
  })
})

describe('route — the real remux descriptor', () => {
  const extractM4a: ConversionTask = { from: 'mp4', to: 'm4a', op: 'extract' }
  const extractMp3: ConversionTask = { from: 'mp4', to: 'mp3', op: 'extract' }

  it('wins audio extraction outright, ahead of both codec engines', () => {
    register(realRemux, realWebCodecs, realFfmpeg)

    const result = chosen(route(extractM4a, 200 * MB, desktop))

    expect(result.engine).toBe('remux')
    // mp4box and nothing else: the codecs are never loaded because they are
    // never used.
    expect(result.loadCost).toBeLessThan(1 * MB)
  })

  it('wins it on a device with no codecs at all, where nothing else can', () => {
    register(realRemux, realWebCodecs)

    const codecless = { ...desktop, webCodecsVideo: false, webCodecsAudio: false }

    expect(chosen(route(extractM4a, 50 * MB, codecless)).engine).toBe('remux')
  })

  it('says nothing about quality, because a stream copy gives none up', () => {
    register(realRemux, realFfmpeg)

    // MP4 and M4A are both lossy formats, so the pair alone would warn. The
    // engine is what makes the warning false here.
    expect(chosen(route(extractM4a, 50 * MB, desktop)).warnings).toEqual([])
  })

  it('loses every target that has to be re-encoded', () => {
    register(realRemux, realFfmpeg)

    // No browser and no container copy can produce MP3 out of AAC samples.
    const result = chosen(route(extractMp3, 50 * MB, desktop))

    expect(result.engine).toBe('ffmpeg')
    expect(result.warnings.map((warning) => warning.code)).toContain('QUALITY_LOSS')
  })

  it('holds less than ffmpeg, so it accepts a file the fallback would refuse', () => {
    register(realRemux, realFfmpeg)

    // 3x the input against ffmpeg's 4.5x: 400 MB on this desktop rather than
    // 266 MB.
    expect(chosen(route(extractM4a, 350 * MB, desktop)).engine).toBe('remux')
    expect(refused(route(extractM4a, 500 * MB, desktop)).code).toBe('FILE_TOO_LARGE')
  })
})

describe('route — video into GIF', () => {
  const mp4ToGif: ConversionTask = { from: 'mp4', to: 'gif', op: 'convert' }
  const mp3ToGif: ConversionTask = { from: 'mp3', to: 'gif', op: 'convert' }

  it('goes to ffmpeg, which is the only engine with a palette in it', () => {
    register(realRemux, realWebCodecs, realFfmpeg)

    const result = chosen(route(mp4ToGif, 20 * MB, desktop))

    expect(result.engine).toBe('ffmpeg')
    expect(result.warnings.map((warning) => warning.code)).toContain('QUALITY_LOSS')
  })

  it('refuses to make one out of a soundtrack, before anything is downloaded', () => {
    register(realWebCodecs, realFfmpeg)

    const result = refused(route(mp3ToGif, 5 * MB, desktop))

    expect(result.code).toBe('UNSUPPORTED_PAIR')
    expect(result.suggestion.length).toBeGreaterThan(0)
  })
})

describe('route — the audio format matrix', () => {
  const AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'm4a', 'flac'] as const

  it('finds an engine for every ordered pair of the five formats', () => {
    register(realRemux, realWebCodecs, realFfmpeg)

    for (const from of AUDIO_FORMATS) {
      for (const to of AUDIO_FORMATS) {
        if (from === to) continue

        const result = route({ from, to, op: 'convert' }, 20 * MB, desktop)

        expect(chosen(result).engine).toBeDefined()
      }
    }
  })

  it('finds one on a device with no codecs at all, which is what the fallback is for', () => {
    register(realRemux, realWebCodecs, realFfmpeg)

    const codecless = { ...desktop, webCodecsVideo: false, webCodecsAudio: false }

    for (const from of AUDIO_FORMATS) {
      for (const to of AUDIO_FORMATS) {
        if (from === to) continue

        expect(chosen(route({ from, to, op: 'convert' }, 20 * MB, codecless)).engine).toBe('ffmpeg')
      }
    }
  })

  it('prefers the browser codecs where the source is an ISO container', () => {
    register(realRemux, realWebCodecs, realFfmpeg)

    // No download at all against ffmpeg's 31 MB.
    expect(chosen(route({ from: 'm4a', to: 'ogg', op: 'convert' }, 20 * MB, desktop)).engine).toBe(
      'webcodecs',
    )
  })

  it('says nothing about quality when both ends are lossless', () => {
    register(realFfmpeg)

    const result = chosen(route({ from: 'flac', to: 'wav', op: 'convert' }, 20 * MB, desktop))

    expect(result.warnings.map((warning) => warning.code)).not.toContain('QUALITY_LOSS')
  })
})
