import { describe, expect, it } from 'vitest'

import { MAX_QUALITY, MIN_QUALITY } from '@/lib/engines/image-options'
import { encodeToTargetSize, TARGET_SIZE_MAX_ATTEMPTS } from '@/lib/engines/image-target-size'

/**
 * A stand-in encoder whose output shrinks as quality falls.
 *
 * Linear rather than realistic on purpose: the search only relies on size being
 * monotonic in quality, and a straight line makes the quality the search settles
 * on arithmetic that a reader can check by hand.
 */
function linearEncoder(bytesPerQualityPoint: number) {
  const qualities: number[] = []

  return {
    qualities,
    encode(quality: number) {
      qualities.push(quality)
      return { output: `q${quality}`, bytes: quality * bytesPerQualityPoint }
    },
  }
}

describe('encodeToTargetSize', () => {
  it('spends a single encode when full quality already fits the target', () => {
    const encoder = linearEncoder(10)

    const result = encodeToTargetSize(5000, encoder.encode)

    // 100 × 10 = 1000 bytes, comfortably inside 5000. Probing the top first is
    // what keeps the common case — a target set as a safety cap on a file that
    // never comes near it — from paying for a full bisection.
    expect(encoder.qualities).toEqual([MAX_QUALITY])
    expect(result).toEqual({
      output: 'q100',
      quality: MAX_QUALITY,
      bytes: 1000,
      withinTarget: true,
      attempts: 1,
    })
  })

  it('settles on the highest quality that still fits', () => {
    const encoder = linearEncoder(10)

    // 640 bytes admits quality 64 and refuses 65.
    const result = encodeToTargetSize(640, encoder.encode)

    expect(result.quality).toBe(64)
    expect(result.bytes).toBe(640)
    expect(result.withinTarget).toBe(true)
  })

  it('treats the target as inclusive, so a file exactly on it is a success', () => {
    const encoder = linearEncoder(1)

    const result = encodeToTargetSize(40, encoder.encode)

    expect(result).toMatchObject({ quality: 40, bytes: 40, withinTarget: true })
  })

  it('returns the output it actually produced, not a promise of one', () => {
    const encoder = linearEncoder(10)

    const result = encodeToTargetSize(640, encoder.encode)

    // The winning attempt is kept as the search runs. Re-encoding at the end to
    // recover it would cost a whole extra pass over a full-resolution image.
    expect(result.output).toBe('q64')
    expect(encoder.qualities).toContain(64)
  })

  it('resolves any target within the attempt ceiling', () => {
    // Every reachable target, checked against the ceiling the runner budgets
    // for: a search that needed a ninth encode would silently return a
    // worse-than-necessary file.
    for (let quality = MIN_QUALITY; quality <= MAX_QUALITY; quality += 1) {
      const encoder = linearEncoder(10)

      const result = encodeToTargetSize(quality * 10, encoder.encode)

      expect(result.quality).toBe(quality)
      expect(result.attempts).toBeLessThanOrEqual(TARGET_SIZE_MAX_ATTEMPTS)
    }
  })

  it('never asks for a quality outside the encoder range', () => {
    const encoder = linearEncoder(10)

    encodeToTargetSize(1, encoder.encode)

    for (const quality of encoder.qualities) {
      expect(quality).toBeGreaterThanOrEqual(MIN_QUALITY)
      expect(quality).toBeLessThanOrEqual(MAX_QUALITY)
      expect(Number.isInteger(quality)).toBe(true)
    }
  })

  it('hands back the smallest file it could make when even the floor is too big', () => {
    const encoder = linearEncoder(10)

    // The floor produces 10 bytes and the target is 5: unreachable. Delivering
    // the smallest achievable file is better than failing the job — the user
    // asked to compress, and a file that missed the target is still the file
    // they asked for, with the UI free to say by how much it missed.
    const result = encodeToTargetSize(5, encoder.encode)

    expect(result).toMatchObject({
      output: `q${MIN_QUALITY}`,
      quality: MIN_QUALITY,
      bytes: 10,
      withinTarget: false,
    })
  })

  it('reports an unreachable target as a miss rather than throwing', () => {
    const encoder = linearEncoder(10)

    expect(encodeToTargetSize(0, encoder.encode).withinTarget).toBe(false)
    expect(encodeToTargetSize(-1, encoder.encode).withinTarget).toBe(false)
  })
})
