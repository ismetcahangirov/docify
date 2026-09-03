import { describe, expect, it } from 'vitest'

import {
  auditLinks,
  auditPage,
  auditUniqueness,
  internalLinks,
} from '../scripts/seo-audit/rules.mjs'

/*
 * The pre-launch SEO audit's rules (issue #104).
 *
 * Tested on strings rather than on the build output, for the reason
 * `test/design-lint.test.ts` gives: this suite has to be able to describe a
 * *failing* page, and a fixture that failed would have to be excluded from the
 * real audit — and an exclusion is the hole the gate exists to close.
 *
 * What it cannot check is that a real page still parses this way. That is what
 * running `pnpm audit:seo` in CI's build job is for, on the 128 HTML files
 * `next build` actually wrote.
 */

/** A page with nothing wrong with it, which each case below breaks one part of. */
function goodPage(overrides: Partial<{ head: string; body: string; url: string }> = {}) {
  const url = overrides.url ?? '/convert/heic-to-jpg'
  const head =
    overrides.head ??
    [
      '<title>HEIC to JPG Converter | Docify</title>',
      `<meta name="description" content="${'d'.repeat(150)}"/>`,
      '<meta name="viewport" content="width=device-width"/>',
      `<link rel="canonical" href="https://docify.app${url}"/>`,
      '<meta property="og:title" content="HEIC to JPG"/>',
      '<meta property="og:description" content="Converts HEIC to JPG."/>',
      '<meta property="og:image" content="https://docify.app/card.png"/>',
      `<meta property="og:url" content="https://docify.app${url}"/>`,
      '<meta name="twitter:card" content="summary_large_image"/>',
    ].join('')
  const body =
    overrides.body ??
    '<h1>HEIC to JPG</h1><h2>How to</h2><a href="/convert">Converters</a>' +
      '<script type="application/ld+json">' +
      JSON.stringify([
        { '@type': 'SoftwareApplication' },
        { '@type': 'HowTo' },
        { '@type': 'FAQPage' },
        { '@type': 'BreadcrumbList' },
      ]) +
      '</script>'

  return { url, html: `<html lang="en"><head>${head}</head><body>${body}</body></html>` }
}

const INDEXABLE = { origin: 'https://docify.app', indexable: true, structured: true }

/** The rule ids a page produces, in order. */
function rulesFor(page: { url: string; html: string }, expected = INDEXABLE) {
  return auditPage(page, expected).map((finding) => `${finding.severity}:${finding.rule}`)
}

describe('a page with nothing wrong with it', () => {
  it('produces no findings at all', () => {
    // The assertion every other case here depends on: if the good page were
    // failing something, each "flags X" test below would pass by accident.
    expect(auditPage(goodPage(), INDEXABLE)).toEqual([])
  })
})

describe('the document itself', () => {
  it('flags a document with no language', () => {
    const page = goodPage()
    page.html = page.html.replace('<html lang="en">', '<html>')

    expect(rulesFor(page)).toContain('critical:html-lang')
  })

  it('flags a document with no viewport', () => {
    const page = goodPage()
    page.html = page.html.replace(/<meta name="viewport"[^>]*>/, '')

    expect(rulesFor(page)).toContain('critical:viewport')
  })
})

describe('what a search result shows', () => {
  it('flags a page with no title', () => {
    const page = goodPage()
    page.html = page.html.replace(/<title>[^<]*<\/title>/, '')

    expect(rulesFor(page)).toContain('critical:title')
  })

  it('warns about a title that will be truncated', () => {
    const page = goodPage()
    page.html = page.html.replace(/<title>[^<]*<\/title>/, `<title>${'t'.repeat(80)}</title>`)

    expect(rulesFor(page)).toContain('warning:title-length')
  })

  it('flags a page with no description', () => {
    const page = goodPage()
    page.html = page.html.replace(/<meta name="description"[^>]*>/, '')

    expect(rulesFor(page)).toContain('critical:description')
  })

  it('warns about a description short enough to be rewritten', () => {
    const page = goodPage()
    page.html = page.html.replace(/content="d+"/, 'content="too short"')

    expect(rulesFor(page)).toContain('warning:description-length')
  })
})

