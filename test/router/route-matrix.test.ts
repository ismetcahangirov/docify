// @vitest-environment node
//
// Deliberately not jsdom. `route()` runs during SSR, inside a Web Worker and in
// the browser, and it is only allowed to look at the three arguments it is
// handed. With no DOM in scope, a `window` or `document` read inside the module
// under test throws here instead of quietly passing under jsdom and failing in
// production. `route-purity.test.ts` closes the remaining gap.
//
// The twelve numbered cases the plan requires of the router, driven by the
// stand-in descriptors in `support/route-harness.ts` rather than by whichever
// engines happen to have landed.

import { describe, expect, it, vi } from 'vitest'

import { LARGE_DOWNLOAD_BYTES, route } from '@/lib/router/route'
import type { ConversionTask } from '@/lib/router/types'

import {
  canvas,
  chosen,
  desktop,
  fake,
  ffmpeg,
  GB,
  heicToJpg,
  heif,
  ios,
  jpgToPng,
  MB,
  mp4ToMp3,
  mp4ToWebm,
  refused,
  register,
  resetRegistryBetweenTests,
  tiffToPng,
  vips,
  warningCodes,
  webcodecs,
} from './support/route-harness'

// `vi.mock` is hoisted to the top of the file, so the call cannot be shared —
// only the replacement module it returns, which the harness builds.
vi.mock('@/lib/engines/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engines/registry')>()

  return (await import('./support/route-harness')).mockedRegistry(actual)
})

resetRegistryBetweenTests()

describe('route — the twelve cases the plan requires', () => {
  it('1. desktop + heic→jpg + 3 MB picks heif', () => {
    register(canvas(), heif(), vips(), ffmpeg())

    expect(chosen(route(heicToJpg, 3 * MB, desktop)).engine).toBe('heif')
  })

  it('2. desktop + jpg→png + 2 MB picks canvas, because a zero-cost engine needs no download', () => {
    register(canvas(), vips(), heif(), ffmpeg())

    const result = chosen(route(jpgToPng, 2 * MB, desktop))

    expect(result.engine).toBe('canvas')
    expect(result.loadCost).toBe(0)
    expect(result.warnings).toEqual([])
  })

  it('3. desktop + mp4→webm + 50 MB picks webcodecs when the hardware codecs are present', () => {
    register(canvas(), webcodecs(), ffmpeg())

    const result = chosen(route(mp4ToWebm, 50 * MB, desktop))

    expect(result.engine).toBe('webcodecs')
    expect(result.reason).toBe('Hardware-accelerated (WebCodecs)')
    expect(warningCodes(result)).not.toContain('SLOW_PATH')
  })

  it('4. desktop + mp4→webm + 50 MB falls back to ffmpeg with SLOW_PATH when WebCodecs is absent', () => {
    register(canvas(), webcodecs(), ffmpeg())

    const result = chosen(route(mp4ToWebm, 50 * MB, { ...desktop, webCodecsVideo: false }))

    expect(result.engine).toBe('ffmpeg')
    expect(warningCodes(result)).toContain('SLOW_PATH')
  })

  it('5. ffmpeg warns NO_ISOLATION on any page, isolated or not', () => {
    register(ffmpeg())

    const isolated = chosen(route(mp4ToWebm, 50 * MB, desktop))
    const single = chosen(route(mp4ToWebm, 50 * MB, { ...desktop, crossOriginIsolated: false }))

    // The warning is about the vendored core, which is single-threaded either
    // way, so isolation does not silence it.
    expect(warningCodes(isolated)).toContain('NO_ISOLATION')
    expect(warningCodes(single)).toContain('NO_ISOLATION')
  })

  it('6. ios + mp4→mp3 + 200 MB is refused as DEVICE_TOO_WEAK', () => {
    register(ffmpeg())

    const result = refused(route(mp4ToMp3, 200 * MB, ios))

    expect(result.code).toBe('DEVICE_TOO_WEAK')
    // 90 MB iOS budget / 4.5 expansion = 20 MB of ffmpeg input.
    expect(result.message).toContain('200 MB')
    expect(result.message).toContain('20 MB')
    expect(result.suggestion).toMatch(/desktop/i)
  })

  it('7. desktop + mp4→mp3 + 4 GB is refused as FILE_TOO_LARGE', () => {
    register(webcodecs(), ffmpeg())

    const result = refused(route(mp4ToMp3, 4 * GB, desktop))

    expect(result.code).toBe('FILE_TOO_LARGE')
    expect(result.message).toContain('4.0 GB')
    // The quoted ceiling is the roomiest candidate's: 1200 MB / 4 = 300 MB.
    expect(result.message).toContain('300 MB')
    expect(result.suggestion).toMatch(/split|smaller/i)
  })

  it('8. jpg→dwg is refused as UNSUPPORTED_PAIR', () => {
    register(canvas(), heif(), vips(), ffmpeg())

    const cad: ConversionTask = {
      from: 'jpg',
      // @ts-expect-error 'dwg' is not a FormatId — CAD output is out of scope,
      // so the pair is unroutable at compile time as well as at run time.
      to: 'dwg',
      op: 'convert',
    }

    const result = refused(route(cad, 2 * MB, desktop))

    expect(result.code).toBe('UNSUPPORTED_PAIR')
    expect(result.message).toContain('JPG')
    expect(result.message).toContain('DWG')
  })

  it('9. inputBytes 0 is refused as EMPTY_INPUT, before any engine is consulted', () => {
    const supports = vi.fn(() => true)
    register(fake('canvas', { supports }))

    const result = refused(route(jpgToPng, 0, desktop))

    expect(result.code).toBe('EMPTY_INPUT')
    expect(supports).not.toHaveBeenCalled()
  })

  it('10. when two engines support the task, the lower priority wins', () => {
    // The download sizes point the other way on purpose: priority must win even
    // when the preferred engine is the far more expensive one to fetch.
    register(
      fake('ffmpeg', { priority: 90, loadCost: 0 }),
      fake('canvas', { priority: 10, loadCost: 32_000_000 }),
    )

    expect(chosen(route(jpgToPng, MB, desktop)).engine).toBe('canvas')
  })

  it('11. on equal priority, the cheaper download wins', () => {
    register(
      fake('vips', { priority: 40, loadCost: 5_500_000 }),
      fake('heif', { priority: 40, loadCost: 900_000 }),
    )

    expect(chosen(route(jpgToPng, MB, desktop)).engine).toBe('heif')
  })

  it('12. a 5.5 MB engine download does not warn LARGE_DOWNLOAD', () => {
    register(vips(), ffmpeg())

    const result = chosen(route(tiffToPng, 2 * MB, desktop))

    expect(result.engine).toBe('vips')
    expect(result.loadCost).toBe(5_500_000)
    expect(result.loadCost).toBeLessThan(LARGE_DOWNLOAD_BYTES)
    expect(warningCodes(result)).not.toContain('LARGE_DOWNLOAD')
  })
})
