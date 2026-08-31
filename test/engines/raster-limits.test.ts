// @vitest-environment node
//
// Pure arithmetic and two sentences, so nothing here needs a DOM. The point of
// the module is that it answers *before* a decoder is handed anything, which is
// exactly what makes it testable without one. The header readers it consumes
// live in `./raster-size` and are tested there.

import { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE } from '@/lib/engines/canvas-limits'
import { describe, expect, it } from 'vitest'

import {
  assertBitmapFits,
  assertDecodedPixelsFit,
  DEFAULT_BUDGET_BYTES,
  imageLabel,
  maxDecodedPixels,
  PDFLIB_DECODED_BYTES_PER_PIXEL,
} from '@/lib/engines/raster-limits'
import { DESKTOP_BUDGET_FLOOR_BYTES, IOS_BUDGET_BYTES } from '@/lib/router/budget'

describe('naming the image in a refusal', () => {
  it('quotes the file name when there is one', () => {
    expect(imageLabel(new File([], 'holiday.png'))).toBe('"holiday.png"')
  })

  it('falls back to the position in a multi-file job', () => {
    expect(imageLabel(new Blob([]), 1)).toBe('Image 2')
  })

  it('reads as a sentence when a single-file engine has no name to quote', () => {
    expect(imageLabel(new Blob([]))).toBe('This image')
  })
})

describe('the budget ceiling', () => {
  it('assumes the desktop floor when the caller does not say which device this is', () => {
    // Not the iOS ceiling, deliberately: the router already applied the real
    // device budget to the job's bytes, and assuming a phone here would refuse
    // on a workstation a job measured well inside its allowance.
    expect(DEFAULT_BUDGET_BYTES).toBe(DESKTOP_BUDGET_FLOOR_BYTES)
  })

  it('divides the budget by what one decoded pixel costs', () => {
    expect(maxDecodedPixels(4, 40_000_000)).toBe(10_000_000)
  })

  it('grows with the budget a caller supplies', () => {
    expect(maxDecodedPixels(4, 400_000_000)).toBe(100_000_000)
  })

  it('falls back to the default budget when none is given', () => {
    expect(maxDecodedPixels(4)).toBe(maxDecodedPixels(4, DEFAULT_BUDGET_BYTES))
  })

  it('answers zero rather than infinity for a per-pixel cost that is not a cost', () => {
    // The worst failure a memory ceiling can have is silently admitting
    // everything, which is what `budget / 0` would do.
    expect(maxDecodedPixels(0, 40_000_000)).toBe(0)
    expect(maxDecodedPixels(Number.NaN, 40_000_000)).toBe(0)
    expect(maxDecodedPixels(-4, 40_000_000)).toBe(0)
  })

  it('answers zero for a budget that is not a budget', () => {
    expect(maxDecodedPixels(4, Number.NaN)).toBe(0)
    expect(maxDecodedPixels(4, 0)).toBe(0)
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
    ).toThrow(/"holiday\.png" is 6000 × 8000 pixels[\s\S]*10\.0 megapixels[\s\S]*resize tool/)
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

  it('ignores a running total that is smaller than the image in hand', () => {
    // A caller that under-reports must not be able to talk one huge file past
    // the ceiling.
    expect(() =>
      assertDecodedPixelsFit({
        label: '"poster.png"',
        size: { width: 6000, height: 8000 },
        jobPixels: 1,
        bytesPerPixel: 4,
        budgetBytes: 40_000_000,
      }),
    ).toThrow(/"poster\.png" is 6000 × 8000 pixels/)
  })

  it('never suggests resizing below a size that is not a size', () => {
    expect(() =>
      assertDecodedPixelsFit({
        label: '"x.png"',
        size: { width: 100, height: 100 },
        bytesPerPixel: 4,
        budgetBytes: 4,
      }),
    ).toThrow(/under 10 × 10 pixels/)
  })
})

describe('refusing an image no browser bitmap could hold', () => {
  it('admits a 48 megapixel camera file, which every browser decodes', () => {
    expect(() => assertBitmapFits('"dslr.jpg"', { width: 8000, height: 6000 })).not.toThrow()
  })

  it('admits an image exactly on both limits', () => {
    expect(() =>
      assertBitmapFits('"square.png"', { width: MAX_CANVAS_SIDE, height: 4096 }),
    ).not.toThrow()
  })

  it('refuses one axis past what Safari will allocate', () => {
    expect(() =>
      assertBitmapFits('"banner.png"', { width: MAX_CANVAS_SIDE + 1, height: 10 }),
    ).toThrow(/"banner\.png" is 16385 × 10 pixels[\s\S]*larger than a browser canvas can hold/)
  })

  it('refuses a total area past what a canvas will hold, whatever its shape', () => {
    expect(() => assertBitmapFits('"wall.png"', { width: 16_000, height: 16_000 })).toThrow(
      /larger than a browser canvas can hold[\s\S]*resize tool/,
    )
  })

  it('is not derived from the memory budget, so it does not move with the device', () => {
    // Sized from what a canvas can hold, which is a fact, rather than from an
    // unmeasured per-pixel cost against a conservative budget — which would
    // refuse a 12 megapixel phone photo.
    expect(MAX_CANVAS_PIXELS).toBeGreaterThan(4032 * 3024)
  })
})

describe('the measured per-pixel cost', () => {
  it('charges pdf-lib what the sweep measured', () => {
    // `docs/router/memory-budget-measurement.md`, "the decoded-pixel ceiling".
    // Changing this changes which jobs the engine refuses, so it is asserted
    // here rather than only described.
    expect(PDFLIB_DECODED_BYTES_PER_PIXEL).toBe(8)
  })

  it('refuses the twelve flat screenshots that opened the issue', () => {
    // 12 × 1500 × 2000 weighs 750 kB and measured up to 193 MB through pdf-lib.
    // The router prices it at 35 MB and routes it happily; this is what stops it.
    expect(maxDecodedPixels(PDFLIB_DECODED_BYTES_PER_PIXEL)).toBeLessThan(12 * 1500 * 2000)
  })

  it('still admits two 300 dpi A4 scans in one document', () => {
    // 2480 × 3508 is what a scanner app produces, and refusing a two-page
    // document of them would be worse than the crash it prevents.
    expect(maxDecodedPixels(PDFLIB_DECODED_BYTES_PER_PIXEL)).toBeGreaterThan(2 * 2480 * 3508)
  })

  it('tightens on a phone and loosens on a desktop', () => {
    // The ceiling is a function of the budget, not a constant, so the day the
    // worker is told its `Capabilities` this scales rather than being rewritten.
    const phone = maxDecodedPixels(PDFLIB_DECODED_BYTES_PER_PIXEL, IOS_BUDGET_BYTES)
    const desktop = maxDecodedPixels(PDFLIB_DECODED_BYTES_PER_PIXEL, 1200 * 1024 * 1024)

    expect(phone).toBeLessThan(DEFAULT_BUDGET_BYTES / PDFLIB_DECODED_BYTES_PER_PIXEL)
    expect(desktop).toBeGreaterThan(12 * 1500 * 2000)
  })
})
