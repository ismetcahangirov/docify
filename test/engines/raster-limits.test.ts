// @vitest-environment node
//
// Pure arithmetic and two header readers, so nothing here needs a DOM. The
// point of the module is that it answers *before* a decoder is handed anything,
// which is exactly what makes it testable without one.

import { describe, expect, it } from 'vitest'

import {
  BITMAP_DECODED_BYTES_PER_PIXEL,
  CONSERVATIVE_BUDGET_BYTES,
  PDFLIB_DECODED_BYTES_PER_PIXEL,
  assertDecodedPixelsFit,
  jpegSize,
  maxDecodedPixels,
  pngSize,
  rasterSize,
} from '@/lib/engines/raster-limits'
import { IOS_BUDGET_BYTES } from '@/lib/router/budget'

import { jpegBytes, pngBytes } from './synthetic-images'

describe('reading dimensions out of a header', () => {
  it('reads width and height from a PNG IHDR', () => {
    expect(pngSize(pngBytes(1500, 2000))).toEqual({ width: 1500, height: 2000 })
  })

  it('reads width and height from a JPEG SOF0', () => {
    expect(jpegSize(jpegBytes(4000, 3000))).toEqual({ width: 4000, height: 3000 })
  })

  it('refuses to guess when the PNG is truncated before its IHDR', () => {
    expect(pngSize(pngBytes(10, 10).subarray(0, 20))).toBeNull()
  })

  it('refuses to guess when the first chunk is not an IHDR', () => {
    const broken = pngBytes(10, 10)
    broken[13] = 0x00 // the 'H' of "IHDR"

    expect(pngSize(broken)).toBeNull()
  })

  it('refuses to guess when a PNG declares a zero dimension', () => {
    const broken = pngBytes(10, 10)
    new DataView(broken.buffer).setUint32(16, 0)

    expect(pngSize(broken)).toBeNull()
  })

  it('refuses to guess when the JPEG carries no start-of-frame', () => {
    // SOI, then straight to EOI: a valid enough byte stream, no frame in it.
    expect(jpegSize(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))).toBeNull()
  })

  it('walks past segments that are not a frame header', () => {
    const jpeg = jpegBytes(640, 480)
    // A JFIF APP0 ahead of the SOF0, which is what every camera actually writes.
    const app0 = Uint8Array.of(0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46)
    const withApp0 = new Uint8Array(jpeg.length + app0.length)

    withApp0.set(jpeg.subarray(0, 2), 0)
    withApp0.set(app0, 2)
    withApp0.set(jpeg.subarray(2), 2 + app0.length)

    expect(jpegSize(withApp0)).toEqual({ width: 640, height: 480 })
  })

  it('dispatches on the magic bytes rather than on a claimed format', () => {
    expect(rasterSize(pngBytes(12, 34))).toEqual({ width: 12, height: 34 })
    expect(rasterSize(jpegBytes(56, 78))).toEqual({ width: 56, height: 78 })
    expect(rasterSize(Uint8Array.of(0x49, 0x49, 0x2a, 0x00))).toBeNull()
  })
})

describe('the ceiling', () => {
  it('is the conservative platform budget when the device is unknown', () => {
    // The worker carries no `Capabilities` (`lib/worker/types.ts`), so an engine
    // that is not told the budget has to assume the smallest one any platform
    // gets — the same answer `budgetForUnhandledPlatform` gives for the same
    // reason. Guessing upwards here is a killed tab on an iPhone.
    expect(CONSERVATIVE_BUDGET_BYTES).toBe(IOS_BUDGET_BYTES)
  })

  it('divides the budget by what one decoded pixel costs', () => {
    expect(maxDecodedPixels(4, 40_000_000)).toBe(10_000_000)
  })

  it('grows with the budget a caller supplies', () => {
    expect(maxDecodedPixels(4, 400_000_000)).toBe(100_000_000)
  })

  it('falls back to the conservative budget when none is given', () => {
    expect(maxDecodedPixels(4)).toBe(maxDecodedPixels(4, CONSERVATIVE_BUDGET_BYTES))
  })
})

