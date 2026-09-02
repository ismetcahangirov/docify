// @vitest-environment node

/**
 * The structured data on all 124 conversion pages (issue #68).
 *
 * Two things are being held here. The first is mechanical: the properties
 * Google's Rich Results Test requires are present on every page, not on the one
 * that was checked by hand.
 *
 * The second is the rule that actually protects the site. Structured data
 * describing content a reader cannot see is a guidelines violation, and the
 * penalty lands on the whole set rather than the page that earned it — so every
 * question and every step in the graph is asserted to be the same string the
 * page renders.
 */

import { describe, expect, it } from 'vitest'

import { copyFor } from '@/lib/registry/copy'
import { PAIRS } from '@/lib/registry/pairs'
import { pageMetadata } from '@/lib/seo/metadata'
import type { JsonLdNode } from '@/lib/seo/schema'
import { pageSchema } from '@/lib/seo/schema'
import { SITE_ORIGIN } from '@/lib/seo/site'

const graphs = PAIRS.map((pair) => {
  const schema = pageSchema(pair)
  if (schema === undefined) throw new Error(`no schema for ${pair.slug}`)

  return [pair.slug, schema] as const
})

const nodes = (graph: JsonLdNode): JsonLdNode[] => graph['@graph'] as unknown as JsonLdNode[]

const nodeOf = (graph: JsonLdNode, type: string): JsonLdNode => {
  const found = nodes(graph).find((node) => node['@type'] === type)
  if (found === undefined) throw new Error(`no ${type} node`)

  return found
}

describe('the graph itself', () => {
  it('is produced for every pair in the catalogue', () => {
    expect(graphs).toHaveLength(PAIRS.length)
  })

  it('refuses to describe a pair that has no copy', () => {
    expect(
      pageSchema({ from: 'heic', to: 'ico', slug: 'heic-to-ico', op: 'convert', demand: 'low' }),
    ).toBeUndefined()
  })

  it.each(graphs)('%s: declares the vocabulary once, for the whole graph', (_slug, graph) => {
    expect(graph['@context']).toBe('https://schema.org')
    expect(Array.isArray(graph['@graph'])).toBe(true)
  })

  it.each(graphs)('%s: carries all four types the epic requires', (_slug, graph) => {
    const types = nodes(graph).map((node) => node['@type'])

    expect(types).toEqual(['SoftwareApplication', 'HowTo', 'FAQPage', 'BreadcrumbList'])
  })

  it.each(graphs)('%s: gives every node an id nothing else in the set shares', (slug, graph) => {
    for (const node of nodes(graph)) {
      expect(String(node['@id'])).toContain(`/convert/${slug}#`)
    }
  })

  it('is serialisable, because it is going into a script tag', () => {
    for (const [, graph] of graphs) expect(() => JSON.stringify(graph)).not.toThrow()
  })
})

describe('SoftwareApplication', () => {
  it.each(graphs)('%s: is a free utility with a stated price', (_slug, graph) => {
    const app = nodeOf(graph, 'SoftwareApplication')

    expect(app.applicationCategory).toBe('UtilitiesApplication')
    expect(app.offers).toMatchObject({ '@type': 'Offer', price: '0', priceCurrency: 'USD' })
    expect(app.isAccessibleForFree).toBe(true)
  })

  it.each(graphs)('%s: points at its own canonical URL', (slug, graph) => {
    const app = nodeOf(graph, 'SoftwareApplication')
    const meta = pageMetadata(PAIRS.find((pair) => pair.slug === slug)!)

    expect(app.url).toBe(meta?.canonical)
    expect(app.description).toBe(meta?.description)
  })

  /*
   * Fabricated ratings are the most common way a page earns a manual action,
   * and there are no ratings to state.
   */
  it.each(graphs)('%s: claims no rating and no review', (_slug, graph) => {
    const app = nodeOf(graph, 'SoftwareApplication')

    expect(app.aggregateRating).toBeUndefined()
    expect(app.review).toBeUndefined()
  })
})

describe('HowTo', () => {
  it.each(graphs)('%s: has a name and exactly three ordered steps', (_slug, graph) => {
    const howto = nodeOf(graph, 'HowTo')
    const steps = howto.step as unknown as JsonLdNode[]

    expect(String(howto.name)).toMatch(/^How to convert /)
    expect(steps).toHaveLength(3)
    expect(steps.map((step) => step.position)).toEqual([1, 2, 3])
  })

  it.each(graphs)('%s: describes steps the page actually shows', (slug, graph) => {
    const howto = nodeOf(graph, 'HowTo')
    const steps = howto.step as unknown as JsonLdNode[]
    const copy = copyFor(slug)!

    expect(steps.map((step) => step.text)).toEqual([...copy.steps])
  })

  it.each(graphs)('%s: gives each step a short name that is not the whole text', (_slug, graph) => {
    const steps = nodeOf(graph, 'HowTo').step as unknown as JsonLdNode[]

    for (const step of steps) {
      expect(String(step.name).length).toBeGreaterThan(3)
      expect(String(step.name).length).toBeLessThan(String(step.text).length)
      expect(String(step.name)).not.toMatch(/[.,;]$/)
    }
  })
})

describe('FAQPage', () => {
  it.each(graphs)('%s: asks the questions the page answers, verbatim', (slug, graph) => {
    const faq = nodeOf(graph, 'FAQPage')
    const questions = faq.mainEntity as unknown as JsonLdNode[]
    const copy = copyFor(slug)!

    expect(questions.map((question) => question.name)).toEqual(copy.faq.map((one) => one.q))
    expect(
      questions.map((question) => (question.acceptedAnswer as unknown as JsonLdNode).text),
    ).toEqual(copy.faq.map((one) => one.a))
  })

  it.each(graphs)('%s: gives every question an accepted answer', (_slug, graph) => {
    const questions = nodeOf(graph, 'FAQPage').mainEntity as unknown as JsonLdNode[]

    expect(questions.length).toBeGreaterThanOrEqual(4)

    for (const question of questions) {
      expect(question['@type']).toBe('Question')
      expect(question.acceptedAnswer).toMatchObject({ '@type': 'Answer' })
    }
  })
})

describe('BreadcrumbList', () => {
  it.each(graphs)('%s: runs from home, through the index, to this page', (slug, graph) => {
    const trail = nodeOf(graph, 'BreadcrumbList').itemListElement as unknown as JsonLdNode[]

    expect(trail.map((rung) => rung.position)).toEqual([1, 2, 3])
    expect(trail[0].item).toBe(SITE_ORIGIN)
    expect(trail[1].item).toBe(`${SITE_ORIGIN}/convert`)
    expect(trail[2].item).toBe(`${SITE_ORIGIN}/convert/${slug}`)
  })

  it.each(graphs)('%s: names the last rung after the conversion', (_slug, graph) => {
    const trail = nodeOf(graph, 'BreadcrumbList').itemListElement as unknown as JsonLdNode[]

    expect(String(trail[2].name)).toMatch(/ to /)
  })
})
