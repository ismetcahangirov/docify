import { describe, expect, it } from 'vitest'

import {
  clampCrop,
  isIdentity,
  needsWholeImage,
  outputSize,
  planGeometry,
  resizedSize,
} from '@/lib/engines/image-geometry'
import type { ImageOptions } from '@/lib/engines/image-options'

const landscape = { width: 1200, height: 800 }

const sizeOf = (options: ImageOptions, source = landscape) =>
  outputSize(planGeometry(options, source), source)

describe('planGeometry', () => {
  it('plans nothing for a job that asks for nothing', () => {
    const plan = planGeometry(undefined, landscape)

    expect(plan).toEqual({ crop: null, resize: null, rotate: 0, flip: null })
    expect(isIdentity(plan)).toBe(true)
  })

  it('measures the resize against the cropped image, not the original', () => {
    // The user cropped to a square and then asked for 200 wide. Fitting that
    // against the 1200 x 800 original would produce a 200 x 133 letterbox of an
    // image that no longer has that shape.
    const plan = planGeometry(
      { crop: { left: 0, top: 0, width: 800, height: 800 }, width: 200 },
      landscape,
    )

    expect(outputSize(plan, landscape)).toEqual({ width: 200, height: 200 })
  })

  it('drops a dimension that means nothing rather than failing the job', () => {
    expect(planGeometry({ width: Number.NaN, height: 400 }, landscape).resize).toMatchObject({
      width: undefined,
      height: 400,
    })
    expect(planGeometry({ width: 0 }, landscape).resize).toBeNull()
  })

  it('is not a resize when the requested size is the size it already is', () => {
    // Keeps a rotate-only job on the engine's streaming path instead of routing
    // it through a scaler that would do nothing.
    expect(planGeometry({ width: 1200, height: 800 }, landscape).resize).toBeNull()
  })
})

describe('aspect-ratio locking', () => {
  it('fits inside the box and keeps the proportions, by default', () => {
    expect(sizeOf({ width: 600, height: 600 })).toEqual({ width: 600, height: 400 })
  })

  it('derives the other axis when only one is given', () => {
    expect(sizeOf({ width: 600 })).toEqual({ width: 600, height: 400 })
    expect(sizeOf({ height: 400 })).toEqual({ width: 600, height: 400 })
  })

  it('stretches to exactly the requested size once the lock is off', () => {
    expect(sizeOf({ width: 600, height: 600, lockAspectRatio: false })).toEqual({
      width: 600,
      height: 600,
    })
  })

  it('ignores an unlocked ratio when only one axis was given, since nothing can disagree', () => {
    expect(sizeOf({ width: 600, lockAspectRatio: false })).toEqual({ width: 600, height: 400 })
  })

  it('refuses to enlarge unless asked, so no detail is invented', () => {
    expect(sizeOf({ width: 4000 })).toEqual(landscape)
    expect(sizeOf({ width: 4000, enlarge: true })).toEqual({ width: 4000, height: 2667 })
  })

  it('takes an explicit stretch at its word, enlargement included', () => {
    // Turning the lock off and naming both axes is as explicit as a request
    // gets; refusing to grow it would leave the user with neither their ratio
    // nor their size.
    expect(sizeOf({ width: 2000, height: 2000, lockAspectRatio: false })).toEqual({
      width: 2000,
      height: 2000,
    })
  })

  it('never rounds an axis down to nothing', () => {
    expect(
      resizedSize({ width: 100, stretch: false, enlarge: false }, { width: 4000, height: 3 }),
    ).toEqual({ width: 100, height: 1 })
  })
})

describe('rotate and flip', () => {
  it('swaps the axes on a quarter turn and leaves them on a half turn', () => {
    expect(sizeOf({ rotate: 90 })).toEqual({ width: 800, height: 1200 })
    expect(sizeOf({ rotate: 270 })).toEqual({ width: 800, height: 1200 })
    expect(sizeOf({ rotate: 180 })).toEqual(landscape)
  })

  it('applies the requested size before the turn, in the axes the user typed them', () => {
    // 600 wide is 600 wide on the picture the user was looking at. Rotating
    // first would quietly reinterpret it as 600 tall.
    expect(sizeOf({ width: 600, rotate: 90 })).toEqual({ width: 400, height: 600 })
  })

  it('leaves the size alone for a flip', () => {
    expect(sizeOf({ flip: 'horizontal' })).toEqual(landscape)
    expect(sizeOf({ flip: 'vertical' })).toEqual(landscape)
  })

  it('knows which jobs cannot be streamed a scanline at a time', () => {
    const plan = (options: ImageOptions) => needsWholeImage(planGeometry(options, landscape))

    // Cropping and resizing read forwards; rotating and flipping do not.
    expect(plan({ crop: { left: 10, top: 10, width: 100, height: 100 } })).toBe(false)
    expect(plan({ width: 600 })).toBe(false)
    expect(plan({ rotate: 90 })).toBe(true)
    expect(plan({ rotate: 180 })).toBe(true)
    expect(plan({ flip: 'horizontal' })).toBe(true)
  })
})

describe('clampCrop', () => {
  it('keeps a rectangle that is already inside the picture', () => {
    expect(clampCrop({ left: 100, top: 50, width: 400, height: 300 }, landscape)).toEqual({
      left: 100,
      top: 50,
      width: 400,
      height: 300,
    })
  })

  it('intersects a selection dragged past the edge', () => {
    // Dragging a crop handle off the image is how people use one; the rectangle
    // they can see is the rectangle they mean.
    expect(clampCrop({ left: -50, top: -50, width: 300, height: 300 }, landscape)).toEqual({
      left: 0,
      top: 0,
      width: 250,
      height: 250,
    })
    expect(clampCrop({ left: 1000, top: 700, width: 999, height: 999 }, landscape)).toEqual({
      left: 1000,
      top: 700,
      width: 200,
      height: 100,
    })
  })

  it('is not a crop when the rectangle is the whole picture', () => {
    expect(clampCrop({ left: 0, top: 0, width: 1200, height: 800 }, landscape)).toBeNull()
    expect(clampCrop(undefined, landscape)).toBeNull()
  })

  it('refuses a rectangle that overlaps nothing, and says which numbers were impossible', () => {
    expect(() => clampCrop({ left: 2000, top: 0, width: 100, height: 100 }, landscape)).toThrow(
      /does not overlap the image, which is 1200 × 800 pixels/,
    )
    expect(() => clampCrop({ left: 10, top: 10, width: 0, height: 100 }, landscape)).toThrow(
      /Choose an area inside it/,
    )
  })

  it('works in whole pixels, because half a pixel cannot be cut', () => {
    expect(clampCrop({ left: 10.7, top: 10.2, width: 100.9, height: 100.9 }, landscape)).toEqual({
      left: 10,
      top: 10,
      width: 101,
      height: 101,
    })
  })
})
