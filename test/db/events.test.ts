import { describe, expect, it } from 'vitest'

import { type ConversionEvent, OUTCOMES, SIZE_BUCKETS, sizeBucket } from '@/lib/db/events'
import { parseConversionEvent } from '@/lib/db/parse-event'
import { PAIR_SLUGS } from '@/lib/registry/pairs'

/*
 * The vocabulary is the privacy guarantee (issue #83).
 *
 * A counter table cannot leak what it has no column to hold, but that argument
 * only works if every column it does hold is a *closed* set. So the tests below
 * are less about parsing than about what a parser refuses: a pair that is not
 * one of the 125 pages, a bucket that is not one of five, an outcome that is
 * not one of two. Anything free-form — a file name, a path, an origin — has no
 * way through, and that is asserted rather than asserted-in-a-comment.
 */

const valid: ConversionEvent = { pair: 'heic-to-jpg', outcome: 'success', bucket: 'm' }

describe('the conversion event vocabulary', () => {
  it('accepts a well-formed event', () => {
    expect(parseConversionEvent(valid)).toEqual(valid)
  })

  it('accepts every pair that has a page', () => {
    for (const pair of PAIR_SLUGS) {
      expect(parseConversionEvent({ ...valid, pair })).not.toBeNull()
    }
  })

  it.each([
    ['a pair with no page', { ...valid, pair: 'docx-to-mp3' }],
    ['a pair that is a file name', { ...valid, pair: 'holiday-photos/DSC_0042.heic' }],
    ['an empty pair', { ...valid, pair: '' }],
    ['an unknown outcome', { ...valid, outcome: 'cancelled' }],
    ['an unknown bucket', { ...valid, bucket: 'xxl' }],
    ['a missing field', { pair: 'heic-to-jpg', outcome: 'success' }],
    ['a nested object', { ...valid, extra: { ip: '203.0.113.4' } }],
    ['a string', 'heic-to-jpg'],
    ['null', null],
    ['an array', [valid]],
  ])('refuses %s', (_label, input) => {
    expect(parseConversionEvent(input)).toBeNull()
  })

  it('keeps no field it was not asked for', () => {
    const parsed = parseConversionEvent({ ...valid, referrer: 'https://example.com/x' })

    // A surplus field is a refusal, not a silent strip: a client sending one is
    // a client that has misunderstood the contract, and answering 202 to it
    // would let the misunderstanding grow.
    expect(parsed).toBeNull()
  })

  it('declares five buckets and two outcomes', () => {
    expect(SIZE_BUCKETS).toEqual(['xs', 's', 'm', 'l', 'xl'])
    expect(OUTCOMES).toEqual(['success', 'failure'])
  })
})

describe('sizeBucket', () => {
  it.each([
    [0, 'xs'],
    [999_999, 'xs'],
    [1_000_000, 's'],
    [9_999_999, 's'],
    [10_000_000, 'm'],
    [99_999_999, 'm'],
    [100_000_000, 'l'],
    [999_999_999, 'l'],
    [1_000_000_000, 'xl'],
    [42_000_000_000, 'xl'],
  ])('puts %d bytes in %s', (bytes, bucket) => {
    expect(sizeBucket(bytes)).toBe(bucket)
  })

  it('is coarse enough that a bucket never identifies a file', () => {
    // Four orders of magnitude across five buckets. The point of the coarseness
    // is that "someone converted a 12 MB HEIC" is not a fact about a person.
    expect(new Set(SIZE_BUCKETS.map((b) => b)).size).toBe(5)
    expect(sizeBucket(10_000_000)).toBe(sizeBucket(99_000_000))
  })

  it('clamps a negative or non-finite size into the smallest bucket', () => {
    expect(sizeBucket(-1)).toBe('xs')
    expect(sizeBucket(Number.NaN)).toBe('xs')
  })
})
