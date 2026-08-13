/**
 * The 250 ms progress contract, asserted on the clock rather than against it.
 *
 * Every one of these tests runs on fake timers. Sleeping for real would make the
 * suite slow *and* flaky — a 250 ms assertion against `setTimeout` on a loaded
 * CI box is a coin toss — whereas advancing the clock by hand makes the
 * guarantee exact: the assertion is "at tick 250 there is a message", not
 * "roughly a quarter of a second later there probably was one".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PROGRESS_INTERVAL_MS, createProgressRelay } from '@/lib/worker/progress-relay'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the progress relay', () => {
  it('sends the first tick straight through, so the UI moves the moment work starts', () => {
    const sent: number[] = []
    const relay = createProgressRelay((p) => void sent.push(p))

    relay.report(0.1)

    expect(sent).toEqual([0.1])
  })

  it('coalesces a burst into one message per window, carrying the newest value', () => {
    const sent: number[] = []
    const relay = createProgressRelay((p) => void sent.push(p))

    relay.report(0.1)
    for (let i = 2; i <= 50; i += 1) relay.report(i / 100)

    expect(sent).toEqual([0.1])

    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS)

    expect(sent).toEqual([0.1, 0.5])
  })

  it('keeps talking while the engine is quiet, so a stalled job still looks alive', () => {
    const sent: number[] = []
    const relay = createProgressRelay((p) => void sent.push(p))

    relay.report(0.4)
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS * 3)

    expect(sent).toEqual([0.4, 0.4, 0.4, 0.4])
  })

  it('never lets more than the interval pass without a message', () => {
    const at: number[] = []
    const relay = createProgressRelay(() => void at.push(Date.now()))
    const started = Date.now()

    relay.report(0)
    for (let window = 1; window <= 8; window += 1) {
      vi.advanceTimersByTime(PROGRESS_INTERVAL_MS)
      relay.report(window / 10)
    }

    expect(at).toHaveLength(9)
    expect(at[0]).toBe(started)
    for (let i = 1; i < at.length; i += 1) {
      expect(at[i] - at[i - 1]).toBeLessThanOrEqual(PROGRESS_INTERVAL_MS)
    }
  })

  it('flushes the value the job ended on, so 100% is never swallowed', () => {
    const sent: number[] = []
    const relay = createProgressRelay((p) => void sent.push(p))

    relay.report(0.9)
    relay.report(1)
    relay.stop()

    expect(sent).toEqual([0.9, 1])
  })

  it('has nothing left to flush when the window already carried the last value', () => {
    const sent: number[] = []
    const relay = createProgressRelay((p) => void sent.push(p))

    relay.report(0.5)
    relay.report(0.7)
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS)
    relay.stop()

    expect(sent).toEqual([0.5, 0.7])
  })

  it('goes silent after the job settles', () => {
    const sent: number[] = []
    const relay = createProgressRelay((p) => void sent.push(p))

    relay.report(0.3)
    relay.stop()
    relay.report(0.6)
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS * 4)

    expect(sent).toEqual([0.3])
  })

  it('leaves no timer behind, so a finished job cannot keep the worker awake', () => {
    const relay = createProgressRelay(() => {})

    relay.report(0.3)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    relay.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('survives being stopped twice', () => {
    const sent: number[] = []
    const relay = createProgressRelay((p) => void sent.push(p))

    relay.report(0.2)
    relay.report(0.8)
    relay.stop()
    relay.stop()

    expect(sent).toEqual([0.2, 0.8])
  })

  it('stops cleanly when the engine never reported anything', () => {
    const sent: number[] = []
    const relay = createProgressRelay((p) => void sent.push(p))

    expect(() => relay.stop()).not.toThrow()
    expect(sent).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes the indeterminate marker through untouched', () => {
    const sent: number[] = []
    const relay = createProgressRelay((p) => void sent.push(p))

    relay.report(-1)
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS)

    expect(sent).toEqual([-1, -1])
  })

  it('holds the engine contract from lib/engines/types.ts at 250 ms', () => {
    expect(PROGRESS_INTERVAL_MS).toBe(250)
  })
})
