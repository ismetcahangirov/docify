// @vitest-environment node

/**
 * The ETA (issue #58), tested as arithmetic and as restraint.
 *
 * Half the assertions here are about *not* answering. An estimate is a promise,
 * and the interesting failures are the ones where a converter makes a promise it
 * has no business making — a number derived from a hundred milliseconds of
 * noise, or from a fraction so small the division explodes.
 */

import { describe, expect, it } from 'vitest'

import {
  etaLabel,
  formatRemaining,
  MIN_ELAPSED_MS,
  MIN_PROGRESS,
  remainingMs,
} from '@/lib/queue/eta'

const START = 1_700_000_000_000

/** A job that started at `START` and is `progress` of the way through at `now`. */
const at = (progress: number | null, elapsed: number) => ({
  source: { progress, startedAt: START },
  now: START + elapsed,
})

describe('remainingMs', () => {
  it('scales the time so far by how much is left', () => {
    // A quarter done after 10 seconds is 30 seconds to go.
    const { source, now } = at(0.25, 10_000)

    expect(remainingMs(source, now)).toBe(30_000)
  })

  it('answers zero once the job is finished', () => {
    const { source, now } = at(1, 10_000)

    expect(remainingMs(source, now)).toBe(0)
  })

  it('never answers a negative, however odd the numbers are', () => {
    const { source, now } = at(1.5, 10_000)

    expect(remainingMs(source, now)).toBe(0)
  })
})

describe('remainingMs — when it declines to answer', () => {
  it('says nothing before the job has run long enough to have a rate', () => {
    // The first fraction arrives while the engine is still warming its heap, so
    // it describes a rate that no longer exists a second later.
    const { source, now } = at(0.5, MIN_ELAPSED_MS - 1)

    expect(remainingMs(source, now)).toBeNull()
  })

  it('says nothing while the fraction is small enough to make the division explode', () => {
    // Where the ridiculous first estimate every download manager used to show
    // came from.
    const { source, now } = at(MIN_PROGRESS / 2, 10_000)

    expect(remainingMs(source, now)).toBeNull()
  })

  it('says nothing for an engine that cannot measure itself', () => {
    const { source, now } = at(-1, 10_000)

    expect(remainingMs(source, now)).toBeNull()
  })

  it('says nothing before anything has reported', () => {
    const { source, now } = at(null, 10_000)

    expect(remainingMs(source, now)).toBeNull()
  })

  it('says nothing for a job that has not started', () => {
    expect(remainingMs({ progress: 0.5 }, START)).toBeNull()
  })

  it('starts answering the moment both guards are satisfied', () => {
    const { source, now } = at(MIN_PROGRESS, MIN_ELAPSED_MS)

    expect(remainingMs(source, now)).toBeGreaterThan(0)
  })
})

describe('formatRemaining', () => {
  it('does not count out the last few seconds', () => {
    expect(formatRemaining(0)).toBe('a few seconds left')
    expect(formatRemaining(4_999)).toBe('a few seconds left')
  })

  it('rounds seconds to something that does not flicker', () => {
    // A number that changes every render is worse than a vaguer one that does
    // not.
    expect(formatRemaining(12_000)).toBe('about 15 seconds left')
    expect(formatRemaining(31_000)).toBe('about 35 seconds left')
  })

  it('switches to minutes, and gets the singular right', () => {
    expect(formatRemaining(61_000)).toBe('about 2 minutes left')
    expect(formatRemaining(59_500)).toBe('about 1 minute left')
  })

  it('stops pretending to be precise past an hour', () => {
    expect(formatRemaining(4 * 3_600_000)).toBe('over an hour left')
  })

  it('always rounds up, because finishing early is the pleasant surprise', () => {
    // 90.001 seconds is "about 2 minutes", never "about 1 minute".
    expect(formatRemaining(90_001)).toBe('about 2 minutes left')
  })
})

describe('etaLabel', () => {
  it('is the estimate in words when there is one', () => {
    const { source, now } = at(0.25, 10_000)

    expect(etaLabel(source, now)).toBe('about 30 seconds left')
  })

  it('is null whenever the estimate is, so a caller has one thing to check', () => {
    const { source, now } = at(-1, 10_000)

    expect(etaLabel(source, now)).toBeNull()
  })
})
