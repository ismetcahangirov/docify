// @vitest-environment node
//
// Deliberately not jsdom. `route()` runs during SSR, inside a Web Worker and in
// the browser, and it is only allowed to look at the three arguments it is
// handed. With no DOM in scope, a stray `navigator` or `window` read inside the
// module under test throws here instead of quietly passing under jsdom and
// failing in production.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as registry from '@/lib/engines/registry'
import type { EngineDescriptor } from '@/lib/engines/types'
import { LARGE_DOWNLOAD_BYTES, route } from '@/lib/router/route'
import type {
  Capabilities,
  ConversionTask,
  EngineId,
  RouteResult,
  WarningCode,
} from '@/lib/router/types'

const MB = 1024 * 1024
const GB = 1024 * MB

/**
 * The engine list `route()` sees, swapped per test.
 *
 * `ENGINES` ships empty and will grow one engine at a time over the next dozen
 * issues. Asserting selection against whichever engines happen to have landed
 * would make every new engine break these tests, so the suite drives the router
 * with fake descriptors instead. The registry's own contract — filter by
 * `supports`, order by `byPreference` — is tested for real in
 * `test/engines/registry.test.ts`; the mock below reuses the registry's actual
 * `byPreference`, so the ordering rule the router depends on cannot drift out
 * from under it.
 */
const { registered } = vi.hoisted(() => ({ registered: [] as EngineDescriptor[] }))

vi.mock('@/lib/engines/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engines/registry')>()

  return {
    ...actual,
    ENGINES: registered,
    enginesFor: (task: ConversionTask, caps: Capabilities): readonly EngineDescriptor[] =>
      registered.filter((engine) => engine.supports(task, caps)).sort(actual.byPreference),
  }
})

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

const ios: Capabilities = {
  ...desktop,
  crossOriginIsolated: false,
  deviceMemoryGb: 2,
  cores: 4,
  webCodecsVideo: false,
  webCodecsAudio: false,
  platform: 'ios',
  browser: 'safari',
}

const android: Capabilities = { ...desktop, deviceMemoryGb: 4, cores: 6, platform: 'android' }

const heicToJpg: ConversionTask = { from: 'heic', to: 'jpg', op: 'convert' }
const jpgToPng: ConversionTask = { from: 'jpg', to: 'png', op: 'convert' }
const mp4ToWebm: ConversionTask = { from: 'mp4', to: 'webm', op: 'convert' }
const mp4ToMp3: ConversionTask = { from: 'mp4', to: 'mp3', op: 'extract' }
const tiffToPng: ConversionTask = { from: 'tiff', to: 'png', op: 'convert' }

/** Registers descriptors for the current test. Cleared again in `beforeEach`. */
function register(...engines: EngineDescriptor[]): void {
  registered.push(...engines)
}

/** Runs `body` against exactly `engines`, so one test can cover several registries. */
function withEngines<T>(engines: EngineDescriptor[], body: () => T): T {
  registered.length = 0
  registered.push(...engines)
  return body()
}

/** A descriptor with sane defaults; each test overrides only what it cares about. */
function fake(id: EngineId, overrides: Partial<EngineDescriptor> = {}): EngineDescriptor {
  return { id, label: id, loadCost: 0, priority: 50, supports: () => true, ...overrides }
}

const IMAGE_FORMATS = new Set(['jpg', 'png', 'webp', 'bmp'])
const MEDIA_FORMATS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'mp3', 'wav', 'ogg', 'm4a'])

const isImage = (task: ConversionTask) => IMAGE_FORMATS.has(task.from) && IMAGE_FORMATS.has(task.to)
const isMedia = (task: ConversionTask) => MEDIA_FORMATS.has(task.from) || MEDIA_FORMATS.has(task.to)

/**
 * Stand-ins for the engines EPICs 4–6 will ship, carrying the priorities and
 * download sizes from the plan's priority table so the ordering assertions mean
 * something. Their `supports` predicates are as coarse as a real descriptor's:
 * synchronous, and decided from the task and the device only.
 */
const canvas = () =>
  fake('canvas', { label: 'Canvas (built in)', priority: 10, loadCost: 0, supports: isImage })

const webcodecs = () =>
  fake('webcodecs', {
    label: 'Hardware-accelerated (WebCodecs)',
    priority: 15,
    loadCost: 120_000,
    supports: (task, caps) => isMedia(task) && caps.webCodecsVideo,
  })

const heif = () =>
  fake('heif', {
    label: 'libheif',
    priority: 35,
    loadCost: 900_000,
    supports: (task) => task.from === 'heic',
  })

const vips = () =>
  fake('vips', {
    label: 'wasm-vips',
    priority: 40,
    loadCost: 5_500_000,
    supports: (task) => task.from === 'tiff' || task.to === 'tiff',
  })

const ffmpeg = () =>
  fake('ffmpeg', { label: 'ffmpeg.wasm', priority: 90, loadCost: 32_000_000, supports: isMedia })

/** Narrows to the success branch, failing the test rather than the assertion. */
function chosen(result: RouteResult) {
  if (!result.ok) throw new Error(`expected an engine, got ${result.code}: ${result.message}`)
  return result
}

/** Narrows to the rejection branch. */
function refused(result: RouteResult) {
  if (result.ok) throw new Error(`expected a rejection, got engine ${result.engine}`)
  return result
}

