import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { FAMILIES } from '../scripts/subset-fonts/families.mjs'
import {
  codepointsOf,
  CORE,
  CORE_UNICODE_RANGE,
  cssUnicodeRange,
  EXTENDED,
  LATIN,
  subtractRanges,
} from '../scripts/subset-fonts/ranges.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * The two halves of every self-hosted family (issue #315).
 *
 * `scripts/subset-fonts/cli.mjs` cuts each vendored Google latin subset into a
 * *core* file — the codepoints this site's own pages actually render — and an
 * *extended* file holding the rest of that subset. Only the core file is
 * preloaded; the extended one is fetched on demand, which on every route takes
 * 57kB off the set of bytes the browser has to have before the first paint.
 *
 * The whole safety of that split is one property: **core and extended must
 * partition the vendored coverage**. A codepoint in neither half is a character
 * that silently renders in the metric-adjusted fallback face instead of the
 * real one — a regression nothing else in this repository would notice, because
 * the page still looks like a page.
 */
describe('scripts/subset-fonts ranges', () => {
  it('splits the latin subset into two halves that do not overlap', () => {
    const core = new Set(codepointsOf(CORE))
    const extended = codepointsOf(EXTENDED)

    expect(extended.filter((codepoint) => core.has(codepoint))).toEqual([])
  })

  it('loses no codepoint of the vendored latin subset between the two halves', () => {
    const covered = new Set([...codepointsOf(CORE), ...codepointsOf(EXTENDED)])

    expect([...covered].sort((a, b) => a - b)).toEqual(codepointsOf(LATIN))
  })

  // The core half exists to cover the pages as written. Every printable ASCII
  // character is in it whether the copy uses it today or not: a page is text
  // somebody will edit, and a subset tuned to today's sentences would send the
  // next em-dash to the fallback face.
  it('covers printable ASCII in the core half', () => {
    const core = new Set(codepointsOf(CORE))

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

  it('subtracts a range from the middle, the ends and the whole of another', () => {
    expect(subtractRanges([[0, 10]], [[4, 6]])).toEqual([
      [0, 3],
      [7, 10],
    ])
    expect(subtractRanges([[0, 10]], [[0, 3]])).toEqual([[4, 10]])
    expect(subtractRanges([[0, 10]], [[8, 20]])).toEqual([[0, 7]])
    expect(subtractRanges([[0, 10]], [[0, 10]])).toEqual([])
  })
})

describe('scripts/subset-fonts output', () => {
  it('reads a vendored source that is not itself served', () => {
    for (const family of FAMILIES) {
      const source = resolve(repoRoot, 'assets/fonts', family.source)

      expect(existsSync(source), `${family.source} must exist in assets/fonts`).toBe(true)
      expect(existsSync(resolve(repoRoot, 'public/fonts', family.source))).toBe(false)
    }
  })

  it('has both halves of every family committed under public/fonts', () => {
    for (const family of FAMILIES) {
      for (const name of [family.core, family.extended]) {
        expect(existsSync(resolve(repoRoot, 'public/fonts', name)), `${name} is missing`).toBe(true)
      }
    }
  })

  // The point of the split is the byte count on the critical path. A core file
  // that grew past its source would mean the subsetter kept something it was
  // asked to drop, and the preload would be heavier than the file it replaced.
  it('keeps every core half smaller than the source it was cut from', async () => {
    const { stat } = await import('node:fs/promises')

    for (const family of FAMILIES) {
      const source = await stat(resolve(repoRoot, 'assets/fonts', family.source))
      const core = await stat(resolve(repoRoot, 'public/fonts', family.core))

      expect(core.size, `${family.core} must be smaller than ${family.source}`).toBeLessThan(
        source.size,
      )
    }
  })
})
