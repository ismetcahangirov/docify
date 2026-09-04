import { describe, expect, it } from 'vitest'

import { createRateLimiter } from '@/lib/api/rate-limit'

/*
 * A fixed-window limiter, driven by an injected clock so the tests take no time
 * and no `vi.useFakeTimers()` (issue #84).
 *
 * The interesting assertions are not "it counts to sixty". They are what the
 * limiter does with the memory it is holding: an unbounded `Map` keyed by
 * something a caller controls is a denial-of-service surface of its own, and a
 * counter endpoint is exactly the sort of thing somebody points a script at.
 */

describe('createRateLimiter', () => {
  it('allows up to the limit inside one window', () => {
    let now = 1_000
    const limiter = createRateLimiter({ limit: 3, windowMs: 1_000, now: () => now })

    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(false)

    now += 999
    expect(limiter.check('a')).toBe(false)
  })

  it('starts a new window once the old one has passed', () => {
    let now = 1_000
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now })

    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(false)

    now += 1_000
    expect(limiter.check('a')).toBe(true)
  })

  it('counts each key separately', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => 0 })

    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('b')).toBe(true)
    expect(limiter.check('a')).toBe(false)
  })

  it('forgets a key whose window has expired, rather than growing forever', () => {
    let now = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 100, now: () => now })

    for (let i = 0; i < 500; i += 1) {
      limiter.check(`key-${i}`)
      now += 1
    }

    // Every key minted more than one window ago is gone; only the recent ones
    // are still being counted.
    expect(limiter.size()).toBeLessThanOrEqual(101)
  })

  it('drops everything rather than exceed its hard ceiling', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 50, now: () => 0 })

    // Same instant for all of them, so expiry cannot be what keeps the map
    // small — only the ceiling can.
    for (let i = 0; i < 500; i += 1) limiter.check(`key-${i}`)

    expect(limiter.size()).toBeLessThanOrEqual(50)
  })

  it('stays permissive when it has to forget, rather than locking everyone out', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2, now: () => 0 })

    limiter.check('a')
    limiter.check('b')
    limiter.check('c')

    // 'a' was evicted by the ceiling, so it gets a fresh allowance. A limiter
    // under memory pressure letting a request through is a counter being
    // double-counted; the other way round is a working conversion being
    // refused, and this endpoint is never worth that.
    expect(limiter.check('a')).toBe(true)
  })
})
