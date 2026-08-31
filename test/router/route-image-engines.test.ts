// @vitest-environment node
//
// Deliberately not jsdom. `route()` runs during SSR, inside a Web Worker and in
// the browser, and it is only allowed to look at the three arguments it is
// handed, so a `window` or `document` read inside it must throw here rather
// than pass quietly. `route-purity.test.ts` closes the remaining gap.
//
// The image engines as they actually ship — libheif, Canvas and wasm-vips —
// routed through their real descriptors. The suites driven by fakes cannot see
// a descriptor that starts claiming the wrong pairs, so CLAUDE.md §5.4 asks
// every engine for both directions: one case where it wins, one where it does
// not.

import { describe, expect, it, vi } from 'vitest'

import { descriptor as realHeif } from '@/lib/engines/heif'
import { descriptor as vipsEngine } from '@/lib/engines/vips'
import { LARGE_DOWNLOAD_BYTES, route } from '@/lib/router/route'
import type { ConversionTask, FormatId } from '@/lib/router/types'

import {
  canvas,
  chosen,
  desktop,
  ffmpeg,
  heicToJpg,
  ios,
  jpgToPng,
  MB,
  refused,
  register,
  resetRegistryBetweenTests,
  tiffToPng,
  vips,
  warningCodes,
} from './support/route-harness'

// `vi.mock` is hoisted to the top of the file, so the call cannot be shared —
// only the replacement module it returns, which the harness builds.
vi.mock('@/lib/engines/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engines/registry')>()

  return (await import('./support/route-harness')).mockedRegistry(actual)
})

resetRegistryBetweenTests()

describe('route — the heif engine, as it is actually registered', () => {
  it('is chosen for heic→jpg on a desktop, ahead of every heavier alternative', () => {
    register(realHeif, vips(), ffmpeg())

    const result = chosen(route(heicToJpg, 3 * MB, desktop))

    expect(result.engine).toBe('heif')
    expect(result.loadCost).toBe(realHeif.loadCost)
    expect(warningCodes(result)).not.toContain('LARGE_DOWNLOAD')
  })

  it('is chosen for heic→png too, which is the other half of the acceptance criteria', () => {
    register(realHeif, ffmpeg())

    expect(chosen(route({ from: 'heic', to: 'png', op: 'convert' }, 3 * MB, desktop)).engine).toBe(
      'heif',
    )
  })

  it('loses to canvas on a pair it has no business claiming', () => {
    register(canvas(), realHeif)

    expect(chosen(route(jpgToPng, 2 * MB, desktop)).engine).toBe('canvas')
  })

  it('is not chosen when it is the only engine and the pair is not a HEIC decode', () => {
    register(realHeif)

    expect(refused(route(jpgToPng, 2 * MB, desktop)).code).toBe('UNSUPPORTED_PAIR')
    expect(refused(route({ from: 'heic', to: 'avif', op: 'convert' }, 2 * MB, desktop)).code).toBe(
      'UNSUPPORTED_PAIR',
    )
  })

  it('is not chosen on a browser without OffscreenCanvas, which is how it writes its output', () => {
    register(realHeif)

    expect(refused(route(heicToJpg, 2 * MB, { ...desktop, offscreenCanvas: false })).code).toBe(
      'UNSUPPORTED_PAIR',
    )
  })

  it('is not chosen for a file larger than its 5x expansion allows on an iPhone', () => {
    register(realHeif)

    // (90 MB iOS budget - 21 MB reserve) / 5 = 13.8 MB of HEIC input. The reserve
    // is libheif's WASM heap, measured at 20.5 MB before a pixel is decoded —
    // see MEMORY.heif.
    const result = refused(route(heicToJpg, 30 * MB, ios))

    expect(result.code).toBe('DEVICE_TOO_WEAK')
    expect(result.message).toContain('14 MB')
  })

  it('refuses a HEIC whose pixels do not fit, however small the file is', () => {
    register(realHeif)

    // The case a byte count structurally cannot see: 24 megapixels at the 8
    // bytes a pixel a decode costs is 192 MB, on a device with 90 MB. Two
    // megabytes of input, so every byte-based check waves it through.
    const result = refused(route(heicToJpg, [{ bytes: 2 * MB, pixels: 24_000_000 }], ios))

    expect(result.code).toBe('DEVICE_TOO_WEAK')
  })

  it('still takes the same file where the pixels do fit', () => {
    register(realHeif)

    expect(route(heicToJpg, [{ bytes: 2 * MB, pixels: 24_000_000 }], desktop).ok).toBe(true)
  })
})

