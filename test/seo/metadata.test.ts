// @vitest-environment node

/**
 * The metadata for all 124 conversion pages (issue #67).
 *
 * Asserted across the whole catalogue rather than on an example. The failure
 * this exists to prevent — two pages sharing a title — is invisible on any
 * single page and only shows up when the set is compared with itself, which is
 * exactly the kind of thing nobody does by hand at the hundredth page.
 */

import { describe, expect, it } from 'vitest'

import { copyFor } from '@/lib/registry/copy'
import { PAIRS } from '@/lib/registry/pairs'
import {
  MAX_DESCRIPTION_CHARS,
  MAX_TITLE_CHARS,
  MIN_DESCRIPTION_CHARS,
  pageDescription,
  pageMetadata,
  pageTitle,
} from '@/lib/seo/metadata'
import { SITE_ORIGIN, absoluteUrl } from '@/lib/seo/site'

const all = PAIRS.map((pair) => {
  const meta = pageMetadata(pair)
  if (meta === undefined) throw new Error(`no metadata for ${pair.slug}`)

  return [pair.slug, meta] as const
})

describe('every page has metadata at all', () => {
  it('generates it for every pair in the catalogue', () => {
    expect(all).toHaveLength(PAIRS.length)
  })

  it('refuses to invent metadata for a pair with no copy', () => {
    expect(
      pageMetadata({ from: 'heic', to: 'ico', slug: 'heic-to-ico', op: 'convert', demand: 'low' }),
    ).toBeUndefined()
  })
})

describe('no two pages say the same thing', () => {
  it('gives every page its own title', () => {
    const titles = all.map(([, meta]) => meta.title)
    const seen = new Map<string, string[]>()

    for (const [slug, meta] of all) {
      seen.set(meta.title, [...(seen.get(meta.title) ?? []), slug])
    }

    const shared = [...seen].filter(([, slugs]) => slugs.length > 1)

    expect(shared).toEqual([])
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('gives every page its own description', () => {
    const descriptions = all.map(([, meta]) => meta.description)

    expect(new Set(descriptions).size).toBe(descriptions.length)
  })

  it('gives every page its own canonical URL', () => {
    const canonicals = all.map(([, meta]) => meta.canonical)

    expect(new Set(canonicals).size).toBe(canonicals.length)
  })
})

describe('the title fits a search result', () => {
  it.each(all)('%s: is at most 60 characters', (_slug, meta) => {
    expect(meta.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS)
  })

  it('leads with the conversion, because that is what was searched for', () => {
    expect(pageTitle({ from: 'heic', to: 'jpg', slug: 'x', op: 'convert', demand: 'high' })).toBe(
      'HEIC to JPG Converter — Free, In Your Browser | Docify',
    )
  })

  it('names the formats the way the rest of the site names them', () => {
    const meta = pageMetadata(PAIRS.find((pair) => pair.slug === 'webp-to-jpg')!)

    expect(meta?.title.startsWith('WebP to JPG')).toBe(true)
  })
})

describe('the description lands in the window search engines use', () => {
  it.each(all)('%s: is between 140 and 155 characters', (_slug, meta) => {
    expect(meta.description.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_CHARS)
    expect(meta.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS)
  })

  it.each(all)('%s: says it is free and that nothing is uploaded', (_slug, meta) => {
    expect(meta.description).toMatch(/free/i)
    expect(meta.description).toMatch(/uploaded/i)
  })

  it.each(all)('%s: opens with this page’s own heading', (slug, meta) => {
    const copy = copyFor(slug)!

    expect(meta.description.startsWith(copy.h1.slice(0, 30))).toBe(true)
  })

  /*
   * Truncation is expected — an introduction is 40 to 70 words and a
   * description is 155 characters. What must not happen is a cut mid-word or a
   * stray comma left hanging in front of the ellipsis.
   */
  it('cuts at a word boundary and tidies the punctuation', () => {
    const long = `${'Alpha beta gamma delta epsilon, zeta eta theta iota kappa lambda mu nu xi '.repeat(4)}omicron`

    expect(pageDescription('Heading here', long)).toMatch(/[a-z]…/)
    expect(pageDescription('Heading here', long)).not.toMatch(/[,;:]…/)
  })

  it('leaves a short enough lead alone rather than padding it', () => {
    const description = pageDescription('Short heading', 'A B C')

    expect(description).not.toMatch(/…/)
    expect(description.endsWith('Free, and nothing is uploaded.')).toBe(true)
  })
})

describe('the canonical URL', () => {
  it.each(all)('%s: is absolute and on the real origin', (_slug, meta) => {
    expect(meta.canonical.startsWith(`${SITE_ORIGIN}/convert/`)).toBe(true)
  })

  it.each(all)('%s: matches the path the page is served from', (slug, meta) => {
    expect(meta.path).toBe(`/convert/${slug}`)
    expect(meta.canonical).toBe(absoluteUrl(meta.path))
  })

  it('never ends in a slash, so it cannot disagree with the route', () => {
    for (const [, meta] of all) expect(meta.canonical.endsWith('/')).toBe(false)
  })
})
