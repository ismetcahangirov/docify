// @vitest-environment node

/**
 * The conversion catalogue (issue #65).
 *
 * The assertion that matters is the last one in this file: every pair with a
 * page is a pair the router will actually run. A page for a conversion nothing
 * can perform is the worst outcome a programmatic set has — it ranks, somebody
 * arrives with a file, and the app refuses it.
 */

import { describe, expect, it } from 'vitest'

import { ALL_FORMATS, formatMeta, formatsOfKind, FORMATS } from '@/lib/registry/formats'
import {
  PAIR_SLUGS,
  PAIRS,
  formatsWithPages,
  pairBySlug,
  pairsFrom,
  pairsTo,
  pairTitle,
} from '@/lib/registry/pairs'
import { parsePairSlug } from '@/lib/registry/slugs'
import { route } from '@/lib/router/route'
import type { Capabilities, FormatId } from '@/lib/router/types'

/**
 * A current desktop Chrome, which is the floor the catalogue is written
 * against: a pair is only listed if this device can run it. A weaker browser
 * gets a rejection with alternatives, which is `lib/router/alternatives.ts`'s
 * job, not this one's.
 */
const capable: Capabilities = {
  crossOriginIsolated: true,
  wasmSimd: true,
  deviceMemoryGb: 8,
  cores: 8,
  webCodecsVideo: true,
  webCodecsAudio: true,
  offscreenCanvas: true,
  createImageBitmap: true,
  platform: 'desktop',
  browser: 'chromium',
}

/** A file small enough that nothing is refused for memory. */
const ONE_MB = 1024 * 1024

describe('the format catalogue', () => {
  it('describes every format the router knows', () => {
    expect(ALL_FORMATS).toHaveLength(27)

    for (const format of ALL_FORMATS) {
      expect(format.name).toMatch(/\S/)
      expect(format.fullName).toMatch(/\S/)
      expect(format.extension).toMatch(/^\.[a-z0-9]+$/)
      expect(format.mime).toMatch(/^[a-z]+\/[\w.+-]+$/)
      expect(format.summary.split(/\s+/).length).toBeGreaterThan(8)
    }
  })

  it('keys every entry by its own id', () => {
    for (const [id, format] of Object.entries(FORMATS)) expect(format.id).toBe(id)
  })

  it('groups the formats into families that between them hold all of them', () => {
    const kinds = ['image', 'document', 'video', 'audio', 'archive'] as const
    const grouped = kinds.flatMap((kind) => formatsOfKind(kind))

    expect(grouped).toHaveLength(ALL_FORMATS.length)
  })

  it('answers for any format without going undefined', () => {
    expect(formatMeta('heic').name).toBe('HEIC')
    expect(formatMeta('heic').extension).toBe('.heic')
  })
})

describe('the pair catalogue', () => {
  it('carries the 120+ pages the epic is sized against', () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(120)
  })

  it('gives every pair a slug that is unique across the whole set', () => {
    expect(new Set(PAIR_SLUGS).size).toBe(PAIRS.length)
  })

  it('mints slugs the route can read back', () => {
    for (const pair of PAIRS) {
      expect(parsePairSlug(pair.slug)).toEqual({ from: pair.from, to: pair.to })
    }
  })

  it('never lists a conversion of a format into itself', () => {
    for (const pair of PAIRS) expect(pair.from).not.toBe(pair.to)
  })

  it('finds a pair by its slug, and answers undefined for a slug it does not have', () => {
    expect(pairBySlug('heic-to-jpg')).toMatchObject({ from: 'heic', to: 'jpg' })
    expect(pairBySlug('heic-to-doc')).toBeUndefined()
    expect(pairBySlug('')).toBeUndefined()
  })

  it('reaches every pair from both of its ends', () => {
    for (const pair of PAIRS) {
      expect(pairsFrom(pair.from)).toContain(pair)
      expect(pairsTo(pair.to)).toContain(pair)
    }
  })

  it('has at least one page for every format it names', () => {
    for (const format of formatsWithPages()) {
      expect(pairsFrom(format).length + pairsTo(format).length).toBeGreaterThan(0)
    }
  })

  it('names a conversion the way the copy will name it', () => {
    expect(pairTitle({ from: 'heic', to: 'jpg', slug: 'x', op: 'convert', demand: 'high' })).toBe(
      'HEIC to JPG',
    )
  })

  it('ranks the conversions people actually arrive for above the tail', () => {
    const high = PAIRS.filter((pair) => pair.demand === 'high')

    expect(high.length).toBeGreaterThanOrEqual(20)
    expect(high.map((pair) => pair.slug)).toContain('heic-to-jpg')
    expect(PAIRS.filter((pair) => pair.demand === 'low').length).toBeGreaterThan(0)
  })

  /*
   * The one that keeps the catalogue honest. Adding a pair here without an
   * engine behind it is a page that ranks and then refuses the file somebody
   * brought to it.
   */
  it('lists nothing the router refuses on a capable desktop', () => {
    const refused = PAIRS.filter(
      (pair) => !route({ from: pair.from, to: pair.to, op: pair.op }, ONE_MB, capable).ok,
    )

    expect(refused.map((pair) => pair.slug)).toEqual([])
  })

  it('is frozen, so a consumer cannot reorder it for the route that renders it', () => {
    expect(Object.isFrozen(PAIRS)).toBe(true)
  })
})

describe('the pair catalogue against the engines', () => {
  /*
   * The catalogue is deliberately narrower than the engines. This asserts the
   * direction rather than the exact gap: a pair nobody searches for is a page
   * nobody reads, and the list is curated for that reason.
   */
  it('covers less than the engines can do, not more', () => {
    const sources = new Set<FormatId>(PAIRS.map((pair) => pair.from))

    expect(sources.size).toBeLessThan(ALL_FORMATS.length)
  })
})
