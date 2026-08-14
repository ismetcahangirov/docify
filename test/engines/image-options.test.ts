import { describe, expect, it } from 'vitest'

import {
  DEFAULT_QUALITY,
  MAX_QUALITY,
  MIN_QUALITY,
  resolveQuality,
  wantsResize,
} from '@/lib/engines/image-options'

describe('resolveQuality', () => {
  it('falls back to the shared default when nothing was asked for', () => {
    expect(resolveQuality(undefined)).toBe(DEFAULT_QUALITY)
    expect(resolveQuality({})).toBe(DEFAULT_QUALITY)
  })

  it('clamps rather than rejects, so a slider at either end still converts', () => {
    expect(resolveQuality({ quality: 0 })).toBe(DEFAULT_QUALITY)
    expect(resolveQuality({ quality: -20 })).toBe(DEFAULT_QUALITY)
    expect(resolveQuality({ quality: 1 })).toBe(MIN_QUALITY)
    expect(resolveQuality({ quality: 500 })).toBe(MAX_QUALITY)
  })

  it('rounds to the integer scale libvips expects', () => {
    expect(resolveQuality({ quality: 72.4 })).toBe(72)
    expect(resolveQuality({ quality: 72.6 })).toBe(73)
  })

  it('treats an unreadable number as no opinion', () => {
    expect(resolveQuality({ quality: Number.NaN })).toBe(DEFAULT_QUALITY)
  })
})

describe('wantsResize', () => {
  it('is true as soon as either axis is constrained', () => {
    expect(wantsResize({ width: 640 })).toBe(true)
    expect(wantsResize({ height: 480 })).toBe(true)
    expect(wantsResize({ width: 640, height: 480 })).toBe(true)
  })

  it('is false without a target, and for sizes that mean nothing', () => {
    expect(wantsResize(undefined)).toBe(false)
    expect(wantsResize({})).toBe(false)
    expect(wantsResize({ quality: 90 })).toBe(false)
    expect(wantsResize({ width: 0 })).toBe(false)
    expect(wantsResize({ width: -100 })).toBe(false)
  })
})
