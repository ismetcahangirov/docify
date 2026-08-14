// @vitest-environment node
//
// Deliberately not jsdom. `route()` runs during SSR, inside a Web Worker and in
// the browser, and it is only allowed to look at the three arguments it is
// handed, so a `window` or `document` read inside it must throw here rather
// than pass quietly. `route-purity.test.ts` closes the remaining gap.
//
// Jobs made of several files: which of `holds: 'all-at-once'` and
// `'one-at-a-time'` the budget follows, and what the refusal says about them.

import { describe, expect, it, vi } from 'vitest'

import { route } from '@/lib/router/route'

import {
  canvas,
  chosen,
  desktop,
  ffmpeg,
  heicToJpg,
  heif,
  jpgToPng,
  MB,
  pdflib,
  pdfMerge,
  refused,
  register,
  resetRegistryBetweenTests,
  vips,
} from './support/route-harness'

// `vi.mock` is hoisted to the top of the file, so the call cannot be shared —
// only the replacement module it returns, which the harness builds.
vi.mock('@/lib/engines/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engines/registry')>()

  return (await import('./support/route-harness')).mockedRegistry(actual)
})

resetRegistryBetweenTests()

describe('route — jobs made of more than one file', () => {
  it('budgets a merge by the total, not by the largest file', () => {
    register(pdflib())

    // Each file is far inside pdflib's 292 MB desktop ceiling; together they
    // are 4.9 GB. This is the case `MAX_MERGE_FILES` cannot see, because it
    // counts files rather than bytes.
    const hundredScans = Array.from({ length: 100 }, () => 50 * MB)

    expect(chosen(route(pdfMerge, 50 * MB, desktop)).engine).toBe('pdflib')
    expect(refused(route(pdfMerge, hundredScans, desktop)).code).toBe('FILE_TOO_LARGE')
  })

  it('quotes the total and the ceiling back, with the file count', () => {
    register(pdflib())

    const result = refused(
      route(
        pdfMerge,
        Array.from({ length: 100 }, () => 50 * MB),
        desktop,
      ),
    )

    expect(result.message).toContain('100 files')
    expect(result.message).toContain('4.9 GB')
    // (1200 MB desktop budget − 32 MB reserve) / 4 = 292 MB across the job.
    expect(result.message).toContain('292 MB')
    expect(result.suggestion.length).toBeGreaterThan(10)
  })

  it('budgets a one-at-a-time engine by its largest file, however many there are', () => {
    register(canvas())

    // 300 files of 100 MB: 30 GB in total, and every one of them convertible,
    // because a canvas job holds one bitmap at a time.
    const many = Array.from({ length: 300 }, () => 100 * MB)

    expect(chosen(route(jpgToPng, many, desktop)).engine).toBe('canvas')
    // …and the single file over the 200 MB ceiling is still refused.
    expect(refused(route(jpgToPng, [10 * MB, 300 * MB], desktop)).code).toBe('FILE_TOO_LARGE')
  })

  it('names the largest file rather than the total when the engine takes them one by one', () => {
    register(canvas())

    const result = refused(route(jpgToPng, [10 * MB, 300 * MB], desktop))

    expect(result.message).toContain('300 MB')
    expect(result.message).not.toContain('310 MB')
  })

  it('treats a single-element list exactly like the bare number', () => {
    register(canvas(), heif(), vips(), ffmpeg())

    expect(route(heicToJpg, [3 * MB], desktop)).toEqual(route(heicToJpg, 3 * MB, desktop))
  })

  it('refuses a job with no files, and one that contains an empty file', () => {
    register(pdflib())

    expect(refused(route(pdfMerge, [], desktop)).code).toBe('EMPTY_INPUT')
    expect(refused(route(pdfMerge, [2 * MB, 0, 2 * MB], desktop)).code).toBe('EMPTY_INPUT')
  })

  it('says how many files it was given when it refuses an empty one', () => {
    register(pdflib())

    const result = refused(route(pdfMerge, [2 * MB, 0, 2 * MB], desktop))

    expect(result.message).toContain('3 files')
    expect(result.suggestion.length).toBeGreaterThan(10)
  })

  it('does not mutate the list of sizes it is handed', () => {
    register(canvas())
    const sizes = [3 * MB, MB, 2 * MB]

    route(jpgToPng, sizes, desktop)

    expect(sizes).toEqual([3 * MB, MB, 2 * MB])
  })
})