describe('route — the canvas engine as it actually ships (issue #30)', () => {
  /** The real descriptor, not a stand-in: these cases pin what it claims. */
  const realCanvas = async () =>
    (await vi.importActual<typeof import('@/lib/engines/canvas')>('@/lib/engines/canvas'))
      .descriptor

  it('is selected for every pair among jpg, png, webp and bmp', async () => {
    register(await realCanvas(), vips(), ffmpeg())
    const formats: FormatId[] = ['jpg', 'png', 'webp', 'bmp']

    for (const from of formats) {
      for (const to of formats) {
        const result = chosen(route({ from, to, op: 'convert' }, 2 * MB, desktop))

        expect(result.engine).toBe('canvas')
        expect(result.loadCost).toBe(0)
      }
    }
  })

  it('warns about nothing at all for png → bmp, the flagship zero-download job', async () => {
    register(await realCanvas())

    // Neither side is lossy and there is no download, so a clean conversion has
    // to arrive with an empty warning list rather than a reassuring one.
    expect(
      chosen(route({ from: 'png', to: 'bmp', op: 'convert' }, 2 * MB, desktop)).warnings,
    ).toEqual([])
  })

  it('is not selected for a format the browser cannot write, leaving the pair to vips', async () => {
    register(await realCanvas(), vips())

    expect(chosen(route(tiffToPng, 2 * MB, desktop)).engine).toBe('vips')
  })

  it('does not claim heic, avif or any operation beyond a plain convert', async () => {
    register(await realCanvas())

    expect(refused(route(heicToJpg, 2 * MB, desktop)).code).toBe('UNSUPPORTED_PAIR')
    expect(refused(route({ from: 'jpg', to: 'avif', op: 'convert' }, 2 * MB, desktop)).code).toBe(
      'UNSUPPORTED_PAIR',
    )
    expect(refused(route({ from: 'jpg', to: 'jpg', op: 'compress' }, 2 * MB, desktop)).code).toBe(
      'UNSUPPORTED_PAIR',
    )
  })

  it('leaves the browser-API gate to the router, so a missing API is named', async () => {
    // The descriptor deliberately ignores `Capabilities`: a browser without
    // OffscreenCanvas must hear which API is missing, not "unsupported pair".
    register(await realCanvas())

    const result = refused(route(jpgToPng, 2 * MB, { ...desktop, offscreenCanvas: false }))

    expect(result.code).toBe('CODEC_UNAVAILABLE')
    expect(result.message).toContain('OffscreenCanvas')
  })

  it('refuses an image too large for a decoded bitmap to fit in the budget', async () => {
    register(await realCanvas())

    // A canvas holds 6× the encoded input, so a 1200 MB desktop budget tops out
    // at 200 MB of JPEG — and 300 MB of it cannot be decoded safely.
    const result = refused(route(jpgToPng, 300 * MB, desktop))

    expect(result.code).toBe('FILE_TOO_LARGE')
    expect(result.message).toContain('200 MB')
  })
})

describe('route — the real wasm-vips descriptor', () => {
  const gifToWebp: ConversionTask = { from: 'gif', to: 'webp', op: 'convert' }
  const jpgToAvif: ConversionTask = { from: 'jpg', to: 'avif', op: 'convert' }

  it('is chosen for TIFF, AVIF and GIF on an isolated desktop document', () => {
    register(vipsEngine)

    expect(chosen(route(tiffToPng, 4 * MB, desktop)).engine).toBe('vips')
    expect(chosen(route(jpgToAvif, 4 * MB, desktop)).engine).toBe('vips')
    expect(chosen(route(gifToWebp, 4 * MB, desktop)).engine).toBe('vips')
  })

  it('is not chosen when the document is not cross-origin isolated', () => {
    // The vendored build is compiled with pthreads: its WebAssembly memory is
    // `shared`, so without SharedArrayBuffer it cannot even be instantiated.
    // COOP/COEP are sent on /convert/* and /tools/* only, and a soft navigation
    // from a marketing page carries the un-isolated state across — so this is
    // the state a real visitor can land in.
    register(vipsEngine)

    const result = refused(route(tiffToPng, 4 * MB, { ...desktop, crossOriginIsolated: false }))

    expect(result.code).toBe('UNSUPPORTED_PAIR')
    expect(result.suggestion.length).toBeGreaterThan(10)
  })

  it('is not chosen without WASM SIMD, or for a pair it has no loader for', () => {
    register(vipsEngine)

    expect(refused(route(tiffToPng, 4 * MB, { ...desktop, wasmSimd: false })).code).toBe(
      'UNSUPPORTED_PAIR',
    )
    expect(refused(route({ from: 'bmp', to: 'png', op: 'convert' }, MB, desktop)).code).toBe(
      'UNSUPPORTED_PAIR',
    )
  })

  it('loses to a cheaper, higher-priority engine on the pairs both can do', () => {
    // Canvas re-encodes JPEG for free; vips is the fallback, not the default.
    register(canvas(), vipsEngine)

    expect(chosen(route(jpgToPng, 2 * MB, desktop)).engine).toBe('canvas')
    // …but it is still the only engine that can write AVIF.
    expect(chosen(route(jpgToAvif, 2 * MB, desktop)).engine).toBe('vips')
  })

  it('downloads less than the 8 MB that would warrant a LARGE_DOWNLOAD warning', () => {
    register(vipsEngine)

    const result = chosen(route(tiffToPng, 2 * MB, desktop))

    expect(result.loadCost).toBe(vipsEngine.loadCost)
    expect(result.loadCost).toBeLessThan(LARGE_DOWNLOAD_BYTES)
    expect(warningCodes(result)).not.toContain('LARGE_DOWNLOAD')
  })

  it('refuses a file past the 4× expansion budget rather than crashing the tab', () => {
    register(vipsEngine)

    // 1200 MB desktop budget / 4 = 300 MB of vips input.
    const result = refused(route(tiffToPng, 900 * MB, desktop))

    expect(result.code).toBe('FILE_TOO_LARGE')
    expect(result.message).toContain('300 MB')
  })
})
