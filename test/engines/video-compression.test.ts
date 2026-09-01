// @vitest-environment node

/**
 * The four sizing methods, checked as arithmetic rather than as output.
 *
 * Every one of them is a pure function of the job and the source, so the whole
 * policy — what a target size becomes, what a CRF is worth in bits, what a
 * ceiling does to a constant-quality encode — is provable without a codec in the
 * room. The engines that consume the answers are tested separately.
 */

import { describe, expect, it } from 'vitest'

import {
  bitrateForCrf,
  bitrateForTargetSize,
  clampCrf,
  CRF_HALVING_STEP,
  DEFAULT_CRF,
  MAX_CRF,
  MIN_CRF,
  resolveVideoEncode,
  TARGET_SIZE_HEADROOM,
} from '@/lib/engines/video-compression'
import type { VideoOptions } from '@/lib/engines/video-options'
import { BITS_PER_PIXEL_PER_SECOND, MIN_BITRATE } from '@/lib/engines/video-options'

/** A minute of video with a 128 kbps soundtrack. */
const minute = { durationSeconds: 60, audioBitrate: 128_000 }

/** Nothing could be read about the source: the case a target size cannot survive. */
const unmeasured = { durationSeconds: 0, audioBitrate: 0 }

describe('clampCrf', () => {
  it('keeps a sensible value untouched', () => {
    expect(clampCrf(18)).toBe(18)
    expect(clampCrf(DEFAULT_CRF)).toBe(DEFAULT_CRF)
  })

  it('pulls a value outside the scale back onto it rather than refusing it', () => {
    // A slider that reports its own maximum should produce the worst legal
    // picture, not an error half way through a conversion.
    expect(clampCrf(-5)).toBe(MIN_CRF)
    expect(clampCrf(99)).toBe(MAX_CRF)
  })

  it('rounds, because the scale is integers', () => {
    expect(clampCrf(20.4)).toBe(20)
    expect(clampCrf(20.6)).toBe(21)
  })

  it('answers the default for a value that is not a number at all', () => {
    expect(clampCrf(Number.NaN)).toBe(DEFAULT_CRF)
  })
})

describe('bitrateForTargetSize', () => {
  it('spends the whole target across the running time, less the sound', () => {
    const bitrate = bitrateForTargetSize(10 * 1024 * 1024, minute)

    // 10 MiB with 3% held back for the container, minus 60 s of 128 kbps audio,
    // spread over 60 seconds.
    const expected = Math.round((10 * 1024 * 1024 * 8 * TARGET_SIZE_HEADROOM - 128_000 * 60) / 60)
    expect(bitrate).toBe(expected)
  })

  it('holds a little back, so the container overhead does not overshoot the target', () => {
    const naive = (10 * 1024 * 1024 * 8) / 60
    const bitrate = bitrateForTargetSize(10 * 1024 * 1024, { ...minute, audioBitrate: 0 })

    expect(bitrate).toBeLessThan(naive)
    expect(TARGET_SIZE_HEADROOM).toBeLessThan(1)
  })

  it('never asks for a rate below the floor, however small the target', () => {
    expect(bitrateForTargetSize(1024, minute)).toBe(MIN_BITRATE)
  })

  it('answers null when nothing could say how long the video is', () => {
    // Not a zero bitrate and not a guess: the caller has to say so, because
    // silently ignoring a size the user typed is the worst outcome available.
    expect(bitrateForTargetSize(10 * 1024 * 1024, unmeasured)).toBeNull()
  })
})

describe('bitrateForCrf', () => {
  const size = { width: 1920, height: 1080, frameRate: 30 }

  it('reproduces the default rate at the default quality', () => {
    expect(bitrateForCrf(DEFAULT_CRF, size.width, size.height, size.frameRate)).toBe(
      Math.round(size.width * size.height * size.frameRate * BITS_PER_PIXEL_PER_SECOND),
    )
  })

  it('doubles the rate for every step down the scale, which is what CRF means', () => {
    const base = bitrateForCrf(DEFAULT_CRF, size.width, size.height, size.frameRate)
    const better = bitrateForCrf(
      DEFAULT_CRF - CRF_HALVING_STEP,
      size.width,
      size.height,
      size.frameRate,
    )
    const worse = bitrateForCrf(
      DEFAULT_CRF + CRF_HALVING_STEP,
      size.width,
      size.height,
      size.frameRate,
    )

    expect(better).toBe(base * 2)
    expect(worse).toBe(base / 2)
  })

  it('never drops below the floor at the worst quality on the scale', () => {
    expect(bitrateForCrf(MAX_CRF, 64, 64, 1)).toBe(MIN_BITRATE)
  })
})

