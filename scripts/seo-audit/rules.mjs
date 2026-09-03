/**
 * The pre-launch SEO audit, as rules over one page's rendered HTML.
 *
 * ## Why the audit runs on the output and not on the source
 *
 * Every other SEO guard in this repository asserts about the *inputs*:
 * `test/seo/metadata.test.ts` checks the generator, `test/app/sitemap.test.ts`
 * checks the list, `test/registry/copy.test.ts` checks the words. All of them
 * would keep passing if Next.js stopped emitting the canonical tag, if a
 * `<meta name="robots">` arrived from somewhere else, or if a page rendered two
 * `<h1>`s because a component was reused in a place nobody looked at.
 *
 * This one reads the 130 HTML files `next build` wrote. It is the only check
 * here that sees what a crawler sees.
 *
 * ## Why the parsing is regular expressions
 *
 * The same argument `scripts/design-lint/rules.mjs` makes: a parser would be a
 * dependency, and what is being extracted — the contents of `<title>`, the
 * `content` of a handful of `<meta>` tags, the `href` of every anchor — is
 * markup this repository generates itself, from templates it controls. The
 * patterns are narrow and every one of them is tested against a string.
 *
 * ## Severity
 *
 * `critical` fails the build. `warning` is printed and does not. The line
 * between them is whether the finding costs the page its ability to be found
 * and understood: a missing canonical is critical, a title three characters
 * over the truncation point is not.
 *
 * @typedef {'critical' | 'warning'} Severity
 * @typedef {{ rule: string, severity: Severity, message: string }} Finding
 * @typedef {{ url: string, html: string }} AuditPage
 */

/** A search result truncates a title past about this. */
const MAX_TITLE_CHARS = 60

/** Below this a description is rewritten from the page body rather than used. */
const MIN_DESCRIPTION_CHARS = 140

/** Above this it is cut mid-sentence. */
const MAX_DESCRIPTION_CHARS = 160

/** The structured data every conversion page carries. */
const REQUIRED_SCHEMA_TYPES = ['SoftwareApplication', 'HowTo', 'FAQPage', 'BreadcrumbList']

/** `<meta name="x" content="y">` or the same with the attributes reversed. */
function metaContent(html, key) {
  const attribute = key.startsWith('og:') || key.startsWith('article:') ? 'property' : 'name'
  const forwards = new RegExp(
    `<meta[^>]*\\b${attribute}=["']${key}["'][^>]*\\bcontent=["']([^"']*)["']`,
    'i',
  )
  const backwards = new RegExp(
    `<meta[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b${attribute}=["']${key}["']`,
    'i',
  )

  return (forwards.exec(html) ?? backwards.exec(html))?.[1]
}

/** The `href` of `<link rel="canonical">`, or undefined. */
function canonicalHref(html) {
  const match = /<link[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']*)["']/i.exec(html)

  return match?.[1]
}

/**
 * Whether two absolute URLs name the same resource.
 *
 * String equality, except at the root. RFC 3986 makes an empty path equivalent
 * to `/`, and Next.js resolves `https://docify.app/` against `metadataBase`
 * down to `https://docify.app` — so the home page's canonical tag and the URL
 * its own sitemap entry uses differ by one character and mean the same thing.
 * Every crawler agrees; an audit that did not would report a critical finding
 * nobody could fix.
 */
function sameUrl(a, b) {
  const trim = (url) => url.replace(/\/+$/, '')

  return trim(a) === trim(b)
}

/** Every `<h1>`…`<h6>` in source order, as level numbers. */
function headingLevels(html) {
  return [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]))
}

