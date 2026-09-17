// @vitest-environment node
//
// Deliberately not jsdom, for the reason `route-rejections.test.ts` gives: the
// router is only allowed to look at what it is handed.
//
// The override (issue #322). A job the budget refuses is refused by default and
// admitted when the caller says the user accepted the risk — and the two things
// that are *not* estimates, the bitmap ceiling and the capability gate, stay
// refused either way.

import { describe, expect, it, vi } from 'vitest'

import { MAX_CANVAS_PIXELS } from '@/lib/engines/canvas-limits'
import { budgetBytes, MEMORY, peakBytes } from '@/lib/router/budget'
import { formatBytes } from '@/lib/router/copy'
import { jobInput } from '@/lib/router/job'
import { route } from '@/lib/router/route'

import {
  canvas,
  chosen,
  desktop,
  fake,
  ffmpeg,
  GB,
  ios,
  jpgToPng,
  MB,
  mp4ToWebm,
  refused,
  register,
  resetRegistryBetweenTests,
  warningCodes,
  webcodecs,
} from './support/route-harness'

// `vi.mock` is hoisted to the top of the file, so the call cannot be shared —
// only the replacement module it returns, which the harness builds.
vi.mock('@/lib/engines/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engines/registry')>()

  return (await import('./support/route-harness')).mockedRegistry(actual)
})

resetRegistryBetweenTests()

/** Comfortably past every engine's ceiling on every device in the harness. */
const HUGE = 4 * GB

describe('route — the over-budget override', () => {
  it('still refuses an over-budget job when nothing is said', () => {
    register(webcodecs(), ffmpeg())

    expect(refused(route(mp4ToWebm, HUGE, desktop)).code).toBe('FILE_TOO_LARGE')
  })

  it('admits the same job once the caller says the risk was accepted', () => {
    register(webcodecs(), ffmpeg())

    const result = route(mp4ToWebm, HUGE, desktop, { allowOverBudget: true })

    expect(chosen(result).engine).toBe('webcodecs')
  })

  it('warns about what the job needs against what the device budgets', () => {
    register(webcodecs())

    const result = route(mp4ToWebm, HUGE, desktop, { allowOverBudget: true })
    const warning = chosen(result).warnings.find((entry) => entry.code === 'OVER_BUDGET')

    // The two numbers are the whole point of the sentence: an override with no
    // figure in it is the "something went wrong" CLAUDE.md §2.5 forbids.
    const needed = peakBytes(MEMORY.webcodecs, jobInput(HUGE))
    expect(warning?.message).toContain(formatBytes(needed))
    expect(warning?.message).toContain(formatBytes(budgetBytes(desktop)))
  })

  it('picks the engine that costs least for the job, not the preferred one', () => {
    // `webcodecs` wins on priority (15 against 90) and loses on memory: 4x the
    // held bytes against ffmpeg's 4.5x. Over budget, nothing is affordable and
    // the only useful question left is which one is least likely to die.
    register(webcodecs(), ffmpeg())
    const preferred = chosen(route(mp4ToWebm, 10 * MB, desktop)).engine

    const cheap = fake('remux', { priority: 95, supports: () => true })
    register(cheap)
    const overridden = chosen(route(mp4ToWebm, HUGE, desktop, { allowOverBudget: true })).engine

    expect(preferred).toBe('webcodecs')
    expect(overridden).toBe('remux')
  })

  it('changes nothing about a job that fits', () => {
    register(canvas(), fake('vips', { priority: 40, supports: () => true }))

    const plain = chosen(route(jpgToPng, 2 * MB, desktop))
    const opted = chosen(route(jpgToPng, 2 * MB, desktop, { allowOverBudget: true }))

    expect(opted.engine).toBe(plain.engine)
    expect(opted.warnings).toStrictEqual(plain.warnings)
    expect(warningCodes(opted)).not.toContain('OVER_BUDGET')
  })

  it('refuses past the bitmap ceiling however loudly the caller insists', () => {
    // Not an estimate: a canvas larger than this returns a *blank* surface
    // rather than throwing, so an override buys a silent wrong answer.
    register(canvas())
    const oversized = [{ bytes: 4 * MB, pixels: MAX_CANVAS_PIXELS + 1 }]

    const result = refused(route(jpgToPng, oversized, desktop, { allowOverBudget: true }))

    expect(result.code).toBe('FILE_TOO_LARGE')
  })

  it('marks a refusal the user could push past as overridable', () => {
    register(webcodecs(), ffmpeg())

    expect(refused(route(mp4ToWebm, HUGE, desktop)).overridable).toBe(true)
  })

  it('marks a bitmap-ceiling refusal as not overridable', () => {
    register(canvas())
    const oversized = [{ bytes: 4 * MB, pixels: MAX_CANVAS_PIXELS + 1 }]

    expect(refused(route(jpgToPng, oversized, desktop)).overridable).toBe(false)
  })

  it('leaves a phone the same offer as a desktop', () => {
    // `DEVICE_TOO_WEAK` is the same estimate with a smaller number in it. The
    // tab is still the user's to spend.
    register(webcodecs(), ffmpeg())

    const refusal = refused(route(mp4ToWebm, 300 * MB, ios))
    expect(refusal.code).toBe('DEVICE_TOO_WEAK')
    expect(refusal.overridable).toBe(true)
  })

  it('does not override a missing codec', () => {
    // Nothing about an absent `VideoEncoder` is a matter of degree.
    register(webcodecs())
    const noCodecs = { ...desktop, webCodecsVideo: false, webCodecsAudio: false }

    const result = refused(route(mp4ToWebm, 2 * MB, noCodecs, { allowOverBudget: true }))

    expect(result.code).toBe('UNSUPPORTED_PAIR')
    expect(result.overridable).toBe(false)
  })

  it('does not override an empty file', () => {
    register(canvas())

    const result = refused(route(jpgToPng, 0, desktop, { allowOverBudget: true }))

    expect(result.code).toBe('EMPTY_INPUT')
    expect(result.overridable).toBe(false)
  })
})