describe('the address a page claims', () => {
  it('flags a missing canonical', () => {
    const page = goodPage()
    page.html = page.html.replace(/<link rel="canonical"[^>]*>/, '')

    expect(rulesFor(page)).toContain('critical:canonical')
  })

  it('flags a canonical that names a different page', () => {
    // The failure nobody notices: the crawler fetches what it was given, the
    // page names somewhere else, and the submission is quietly discounted.
    const page = goodPage()
    page.html = page.html.replace('/convert/heic-to-jpg"/>', '/convert/heic-to-png"/>')

    expect(rulesFor(page)).toContain('critical:canonical')
  })

  it('accepts the root with or without its trailing slash', () => {
    // RFC 3986: an empty path is equivalent to `/`, and Next.js resolves the
    // home page's canonical down to the bare origin.
    const page = goodPage({ url: '/' })
    page.html = page.html.replace('href="https://docify.app/"', 'href="https://docify.app"')

    expect(rulesFor(page)).not.toContain('critical:canonical')
  })
})

describe('indexability', () => {
  it('flags an indexable page that asks not to be indexed', () => {
    const page = goodPage()
    page.html = page.html.replace('<head>', '<head><meta name="robots" content="noindex"/>')

    expect(rulesFor(page)).toContain('critical:robots')
  })

  it('flags a page that was meant to be noindex and is not', () => {
    expect(rulesFor(goodPage(), { ...INDEXABLE, indexable: false })).toContain('critical:robots')
  })

  it('asks nothing of a noindex page that it could not honour', () => {
    // A canonical URL, a description and an `og:url` are claims about a search
    // result. A page that has asked not to be in one has nothing to claim.
    const bare = {
      url: '/tools',
      html:
        '<html lang="en"><head><title>Tools</title>' +
        '<meta name="viewport" content="width=device-width"/>' +
        '<meta name="robots" content="noindex"/></head>' +
        '<body><h1>Tools</h1></body></html>',
    }

    expect(auditPage(bare, { ...INDEXABLE, indexable: false, structured: false })).toEqual([])
  })
})

describe('headings', () => {
  it('flags a page with no h1', () => {
    expect(rulesFor(goodPage({ body: '<h2>Something</h2><a href="/convert">x</a>' }))).toContain(
      'critical:h1',
    )
  })

  it('flags a page with two h1s', () => {
    const body = '<h1>One</h1><h1>Two</h1><a href="/convert">x</a>'

    expect(rulesFor(goodPage({ body }))).toContain('critical:h1')
  })

  it('warns when a heading level is skipped', () => {
    const body = '<h1>One</h1><h3>Three</h3><a href="/convert">x</a>'

    expect(rulesFor(goodPage({ body }))).toContain('warning:heading-order')
  })
})

describe('the preview a link produces', () => {
  it('flags a missing og:image, which is the one that goes missing silently', () => {
    // A page declaring an `openGraph` object of its own does not get the file
    // convention's image merged in. Nothing but the rendered HTML says so.
    const page = goodPage()
    page.html = page.html.replace(/<meta property="og:image"[^>]*>/, '')

    expect(rulesFor(page)).toContain('critical:open-graph')
  })

  it('warns when og:url and the canonical disagree', () => {
    const page = goodPage()
    page.html = page.html.replace(
      '<meta property="og:url" content="https://docify.app/convert/heic-to-jpg"/>',
      '<meta property="og:url" content="https://docify.app/elsewhere"/>',
    )

    expect(rulesFor(page)).toContain('warning:open-graph')
  })

  it('warns about a page with no twitter card', () => {
    const page = goodPage()
    page.html = page.html.replace(/<meta name="twitter:card"[^>]*>/, '')

    expect(rulesFor(page)).toContain('warning:twitter')
  })
})