describe('refusing a job by its decoded pixels', () => {
  const fits = { size: { width: 100, height: 100 }, bytesPerPixel: 4, budgetBytes: 40_000_000 }

  it('admits a job that fits', () => {
    expect(() => assertDecodedPixelsFit({ label: '"small.png"', ...fits })).not.toThrow()
  })

  it('admits a job exactly on the limit', () => {
    expect(() =>
      assertDecodedPixelsFit({
        label: '"exact.png"',
        size: { width: 2500, height: 4000 },
        bytesPerPixel: 4,
        budgetBytes: 40_000_000,
      }),
    ).not.toThrow()
  })

  it('names the image, its dimensions and what would fit', () => {
    expect(() =>
      assertDecodedPixelsFit({
        label: '"holiday.png"',
        size: { width: 6000, height: 8000 },
        bytesPerPixel: 4,
        budgetBytes: 40_000_000,
      }),
    ).toThrow(/"holiday\.png" is 6000 × 8000 pixels[\s\S]*10\.0 megapixels[\s\S]*[Rr]esize/)
  })

  it('says the job total, not just this image, once several have accumulated', () => {
    expect(() =>
      assertDecodedPixelsFit({
        label: '"page-09.png"',
        size: { width: 1500, height: 2000 },
        jobPixels: 36_000_000,
        bytesPerPixel: 4,
        budgetBytes: 40_000_000,
      }),
    ).toThrow(/"page-09\.png" is 1500 × 2000 pixels[\s\S]*36\.0 megapixels[\s\S]*fewer images/)
  })

  it('refuses before anything could have been allocated, so it never throws lazily', () => {
    // A guard that returns a promise would already have let the caller start the
    // decode. Synchronous is the whole contract.
    const call = () =>
      assertDecodedPixelsFit({
        label: '"x.png"',
        size: { width: 20_000, height: 20_000 },
        bytesPerPixel: 4,
        budgetBytes: 40_000_000,
      })

    expect(call).toThrow(Error)
  })
})

describe('the per-pixel costs', () => {
  it('charges pdf-lib what the sweep measured', () => {
    // `docs/router/memory-budget-measurement.md`, "the decoded-pixel ceiling".
    // Changing this number changes which jobs the engine refuses, so it is
    // asserted here rather than only described.
    expect(PDFLIB_DECODED_BYTES_PER_PIXEL).toBe(8)
  })

  it('charges a browser bitmap for the pixels and the surface they are drawn onto', () => {
    expect(BITMAP_DECODED_BYTES_PER_PIXEL).toBe(8)
  })

  it('refuses the twelve flat screenshots that opened the issue, on a phone', () => {
    // 12 × 1500 × 2000 weighs 750 kB and measured 202 MB through pdf-lib. The
    // router prices it at 35 MB and routes it happily onto a 90 MB iPhone; this
    // is the number that stops it.
    expect(maxDecodedPixels(PDFLIB_DECODED_BYTES_PER_PIXEL)).toBeLessThan(12 * 1500 * 2000)
  })

  it('still admits a 300 dpi A4 page on a phone', () => {
    // 2480 × 3508 is what a scanner app produces, and a guard that refused one
    // page of it would be worse than the crash it prevents.
    expect(maxDecodedPixels(PDFLIB_DECODED_BYTES_PER_PIXEL)).toBeGreaterThan(2480 * 3508)
  })

  it('lets a desktop budget through what a phone budget refuses', () => {
    // The ceiling is a function of the budget, not a constant, so the day the
    // worker learns its `Capabilities` this scales rather than being rewritten.
    expect(maxDecodedPixels(PDFLIB_DECODED_BYTES_PER_PIXEL, 1200 * 1024 * 1024)).toBeGreaterThan(
      12 * 1500 * 2000,
    )
  })
})
