// @vitest-environment node

/**
 * The sitemap and robots.txt (issue #70).
 *
 * The acceptance criterion is that every generated page appears in the sitemap
 * and is indexable, and both halves have a specific failure mode worth
 * asserting rather than eyeballing.
 *
 * A page missing from the sitemap is a page a crawler reaches only if something
 * links to it. A page listed at a URL that differs from its own canonical tag
 * is worse: the crawler fetches what it was given, the page tells it the real
 * address is elsewhere, and the submission is quietly discounted. So the
 * sitemap's URLs are compared against the canonical tags rather than against a
 * pattern.
 */

import { describe, expect, it } from 'vitest'

import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { metadata as hubMetadata } from '@/app/convert/page'
import { metadata as toolsMetadata } from '@/app/tools/page'
import { PAIRS } from '@/lib/registry/pairs'
import { pageMetadata } from '@/lib/seo/metadata'
import { SITE_ORIGIN, absoluteUrl } from '@/lib/seo/site'

const entries = sitemap()
const urls = entries.map((entry) => entry.url)

describe('the sitemap lists everything that should be crawled', () => {
  it('includes every conversion page', () => {
    const missing = PAIRS.filter((pair) => !urls.includes(pageMetadata(pair)!.canonical))

    expect(missing.map((pair) => pair.slug)).toEqual([])
  })

  it('includes the home page and the converter hub', () => {
    expect(urls).toContain(absoluteUrl('/'))
    expect(urls).toContain(absoluteUrl('/convert'))
  })

  it('is exactly the catalogue plus those two, with nothing extra', () => {
    expect(entries).toHaveLength(PAIRS.length + 2)
  })

  it('lists each URL once', () => {
    expect(new Set(urls).size).toBe(urls.length)
  })
})

describe('the sitemap agrees with the pages it lists', () => {
  /*
   * The failure this exists for: a crawler fetches the URL it was given, the
   * page's canonical tag names a different one, and the submission is
   * discounted rather than rejected — so nothing tells you it happened.
   */
  it.each(PAIRS.map((pair) => [pair.slug] as const))(
    '%s: is listed at the URL it declares as canonical',
    (slug) => {
      const pair = PAIRS.find((candidate) => candidate.slug === slug)!

      expect(urls).toContain(pageMetadata(pair)!.canonical)
    },
  )

  it('lists the hub at the URL the hub calls canonical', () => {
    expect(urls).toContain(hubMetadata.alternates?.canonical)
  })

  it('uses absolute URLs on the real origin, with no trailing slashes', () => {
    for (const url of urls) {
      expect(url.startsWith(`${SITE_ORIGIN}/`)).toBe(true)
      if (url !== absoluteUrl('/')) expect(url.endsWith('/')).toBe(false)
    }
  })
})

describe('the sitemap lists nothing that refuses to be indexed', () => {
  /*
   * Submitting a `noindex` page is a contradiction a crawler reports back, and
   * enough of them devalue the submission. `/tools` is still a placeholder that
   * says `index: false`, so it must stay out until it is a real page.
   */
  it('leaves out the placeholder that is still noindex', () => {
    expect(toolsMetadata.robots).toMatchObject({ index: false })
    expect(urls).not.toContain(absoluteUrl('/tools'))
  })

  it('lists the hub, which is deliberately indexable', () => {
    expect(hubMetadata.robots).toBeUndefined()
  })
})

describe('the sitemap describes itself honestly', () => {
  it('claims one modification time for the whole build', () => {
    const stamps = new Set(entries.map((entry) => String(entry.lastModified)))

    expect(stamps.size).toBe(1)
  })

  it('ranks the home page and the hub above the tail', () => {
    const home = entries.find((entry) => entry.url === absoluteUrl('/'))
    const tail = entries.find(
      (entry) => entry.url === pageMetadata(PAIRS.find((p) => p.demand === 'low')!)!.canonical,
    )

    expect(home?.priority).toBeGreaterThan(tail?.priority ?? 1)
  })

  it('gives a high-demand conversion more weight than a low-demand one', () => {
    const priorityOf = (slug: string) =>
      entries.find(
        (entry) => entry.url === pageMetadata(PAIRS.find((p) => p.slug === slug)!)!.canonical,
      )?.priority

    expect(priorityOf('heic-to-jpg')).toBeGreaterThan(priorityOf('jpg-to-bmp') ?? 1)
  })

  it('does not claim the pages change daily', () => {
    for (const entry of entries) expect(entry.changeFrequency).toBe('monthly')
  })
})

describe('robots.txt', () => {
  const rules = robots()

  it('lets every crawler read the whole site', () => {
    expect(rules.rules).toContainEqual({ userAgent: '*', allow: '/' })
  })

  it('says yes to the AI agents by name as well as by wildcard (issue #73)', () => {
    // Redundant as a rule and not as a statement. `Google-Extended` and
    // `Applebot-Extended` are opt-out tokens whose absence means yes, so the
    // decision to let a model read and answer from these pages is otherwise
    // expressed by leaving a file alone — which nobody can review. See the
    // header of app/robots.ts for why the answer is yes.
    const agents = [rules.rules].flat().flatMap((rule) => [rule?.userAgent ?? []].flat())

    for (const agent of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'PerplexityBot']) {
      expect(agents).toContain(agent)
    }
  })

  it('allows each of them everything, rather than a corner of the site', () => {
    for (const rule of [rules.rules].flat()) expect(rule?.allow).toBe('/')
  })

  it('points at the sitemap, which is how the other 125 pages are found', () => {
    expect(rules.sitemap).toBe(absoluteUrl('/sitemap.xml'))
  })

  it('names the canonical host', () => {
    expect(rules.host).toBe(SITE_ORIGIN)
  })

  /*
   * `robots.txt` controls crawling, not indexing. Disallowing a page stops a
   * crawler reading the `noindex` on it, which is exactly how a page nobody
   * wanted indexed ends up in the results as a bare URL.
   */
  it('disallows nothing, leaving indexing to the pages themselves', () => {
    expect(JSON.stringify(rules)).not.toContain('disallow')
  })
})