describe('structured data', () => {
  it('flags a conversion page with none', () => {
    const body = '<h1>One</h1><a href="/convert">x</a>'

    expect(rulesFor(goodPage({ body }))).toContain('critical:structured-data')
  })

  it('flags JSON-LD that does not parse', () => {
    const body =
      '<h1>One</h1><a href="/convert">x</a>' +
      '<script type="application/ld+json">{ not json }</script>'

    expect(rulesFor(goodPage({ body }))).toContain('critical:structured-data')
  })

  it('flags JSON-LD that is missing one of the four types', () => {
    const body =
      '<h1>One</h1><a href="/convert">x</a>' +
      '<script type="application/ld+json">' +
      JSON.stringify([{ '@type': 'SoftwareApplication' }, { '@type': 'HowTo' }]) +
      '</script>'

    expect(rulesFor(goodPage({ body }))).toContain('critical:structured-data')
  })

  it('asks for none on a page that is not about a conversion', () => {
    const body = '<h1>One</h1><a href="/convert">x</a>'

    expect(rulesFor(goodPage({ body }), { ...INDEXABLE, structured: false })).toEqual([])
  })
})

describe('somewhere to go next', () => {
  it('flags an indexable page that links nowhere', () => {
    const body = '<h1>One</h1>'

    expect(rulesFor(goodPage({ body }), { ...INDEXABLE, structured: false })).toContain(
      'critical:dead-end',
    )
  })

  it('reads only same-site links, since an outbound one is not a way through the site', () => {
    const html =
      '<a href="/convert">in</a><a href="https://example.com">out</a><a href="#top">up</a>'

    expect(internalLinks(html)).toEqual(['/convert'])
  })

  it('strips a query and a fragment, because they are the same page', () => {
    expect(internalLinks('<a href="/convert?from=jpg#list">x</a>')).toEqual(['/convert'])
  })
})

describe('auditLinks', () => {
  it('flags a link to a page the build did not produce', () => {
    const pages = [{ url: '/', html: '<a href="/convert/jpg-to-dwg">x</a>' }]

    expect(auditLinks(pages, new Set(['/', '/convert']))).toEqual([
      {
        url: '/',
        rule: 'broken-link',
        severity: 'critical',
        message: 'links to /convert/jpg-to-dwg, which the build did not produce',
      },
    ])
  })

  it('says nothing about a link that resolves', () => {
    const pages = [{ url: '/', html: '<a href="/convert">x</a>' }]

    expect(auditLinks(pages, new Set(['/', '/convert']))).toEqual([])
  })

  it('reports one finding per broken target, not one per occurrence', () => {
    const pages = [{ url: '/', html: '<a href="/gone">a</a><a href="/gone">b</a>' }]

    expect(auditLinks(pages, new Set(['/']))).toHaveLength(1)
  })
})

describe('auditUniqueness', () => {
  const titled = (url: string, title: string) => ({
    url,
    html: `<title>${title}</title><meta name="description" content="${url}"/>`,
  })

  it('flags both pages that share a title', () => {
    // A set of pages with one title is a set Google picks one of and discards
    // the rest — which, on a programmatic surface, is the whole surface.
    const findings = auditUniqueness([titled('/a', 'Same'), titled('/b', 'Same')])

    expect(findings.map((finding) => finding.url)).toEqual(['/a', '/b'])
    expect(findings.every((finding) => finding.rule === 'duplicate-title')).toBe(true)
  })

  it('flags a shared description as well', () => {
    const pages = [
      { url: '/a', html: '<title>A</title><meta name="description" content="Same"/>' },
      { url: '/b', html: '<title>B</title><meta name="description" content="Same"/>' },
    ]

    expect(auditUniqueness(pages).map((finding) => finding.rule)).toEqual([
      'duplicate-description',
      'duplicate-description',
    ])
  })

  it('says nothing when every page differs', () => {
    expect(auditUniqueness([titled('/a', 'A'), titled('/b', 'B')])).toEqual([])
  })
})
