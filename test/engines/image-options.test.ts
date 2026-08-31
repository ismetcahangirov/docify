import { describe, expect, it } from 'vitest'

import {
  DEFAULT_QUALITY,
  MAX_QUALITY,
  MIN_QUALITY,
  resolveQuality,
  resolveTargetBytes,
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

describe('resolveTargetBytes', () => {
  it('reports the requested ceiling when one was asked for', () => {
    expect(resolveTargetBytes({ targetBytes: 500_000 })).toBe(500_000)
  })

  it('is undefined when the job named no target, which is not the same as a target of zero', () => {
    expect(resolveTargetBytes(undefined)).toBeUndefined()
    expect(resolveTargetBytes({})).toBeUndefined()
    expect(resolveTargetBytes({ quality: 90 })).toBeUndefined()
  })

  it('ignores a target no file could ever meet rather than failing the job', () => {
    // A zero or negative ceiling is a broken form field, not an instruction. The
    // search would spend eight full re-encodes discovering that nothing fits and
    // then hand back the quality-1 file anyway, so it is better not to start.
    expect(resolveTargetBytes({ targetBytes: 0 })).toBeUndefined()
    expect(resolveTargetBytes({ targetBytes: -1 })).toBeUndefined()
    expect(resolveTargetBytes({ targetBytes: Number.NaN })).toBeUndefined()
    expect(resolveTargetBytes({ targetBytes: Number.POSITIVE_INFINITY })).toBeUndefined()
  })

  it('rounds to a whole number of bytes, because half a byte is not a size', () => {
    expect(resolveTargetBytes({ targetBytes: 1024.7 })).toBe(1024)
  })
})
