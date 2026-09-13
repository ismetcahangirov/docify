import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { coverageOf } from '../scripts/subset-fonts/coverage.mjs'
import { FAMILIES, OUTPUT_DIR, SOURCE_DIR } from '../scripts/subset-fonts/families.mjs'
import {
  codepointsOf,
  CORE,
  CORE_UNICODE_RANGE,
  cssUnicodeRange,
  EXTENDED,
  FALLBACK_METRIC_TEXT,
} from '../scripts/subset-fonts/ranges.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The two ranges `app/fonts.ts` declares, as sets. */
const core = new Set(codepointsOf(CORE))
const extended = new Set(codepointsOf(EXTENDED))

/** The a–z Next measures the metric-adjusted fallback over. In the file, never in the range. */
const ballast = new Set([...FALLBACK_METRIC_TEXT].map((char) => char.codePointAt(0) as number))

/**
 * What the whole split is worth, in the only unit that matters to the gate it
 * exists for: the bytes a browser must have before it can paint. 104.4kB of
 * font before #315, 47.4kB after, and this is set a little over that.
 *
 * A ceiling rather than an exact figure, because a source font is allowed to
 * change. What is not allowed is quietly putting the 57kB back — by widening
 * `CORE`, by dropping the feature allowlist, or by preloading a second face.
 */
const PRELOADED_BYTE_CEILING = 50 * 1024

const read = (dir: string, name: string) => readFileSync(resolve(repoRoot, dir, name))
const each = FAMILIES.map((family) => [family.source, family] as const)

/*
 * The two halves of every self-hosted family (issue #315).
 *
 * `scripts/subset-fonts/cli.mjs` cuts each vendored Google latin subset into a
 * *core* file — the codepoints these pages render — and an *extended* file
 * holding whatever else the source mapped. Only the core file is preloaded;
 * the extended one is fetched on demand, which takes 57kB off the set of bytes
 * the browser must have before the first paint of every route.
 *
 * The whole safety of that split is one property: **the two declared ranges
 * must partition the source's coverage, and each file must hold its side of
 * it.** A codepoint in neither range is a character that silently renders in
 * the metric-adjusted Arial fallback instead of the real face — a regression
 * nothing else here would notice, because the page still looks like a page.
 *
 * These assertions therefore read the shipped woff2 files. An earlier version
 * of this suite compared two hand-written range lists to each other instead,
 * passed, and shipped files that had quietly lost Ă and five Vietnamese
 * combining marks: the lists agreed with each other and neither agreed with the
 * fonts.
 */
describe('scripts/subset-fonts output', () => {
  it.each(each)('reads %s from assets/, where it is not served', (_name, family) => {
    expect(existsSync(resolve(repoRoot, SOURCE_DIR, family.source))).toBe(true)
    expect(existsSync(resolve(repoRoot, OUTPUT_DIR, family.source))).toBe(false)
  })

  it.each(each)('loses no codepoint of %s between its two halves', (_name, family) => {
    const source = coverageOf(read(SOURCE_DIR, family.source))
    const cut = coverageOf(read(OUTPUT_DIR, family.core))
    const rest = coverageOf(read(OUTPUT_DIR, family.extended))

    expect([...source].filter((codepoint) => !cut.has(codepoint) && !rest.has(codepoint))).toEqual(
      [],
    )
  })

  it.each(each)('cuts the preloaded half of %s to exactly the core range', (_name, family) => {
    const source = coverageOf(read(SOURCE_DIR, family.source))
    const cut = coverageOf(read(OUTPUT_DIR, family.core))

    // Exactly the intersection: nothing outside the range the `@font-face`
    // declares (the browser would never reach it), and nothing inside it
    // missing (the browser would reach for a glyph that is not there).
    expect([...cut].sort((a, b) => a - b)).toEqual(
      [...source].filter((codepoint) => core.has(codepoint)).sort((a, b) => a - b),
    )
  })

  it.each(each)('cuts the on-demand half of %s to exactly the extended range', (_name, family) => {
    const source = coverageOf(read(SOURCE_DIR, family.source))
    const rest = coverageOf(read(OUTPUT_DIR, family.extended))

    const claimed = [...source].filter((codepoint) => extended.has(codepoint))

    expect(claimed.filter((codepoint) => !rest.has(codepoint))).toEqual([])
    // The a–z ballast is the one thing in the file that its range never sends
    // it. Anything else here is a glyph nothing can draw.
    expect(
      [...rest].filter((codepoint) => !extended.has(codepoint) && !ballast.has(codepoint)),
    ).toEqual([])
  })

  // Without a–z in the extended file, Next's `calcAverageWidth` gives up and
  // the `local("Arial")` fallback loses its `size-adjust` — Inter's went from
  // 107.89% to 100% the first time this was written. That correction only shows
  // during the swap window, so nothing else here would catch its absence.
  it.each(each)('keeps the alphabet Next measures %s’s fallback over', (_name, family) => {
    const rest = coverageOf(read(OUTPUT_DIR, family.extended))

    for (const codepoint of ballast) {
      expect(rest.has(codepoint), `U+${codepoint.toString(16)} is missing`).toBe(true)
    }
  })

  // The point of the split is the byte count on the critical path. A core half
  // that grew past its source would mean the subsetter kept something it was
  // asked to drop, and the preload would be heavier than the file it replaced.
  it.each(each)('keeps the preloaded half of %s smaller than its source', (_name, family) => {
    const source = statSync(resolve(repoRoot, SOURCE_DIR, family.source)).size
    const cut = statSync(resolve(repoRoot, OUTPUT_DIR, family.core)).size

    expect(cut).toBeLessThan(source)
  })

  it('keeps every preloaded face together under the critical-path budget', () => {
    const preloaded = FAMILIES.reduce(
      (total, family) => total + statSync(resolve(repoRoot, OUTPUT_DIR, family.core)).size,
      0,
    )

    expect(preloaded).toBeLessThanOrEqual(PRELOADED_BYTE_CEILING)
  })
})

describe('scripts/subset-fonts ranges', () => {
  // A codepoint in both ranges would be drawn from whichever file loaded first;
  // one in neither would leave the family altogether.
  it('declares two ranges that do not overlap', () => {
    expect([...core].filter((codepoint) => extended.has(codepoint))).toEqual([])
  })

  it.each(each)('declares between them every codepoint %s maps', (_name, family) => {
    const source = coverageOf(read(SOURCE_DIR, family.source))

    expect(
      [...source].filter((codepoint) => !core.has(codepoint) && !extended.has(codepoint)),
    ).toEqual([])
  })

  // The core half exists to cover the pages as written. Every printable ASCII
  // character is in it whether the copy uses it today or not: a page is text
  // somebody will edit, and a subset tuned to today's sentences would send the
  // next em-dash to the fallback face.
  it('covers printable ASCII in the core range', () => {
    for (let codepoint = 0x20; codepoint <= 0x7e; codepoint += 1) {
      expect(core.has(codepoint)).toBe(true)
    }
  })

  it('writes a css unicode-range in the form a stylesheet accepts', () => {
    expect(cssUnicodeRange([[0x20, 0x7e]])).toBe('U+20-7E')
    expect(cssUnicodeRange([[0xa9, 0xa9]])).toBe('U+A9')
    expect(
      cssUnicodeRange([
        [0x20, 0x7e],
        [0xa9, 0xa9],
      ]),
    ).toBe('U+20-7E, U+A9')
    expect(CORE_UNICODE_RANGE).toBe(cssUnicodeRange(CORE))
  })
})