/** Every `href` an anchor on the page points at. */
export function internalLinks(html) {
  return [...html.matchAll(/<a[^>]*\bhref=["']([^"']+)["']/gi)]
    .map((match) => match[1] ?? '')
    .filter((href) => href.startsWith('/'))
    .map((href) => href.split(/[?#]/)[0] ?? href)
}

/**
 * Everything wrong with one page.
 *
 * `indexable` gates more than the `robots` rule. A canonical URL, a
 * description and an `og:url` are all claims a page makes about where it sits
 * in a search result, and a page that has asked not to be in one has nothing to
 * claim. Requiring them of `/tools` and of the 404 shell would be requiring
 * ceremony rather than correctness.
 *
 * @param {AuditPage} page
 * @param {{ origin: string, indexable: boolean, structured: boolean }} expected
 * @returns {Finding[]}
 */
export function auditPage(page, expected) {
  /** @type {Finding[]} */
  const findings = []
  const add = (rule, severity, message) => findings.push({ rule, severity, message })
  const { html, url } = page

  // --- the document itself ---------------------------------------------------

  if (!/<html[^>]*\blang=["'][a-z]{2}/i.test(html)) {
    add('html-lang', 'critical', 'the <html> element declares no language')
  }

  if (metaContent(html, 'viewport') === undefined) {
    add('viewport', 'critical', 'no viewport meta tag, so the page is not mobile-ready')
  }

  // --- what a result shows ---------------------------------------------------

  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]
  if (title === undefined || title.trim() === '') {
    add('title', 'critical', 'no <title>')
  } else if (title.length > MAX_TITLE_CHARS) {
    add('title-length', 'warning', `title is ${title.length} chars and will be truncated`)
  }

  const description = metaContent(html, 'description')
  if (description === undefined || description.trim() === '') {
    if (expected.indexable) add('description', 'critical', 'no meta description')
  } else if (expected.indexable && description.length < MIN_DESCRIPTION_CHARS) {
    add(
      'description-length',
      'warning',
      `description is ${description.length} chars; under ${MIN_DESCRIPTION_CHARS} is usually rewritten`,
    )
  } else if (description.length > MAX_DESCRIPTION_CHARS) {
    add(
      'description-length',
      'warning',
      `description is ${description.length} chars and will be cut`,
    )
  }

  // --- which address the page claims -----------------------------------------

  const canonical = canonicalHref(html)
  if (canonical === undefined) {
    if (expected.indexable) add('canonical', 'critical', 'no canonical link')
  } else if (sameUrl(canonical, `${expected.origin}${url}`) === false) {
    // The failure nobody notices: the crawler fetches what the sitemap gave it,
    // the page names a different address, and the submission is discounted.
    add('canonical', 'critical', `canonical is ${canonical}, but the page is served at ${url}`)
  }

  // --- indexability ----------------------------------------------------------

  const robots = metaContent(html, 'robots') ?? ''
  const noindexed = /noindex/i.test(robots)
  if (expected.indexable && noindexed) {
    add('robots', 'critical', 'the page asks not to be indexed')
  }
  if (!expected.indexable && !noindexed) {
    add('robots', 'critical', 'the page is meant to be noindex and is not')
  }

  // --- headings --------------------------------------------------------------

  const levels = headingLevels(html)
  const h1s = levels.filter((level) => level === 1).length
  if (h1s === 0) add('h1', 'critical', 'no <h1>')
  if (h1s > 1) add('h1', 'critical', `${h1s} <h1> elements; a page is about one thing`)

  for (const [index, level] of levels.entries()) {
    const previous = levels[index - 1]
    if (previous !== undefined && level > previous + 1) {
      add('heading-order', 'warning', `heading level jumps from h${previous} to h${level}`)
      break
    }
  }

  // --- the preview a link produces -------------------------------------------

  if (expected.indexable) {
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:url']) {
      if (metaContent(html, tag) === undefined) {
        // `og:image` is the one that goes missing silently: a page declaring an
        // `openGraph` object of its own does not get the file convention's
        // image merged in, and nothing but the rendered HTML says so.
        add('open-graph', 'critical', `no ${tag}`)
      }
    }
  }

  const ogUrl = metaContent(html, 'og:url')
  if (ogUrl !== undefined && canonical !== undefined && ogUrl !== canonical) {
    add('open-graph', 'warning', `og:url (${ogUrl}) disagrees with the canonical (${canonical})`)
  }

  if (expected.indexable && metaContent(html, 'twitter:card') === undefined) {
    add('twitter', 'warning', 'no twitter:card, so a link previews as a bare title')
  }

  // --- somewhere to go next --------------------------------------------------

  if (expected.indexable && internalLinks(html).length === 0) {
    // A page a crawler can reach and then cannot leave. On a site whose entire
    // structure is a hub and 124 spokes, one dead end is one branch of the
    // graph that is only reachable from the sitemap.
    add('dead-end', 'critical', 'the page links nowhere else on the site')
  }

  // --- structured data -------------------------------------------------------

  if (expected.structured) {
    const block = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      html,
    )?.[1]

    if (block === undefined) {
      add('structured-data', 'critical', 'no JSON-LD block')
    } else {
      let parsed
      try {
        parsed = JSON.parse(block)
      } catch (error) {
        add(
          'structured-data',
          'critical',
          `the JSON-LD does not parse: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      if (parsed !== undefined) {
        const types = JSON.stringify(parsed)
        for (const type of REQUIRED_SCHEMA_TYPES) {
          if (!types.includes(`"${type}"`)) {
            add('structured-data', 'critical', `the JSON-LD declares no ${type}`)
          }
        }
      }
    }
  }

  return findings
}

/**
 * Links that point at a page the build did not produce.
 *
 * Separate from {@link auditPage} because it is the one rule that cannot be
 * decided from a single page: it needs to know what else exists.
 *
 * @param {AuditPage[]} pages
 * @param {ReadonlySet<string>} known every URL the build produced
 * @returns {Array<{ url: string } & Finding>}
 */
export function auditLinks(pages, known) {
  const findings = []

  for (const page of pages) {
    const broken = [...new Set(internalLinks(page.html))].filter((href) => !known.has(href))

    for (const href of broken) {
      findings.push({
        url: page.url,
        rule: 'broken-link',
        severity: 'critical',
        message: `links to ${href}, which the build did not produce`,
      })
    }
  }

  return findings
}

/**
 * Titles and descriptions two pages share.
 *
 * A set of pages with the same title is a set Google picks one of and discards
 * the rest, which on a programmatic surface is the whole surface.
 *
 * @param {AuditPage[]} pages
 * @returns {Array<{ url: string } & Finding>}
 */
export function auditUniqueness(pages) {
  const findings = []

  for (const [rule, extract] of [
    ['duplicate-title', (html) => /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]],
    ['duplicate-description', (html) => metaContent(html, 'description')],
  ]) {
    /** @type {Map<string, string[]>} */
    const seen = new Map()

    for (const page of pages) {
      const value = extract(page.html)
      if (value === undefined) continue
      seen.set(value, [...(seen.get(value) ?? []), page.url])
    }

    for (const [value, urls] of seen) {
      if (urls.length < 2) continue

      for (const url of urls) {
        findings.push({
          url,
          rule,
          severity: 'critical',
          message: `shares "${value.slice(0, 60)}…" with ${urls.length - 1} other page(s)`,
        })
      }
    }
  }

  return findings
}