describe('resolveVideoEncode', () => {
  it('changes nothing when the job names no method', () => {
    const options: VideoOptions = { width: 1280, bitrate: 2_000_000, frameRate: 24 }

    expect(resolveVideoEncode(options, minute)).toEqual({
      width: 1280,
      height: undefined,
      bitrate: 2_000_000,
      frameRate: 24,
    })
  })

  it('answers an empty plan for a job with no settings at all', () => {
    expect(resolveVideoEncode(undefined, minute)).toEqual({
      width: undefined,
      height: undefined,
      bitrate: undefined,
      frameRate: undefined,
    })
  })

  describe('target size', () => {
    it('turns the size into the bitrate that fills it', () => {
      const plan = resolveVideoEncode(
        { compression: { method: 'target-size', targetBytes: 10 * 1024 * 1024 } },
        minute,
      )

      expect(plan.bitrate).toBe(bitrateForTargetSize(10 * 1024 * 1024, minute))
      // A fixed rate and a constant quality are opposites; asking for both is
      // asking the encoder to ignore one of them.
      expect(plan.crf).toBeUndefined()
    })

    it('overrides a bitrate the job also carried, because the size is the newer answer', () => {
      const plan = resolveVideoEncode(
        {
          bitrate: 9_000_000,
          compression: { method: 'target-size', targetBytes: 4 * 1024 * 1024 },
        },
        minute,
      )

      expect(plan.bitrate).toBe(bitrateForTargetSize(4 * 1024 * 1024, minute))
    })

    it('says so rather than guessing when the running time is unknown', () => {
      expect(() =>
        resolveVideoEncode(
          { compression: { method: 'target-size', targetBytes: 4 * 1024 * 1024 } },
          unmeasured,
        ),
      ).toThrow(/how long/i)
    })
  })

  describe('quality', () => {
    it('carries the CRF through and fixes no bitrate', () => {
      const plan = resolveVideoEncode({ compression: { method: 'quality', crf: 18 } }, minute)

      expect(plan.crf).toBe(18)
      expect(plan.bitrate).toBeUndefined()
      expect(plan.maxBitrate).toBeUndefined()
    })

    it('clamps a value off the end of the scale', () => {
      expect(resolveVideoEncode({ compression: { method: 'quality', crf: 80 } }, minute).crf).toBe(
        MAX_CRF,
      )
    })

    it('drops a bitrate the job also carried', () => {
      const plan = resolveVideoEncode(
        { bitrate: 5_000_000, compression: { method: 'quality', crf: 20 } },
        minute,
      )

      expect(plan.bitrate).toBeUndefined()
    })
  })

  describe('max bitrate', () => {
    it('caps a constant-quality encode rather than fixing its rate', () => {
      // The industry-standard "constrained quality" control: encode at a
      // quality, but never exceed this rate on a hard scene.
      const plan = resolveVideoEncode(
        { compression: { method: 'max-bitrate', bitrate: 3_000_000 } },
        minute,
      )

      expect(plan.maxBitrate).toBe(3_000_000)
      expect(plan.crf).toBe(DEFAULT_CRF)
      expect(plan.bitrate).toBeUndefined()
    })

    it('never accepts a ceiling below the floor', () => {
      expect(
        resolveVideoEncode({ compression: { method: 'max-bitrate', bitrate: 10 } }, minute)
          .maxBitrate,
      ).toBe(MIN_BITRATE)
    })
  })

  describe('resize', () => {
    it('takes the size from the method and leaves the rate to be derived', () => {
      const plan = resolveVideoEncode(
        { compression: { method: 'resize', width: 1280, height: 720 } },
        minute,
      )

      expect(plan).toMatchObject({ width: 1280, height: 720 })
      expect(plan.bitrate).toBeUndefined()
      expect(plan.crf).toBeUndefined()
    })

    it('falls back to the size the job already carried', () => {
      const plan = resolveVideoEncode(
        { width: 640, height: 480, compression: { method: 'resize' } },
        minute,
      )

      expect(plan).toMatchObject({ width: 640, height: 480 })
    })

    it('keeps a bitrate the job named, because a resize says nothing about rate', () => {
      const plan = resolveVideoEncode(
        { bitrate: 1_500_000, compression: { method: 'resize', width: 854 } },
        minute,
      )

      expect(plan.bitrate).toBe(1_500_000)
    })
  })

  it('carries the frame rate through every method, because it is not one of them', () => {
    for (const compression of [
      { method: 'target-size', targetBytes: 8 * 1024 * 1024 },
      { method: 'quality', crf: 22 },
      { method: 'max-bitrate', bitrate: 2_000_000 },
      { method: 'resize', width: 640 },
    ] as const) {
      expect(resolveVideoEncode({ frameRate: 24, compression }, minute).frameRate).toBe(24)
    }
  })
})
