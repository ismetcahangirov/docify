// @vitest-environment node

/**
 * The internal linking matrix (issue #71).
 *
 * The acceptance criterion has two halves and the second is the harder one. Six
 * links per page is arithmetic. "No page is orphaned" is a property of the whole
 * graph, and it is the one that decides whether a crawler ever reaches the
 * hundred and twenty-fourth page — so it is asserted over the set rather than
 * argued for in a comment.
 */

import { describe, expect, it } from 'vitest'

import { formatMeta } from '@/lib/registry/formats'
import { PAIRS, pairBySlug } from '@/lib/registry/pairs'
import { RELATED_COUNT, relatedTo } from '@/lib/registry/related'
import { pairSlug } from '@/lib/registry/slugs'

const linksFrom = new Map(PAIRS.map((pair) => [pair.slug, relatedTo(pair)]))

const related = (slug: string) => linksFrom.get(slug) ?? []

describe('every page carries a full set of links', () => {
  it.each(PAIRS.map((pair) => [pair.slug] as const))('%s: offers six of them', (slug) => {
    expect(related(slug)).toHaveLength(RELATED_COUNT)
  })

  it.each(PAIRS.map((pair) => [pair.slug] as const))('%s: never links to itself', (slug) => {
    expect(related(slug).map((pair) => pair.slug)).not.toContain(slug)
  })

  it.each(PAIRS.map((pair) => [pair.slug] as const))('%s: lists each one once', (slug) => {
    const slugs = related(slug).map((pair) => pair.slug)

    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it.each(PAIRS.map((pair) => [pair.slug] as const))('%s: links only to real pages', (slug) => {
    for (const link of related(slug)) expect(pairBySlug(link.slug)).toBeDefined()
  })
})

describe('the links follow the hub-and-spoke rules', () => {
  it('leads with other targets for the same source', () => {
    const links = related('heic-to-jpg')

    expect(links.slice(0, 3).every((link) => link.from === 'heic')).toBe(true)
  })

  it('then offers other sources for the same target', () => {
    const links = related('heic-to-jpg')
    const intoJpg = links.filter((link) => link.to === 'jpg' && link.from !== 'heic')

    expect(intoJpg.length).toBeGreaterThanOrEqual(2)
  })

  it('offers the way back where there is one', () => {
    const links = related('mov-to-mp4').map((link) => link.slug)

    expect(links).toContain(pairSlug('mp4', 'mov'))
  })

  /*
   * PDF has three targets, no reverse conversion and nothing pointing into it,
   * so its own rules yield two links. The top-up is the reason it still has six.
   */
  it('fills a sparse source out of its own media family first', () => {
    const links = related('pdf-to-txt')

    expect(links).toHaveLength(RELATED_COUNT)
    expect(links.filter((link) => link.from === 'pdf').length).toBeGreaterThanOrEqual(2)
  })

  it('prefers neighbours of the same kind when topping up', () => {
    const links = related('mp3-to-flac')
    const kinds = links.map((link) => formatMeta(link.from).kind)

    expect(kinds.filter((kind) => kind === 'audio').length).toBeGreaterThanOrEqual(4)
  })
})

describe('the graph has no dead ends', () => {
  /*
   * The property the whole design exists for. A page nothing links to is a page
   * a crawler reaches once from the sitemap and never revisits, and it is the
   * silent failure mode of every large programmatic set.
   */
  it('links to every page from somewhere else', () => {
    const reached = new Set<string>()

    for (const links of linksFrom.values()) {
      for (const link of links) reached.add(link.slug)
    }

    const orphaned = PAIRS.map((pair) => pair.slug).filter((slug) => !reached.has(slug))

    expect(orphaned).toEqual([])
  })

  it('reaches every page more than once, so one edit cannot orphan it', () => {
    const inbound = new Map<string, number>()

    for (const links of linksFrom.values()) {
      for (const link of links) inbound.set(link.slug, (inbound.get(link.slug) ?? 0) + 1)
    }

    const fragile = PAIRS.map((pair) => pair.slug).filter((slug) => (inbound.get(slug) ?? 0) < 2)

    expect(fragile).toEqual([])
  })

  it('spreads the links rather than pointing everything at the same few pages', () => {
    const inbound = new Map<string, number>()

    for (const links of linksFrom.values()) {
      for (const link of links) inbound.set(link.slug, (inbound.get(link.slug) ?? 0) + 1)
    }

    // A set where one page absorbs a large share of the inbound links is a set
    // where the rest are being carried by the sitemap alone.
    const busiest = Math.max(...inbound.values())

    expect(busiest).toBeLessThan(PAIRS.length / 2)
  })

  it('is stable, so two renders of the same page link to the same places', () => {
    const pair = PAIRS.find((candidate) => candidate.slug === 'mp4-to-mp3')!

    expect(relatedTo(pair).map((link) => link.slug)).toEqual(
      relatedTo(pair).map((link) => link.slug),
    )
  })
})
