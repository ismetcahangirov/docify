// @vitest-environment node
//
// Deliberately not jsdom. `route()` runs during SSR, inside a Web Worker and in
// the browser, and it is only allowed to look at the three arguments it is
// handed, so a `window` or `document` read inside it must throw here rather
// than pass quietly. `route-purity.test.ts` closes the remaining gap.
//
// Which rejection `route()` returns, and what it puts in the message. The
// wording of each rejection builder in isolation belongs to `rejections.test.ts`
// next door; these cases are about the router choosing between them.

import { describe, expect, it, vi } from 'vitest'

import { route } from '@/lib/router/route'

import {
  android,
  canvas,
  chosen,
  desktop,
  fake,
  ffmpeg,
  GB,
  ios,
  jpgToPng,
  MB,
  mp4ToMp3,
  mp4ToWebm,
  refused,
  register,
  resetRegistryBetweenTests,
  webcodecs,
  withEngines,
} from './support/route-harness'

// `vi.mock` is hoisted to the top of the file, so the call cannot be shared —
// only the replacement module it returns, which the harness builds.
vi.mock('@/lib/engines/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engines/registry')>()

  return (await import('./support/route-harness')).mockedRegistry(actual)
})

resetRegistryBetweenTests()

describe('route — rejections', () => {
  it('rejects with UNSUPPORTED_PAIR when the engines that actually ship claim nothing', async () => {
    // The list that actually ships is loaded and handed over verbatim rather
    // than assumed, so the case stays honest as engines land. RAR → MP4 is not
    // on any engine's roadmap, so it stays unclaimed however the list grows.
    const real =
      await vi.importActual<typeof import('@/lib/engines/registry')>('@/lib/engines/registry')

    register(...real.ENGINES)

    expect(refused(route({ from: 'rar', to: 'mp4', op: 'convert' }, 2 * MB, desktop)).code).toBe(
      'UNSUPPORTED_PAIR',
    )
  })

  it('refuses a negative or unreadable size as EMPTY_INPUT', () => {
    register(canvas())

    expect(refused(route(jpgToPng, -1, desktop)).code).toBe('EMPTY_INPUT')
    expect(refused(route(jpgToPng, Number.NaN, desktop)).code).toBe('EMPTY_INPUT')
  })

  it('refuses with CODEC_UNAVAILABLE when the only fitting engine needs a codec this device lacks', () => {
    // A descriptor's `supports` is coarse — this one asks for video codecs and
    // gets them. The audio half of the job still cannot run, and the router is
    // the layer that notices.
    register(webcodecs())

    const result = refused(route(mp4ToMp3, 10 * MB, { ...desktop, webCodecsAudio: false }))

    expect(result.code).toBe('CODEC_UNAVAILABLE')
    expect(result.message).toContain('AudioEncoder')
    expect(result.suggestion).toMatch(/chrome|edge/i)
  })

  it('prefers a codec-viable engine over rejecting, when one is registered', () => {
    register(webcodecs(), ffmpeg())

    expect(chosen(route(mp4ToMp3, 10 * MB, { ...desktop, webCodecsAudio: false })).engine).toBe(
      'ffmpeg',
    )
  })

  it('quotes a ceiling the device can actually honour, ignoring codec-blocked engines', () => {
    // webcodecs is roomier (4× the input against ffmpeg's 4.5×) but cannot
    // encode the audio here. Quoting its 300 MB ceiling would send the user
    // away to shrink the file and then refuse the result at 400 MB as well.
    register(webcodecs(), ffmpeg())
    const noAudioCodecs = { ...desktop, webCodecsAudio: false }

    const huge = refused(route(mp4ToMp3, 4 * GB, noAudioCodecs))
    const shrunk = refused(route(mp4ToMp3, 400 * MB, noAudioCodecs))

    // 1200 MB desktop budget / 4.5 = 267 MB, the only ceiling ffmpeg can honour.
    expect(huge.message).toContain('267 MB')
    expect(huge.message).not.toContain('300 MB')
    expect(shrunk.code).toBe('FILE_TOO_LARGE')
    expect(shrunk.message).toContain('267 MB')
  })

  it('does not ask an image job for audio codecs', () => {
    // Neither end of gif→webp is timed media, so the WebCodecs gate has no
    // opinion — demanding AudioEncoder here would refuse a job that can run.
    register(fake('webcodecs', { label: 'WebCodecs' }))

    const result = chosen(
      route({ from: 'gif', to: 'webp', op: 'convert' }, MB, {
        ...desktop,
        webCodecsVideo: false,
        webCodecsAudio: false,
      }),
    )

    expect(result.engine).toBe('webcodecs')
  })

  it('needs both halves of the worker canvas API, and names the missing half', () => {
    // A worker has no DOM canvas: `createImageBitmap` decodes and
    // `OffscreenCanvas` encodes, so one without the other cannot convert.
    register(fake('canvas'))

    const noEncode = refused(route(jpgToPng, MB, { ...desktop, offscreenCanvas: false }))
    const noDecode = refused(route(jpgToPng, MB, { ...desktop, createImageBitmap: false }))

    expect(noEncode.code).toBe('CODEC_UNAVAILABLE')
    expect(noEncode.message).toContain('OffscreenCanvas')
    expect(noDecode.message).toContain('createImageBitmap')
  })

  it('names every missing API, and never points at one that is present', () => {
    register(fake('canvas', { priority: 10 }), fake('webcodecs', { priority: 15 }))

    const result = refused(
      route(mp4ToWebm, MB, { ...desktop, offscreenCanvas: false, webCodecsVideo: false }),
    )

    expect(result.message).toContain('OffscreenCanvas')
    expect(result.message).toContain('VideoEncoder')
    expect(result.suggestion).toContain('OffscreenCanvas')
  })

  it('rejects an android device as DEVICE_TOO_WEAK rather than FILE_TOO_LARGE', () => {
    register(ffmpeg())

    expect(refused(route(mp4ToWebm, 500 * MB, android)).code).toBe('DEVICE_TOO_WEAK')
  })

  it('quotes the ceiling of the roomiest candidate, not of the preferred one', () => {
    // canvas is preferred but holds 6× the input; vips holds 4×, so vips is the
    // engine whose limit the user should be told about.
    register(fake('canvas', { priority: 10 }), fake('vips', { priority: 40 }))

    const result = refused(route(jpgToPng, 900 * MB, desktop))

    // 1200 MB desktop budget / 4 = 300 MB, versus 200 MB for canvas.
    expect(result.message).toContain('300 MB')
    expect(result.message).not.toContain('200 MB')
  })

  it('fills in both message and suggestion for every rejection code', () => {
    const rejections = [
      withEngines([canvas()], () => refused(route(jpgToPng, 0, desktop))),
      withEngines([canvas()], () => refused(route(mp4ToMp3, 2 * MB, desktop))),
      withEngines([webcodecs(), ffmpeg()], () => refused(route(mp4ToMp3, 4 * GB, desktop))),
      withEngines([ffmpeg()], () => refused(route(mp4ToMp3, 4 * GB, ios))),
      withEngines([webcodecs()], () =>
        refused(route(mp4ToMp3, 10 * MB, { ...desktop, webCodecsAudio: false })),
      ),
    ]

    // The list above covers every RejectionCode exactly once.
    expect(new Set(rejections.map((rejection) => rejection.code)).size).toBe(5)

    for (const rejection of rejections) {
      expect(rejection.message.length).toBeGreaterThan(10)
      expect(rejection.suggestion.length).toBeGreaterThan(10)
      expect(rejection.message).not.toMatch(/something went wrong/i)
      expect(rejection.suggestion).not.toMatch(/try again|something went wrong/i)
    }
  })
})
