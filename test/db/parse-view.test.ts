import { describe, expect, it } from 'vitest'

import sitemap from '@/app/sitemap'
import { parsePageView } from '@/lib/db/parse-view'
import { PAIR_SLUGS } from '@/lib/registry/pairs'

/*
 * The gate between a request and `page_totals` (issue #102).
 *
 * `page` is the field that looks like free text, and in most analytics
 * databases it *is* one: a `text` column holding whatever path the client
 * reported. That is how a counter becomes a log — a path can carry a query
 * string, a fragment, an id, or a token somebody pasted into a URL, and once
 * one of those is written down the claim that the database holds nothing
 * identifying stops being structural.
 *
 * So the cases below are mostly refusals, and they are the point of the module.
 */

describe('parsePageView', () => {
  it('accepts the home page', () => {
    expect(parsePageView({ page: '/' })).toEqual({ page: '/' })
  })

  it('accepts the hub and the placeholder', () => {
    expect(parsePageView({ page: '/convert' })).toEqual({ page: '/convert' })
    // `/tools` is absent from the sitemap because it is `noindex` while it is a
    // placeholder. That is a statement about crawlers, not about whether a
    // visitor can open it.
    expect(parsePageView({ page: '/tools' })).toEqual({ page: '/tools' })
  })

  it('accepts every conversion page in the registry', () => {
    for (const slug of PAIR_SLUGS) {
      expect(parsePageView({ page: `/convert/${slug}` })).toEqual({ page: `/convert/${slug}` })
    }
  })

  it('normalises a trailing slash rather than refusing it', () => {
    // The same page. Two rows for it would be a defect in the figures rather
    // than a defence of anything.
    expect(parsePageView({ page: '/convert/heic-to-jpg/' })).toEqual({
      page: '/convert/heic-to-jpg',
    })
  })

  it.each([
    ['a page that is not a route', { page: '/convert/docx-to-mp3' }],
    ['a path outside the site', { page: '/admin' }],
    ['an absolute URL', { page: 'https://docify.app/convert/heic-to-jpg' }],
    ['a query string', { page: '/convert/heic-to-jpg?utm_source=newsletter' }],
    ['a fragment', { page: '/convert/heic-to-jpg#faq' }],
    ['a path that is a file name', { page: '/Users/ada/holiday.heic' }],
    ['a surplus field', { page: '/', referrer: 'https://example.com' }],
    ['a missing field', {}],
    ['a page that is not a string', { page: 1 }],
    ['an array', [{ page: '/' }]],
    ['null', null],
    ['a bare string', '/'],
  ])('refuses %s', (_label, value) => {
    expect(parsePageView(value)).toBeNull()
  })

  it('accepts every path the sitemap publishes', () => {
    // `PAGES` is built from `PAIR_SLUGS` plus three literals; the sitemap is
    // built from `PAIRS` plus two. A static route added to one and not the
    // other is a page that is served, linked and crawled, and then silently
    // uncounted — drift no type catches, because both sides are strings.
    const paths = sitemap().map((entry) => new URL(entry.url).pathname)

    expect(paths.length).toBeGreaterThan(0)

    for (const path of paths) {
      expect(parsePageView({ page: path })).toEqual({ page: path })
    }
  })

  it('refuses a query string even on a page that exists', () => {
    // The one refusal worth stating twice. `?utm_source=` is harmless;
    // `?email=` is not, and the column cannot tell them apart. Neither is
    // stored, so neither has to be.
    expect(parsePageView({ page: '/?ref=someone' })).toBeNull()
  })
})
