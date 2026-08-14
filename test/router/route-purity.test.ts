// @vitest-environment node
//
// Deliberately not jsdom. `route()` runs during SSR, inside a Web Worker and in
// the browser, and it is only allowed to look at the three arguments it is
// handed. With no DOM in scope, a `window` or `document` read inside the module
// under test throws here instead of quietly passing under jsdom and failing in
// production. Node 22 still defines a global `navigator`, so the "reads nothing
// from the environment" case below removes that one explicitly.

import { describe, expect, it, vi } from 'vitest'

import * as registry from '@/lib/engines/registry'
import { route } from '@/lib/router/route'

import {
  canvas,
  chosen,
  desktop,
  fake,
  ffmpeg,
  jpgToPng,
  MB,
  mp4ToWebm,
  register,
  resetRegistryBetweenTests,
  webcodecs,
} from './support/route-harness'

// `vi.mock` is hoisted to the top of the file, so the call cannot be shared —
// only the replacement module it returns, which the harness builds.
vi.mock('@/lib/engines/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engines/registry')>()

  return (await import('./support/route-harness')).mockedRegistry(actual)
})

resetRegistryBetweenTests()

describe('route — purity', () => {
  it('reads nothing from the environment', () => {
    // Node 22 defines a global `navigator`, so the file-level `node`
    // environment alone would not catch a `navigator.deviceMemory` read. Both
    // globals are removed for the duration of the call instead.
    register(canvas())

    try {
      vi.stubGlobal('navigator', undefined)
      vi.stubGlobal('window', undefined)

      expect(chosen(route(jpgToPng, 2 * MB, desktop)).engine).toBe('canvas')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not mutate the arguments it is given', () => {
    register(canvas(), ffmpeg())
    const task = { ...jpgToPng }
    const caps = { ...desktop }

    route(task, 2 * MB, caps)

    expect(task).toEqual(jpgToPng)
    expect(caps).toEqual(desktop)
  })

  it('returns the same decision for the same inputs', () => {
    register(canvas(), webcodecs(), ffmpeg())

    expect(route(mp4ToWebm, 50 * MB, desktop)).toEqual(route(mp4ToWebm, 50 * MB, desktop))
  })

  it('follows the order the registry hands it, rather than deriving its own', () => {
    // `byPreference` lives in the registry and nowhere else (issue #26). The two
    // engines below disagree on priority and on download size, so a router that
    // re-sorted by either key would answer the same thing both times.
    const cheapButLast = fake('ffmpeg', { priority: 90, loadCost: 0 })
    const costlyButFirst = fake('canvas', { priority: 10, loadCost: 32_000_000 })
    const enginesFor = vi.spyOn(registry, 'enginesFor')

    enginesFor.mockReturnValue([costlyButFirst, cheapButLast])
    expect(chosen(route(jpgToPng, MB, desktop)).engine).toBe('canvas')

    enginesFor.mockReturnValue([cheapButLast, costlyButFirst])
    expect(chosen(route(jpgToPng, MB, desktop)).engine).toBe('ffmpeg')
  })

  it('narrows cleanly on ok', () => {
    register(canvas())

    const result = route(jpgToPng, 2 * MB, desktop)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toBeInstanceOf(Array)
  })
})