const warningCodes = (result: RouteResult): WarningCode[] =>
  chosen(result).warnings.map((warning) => warning.code)

beforeEach(() => {
  registered.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('5. ffmpeg on a page that is not cross-origin isolated warns NO_ISOLATION', () => {
    register(ffmpeg())

    const isolated = chosen(route(mp4ToWebm, 50 * MB, desktop))
    const single = chosen(route(mp4ToWebm, 50 * MB, { ...desktop, crossOriginIsolated: false }))

    expect(warningCodes(isolated)).not.toContain('NO_ISOLATION')
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
    // The quoted ceiling is the roomiest candidate's: 1200 MB / 2.5 = 480 MB.
    expect(result.message).toContain('480 MB')
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

describe('route — rejections', () => {
  it('rejects with UNSUPPORTED_PAIR while the engine registry is still empty', async () => {
    // Issue #26 shipped `ENGINES` empty on purpose and left this assertion to
    // the router. Rather than trust the mock, the shipped list is loaded and
    // handed to the router verbatim, so this starts failing the day an engine
    // lands without the router being taught about it.
    const real =
      await vi.importActual<typeof import('@/lib/engines/registry')>('@/lib/engines/registry')

    expect(real.ENGINES).toEqual([])
    register(...real.ENGINES)

    expect(refused(route(jpgToPng, 2 * MB, desktop)).code).toBe('UNSUPPORTED_PAIR')
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

describe('route — warnings', () => {
  it('warns LARGE_DOWNLOAD above the 8 MB threshold and not at it', () => {
    expect(LARGE_DOWNLOAD_BYTES).toBe(8 * MB)

    const atLimit = withEngines([fake('vips', { loadCost: LARGE_DOWNLOAD_BYTES })], () =>
      warningCodes(route(jpgToPng, MB, desktop)),
    )
    const overLimit = withEngines([fake('vips', { loadCost: LARGE_DOWNLOAD_BYTES + 1 })], () =>
      warningCodes(route(jpgToPng, MB, desktop)),
    )

    expect(atLimit).not.toContain('LARGE_DOWNLOAD')
    expect(overLimit).toContain('LARGE_DOWNLOAD')
  })

  it('warns QUALITY_LOSS only when both sides of the pair are lossy', () => {
    register(fake('vips'))

    expect(warningCodes(route({ from: 'jpg', to: 'webp', op: 'convert' }, MB, desktop))).toContain(
      'QUALITY_LOSS',
    )
    expect(
      warningCodes(route({ from: 'jpg', to: 'png', op: 'convert' }, MB, desktop)),
    ).not.toContain('QUALITY_LOSS')
    expect(
      warningCodes(route({ from: 'png', to: 'jpg', op: 'convert' }, MB, desktop)),
    ).not.toContain('QUALITY_LOSS')
  })

  it('reports the ffmpeg fallback in a fixed order: slow, single-threaded, download, quality', () => {
    register(ffmpeg())

    const codes = warningCodes(
      route(mp4ToWebm, 10 * MB, { ...desktop, crossOriginIsolated: false }),
    )

    expect(codes).toEqual(['SLOW_PATH', 'NO_ISOLATION', 'LARGE_DOWNLOAD', 'QUALITY_LOSS'])
  })

  it('quotes the download size in the LARGE_DOWNLOAD message', () => {
    register(ffmpeg())

    const warning = chosen(route(mp4ToWebm, 10 * MB, desktop)).warnings.find(
      (candidate) => candidate.code === 'LARGE_DOWNLOAD',
    )

    expect(warning?.message).toContain('31 MB')
  })
})

describe('route — purity', () => {
  it('does not mutate the arguments it is given', () => {
    register(canvas(), ffmpeg())
    const task = { ...jpgToPng }
    const caps = { ...desktop }

    route(task, 2 * MB, caps)

    expect(task).toEqual(jpgToPng)
    expect(caps).toEqual(desktop)
  })

  it('returns the same decision for the same inputs', () => {
    register(canvas(), webcodecs(), ffmpeg())

    expect(route(mp4ToWebm, 50 * MB, desktop)).toEqual(route(mp4ToWebm, 50 * MB, desktop))
  })

  it('follows the order the registry hands it, rather than deriving its own', () => {
    // `byPreference` lives in the registry and nowhere else (issue #26). The two
    // engines below disagree on priority and on download size, so a router that
    // re-sorted by either key would answer the same thing both times.
    const cheapButLast = fake('ffmpeg', { priority: 90, loadCost: 0 })
    const costlyButFirst = fake('canvas', { priority: 10, loadCost: 32_000_000 })
    const enginesFor = vi.spyOn(registry, 'enginesFor')

    enginesFor.mockReturnValue([costlyButFirst, cheapButLast])
    expect(chosen(route(jpgToPng, MB, desktop)).engine).toBe('canvas')

    enginesFor.mockReturnValue([cheapButLast, costlyButFirst])
    expect(chosen(route(jpgToPng, MB, desktop)).engine).toBe('ffmpeg')
  })

  it('narrows cleanly on ok', () => {
    register(canvas())

    const result = route(jpgToPng, 2 * MB, desktop)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toBeInstanceOf(Array)
  })
})
