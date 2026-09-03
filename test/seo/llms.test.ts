// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { copyFor } from '@/lib/registry/copy'
import { formatMeta } from '@/lib/registry/formats'
import { PAIRS } from '@/lib/registry/pairs'
import { llmsTxt } from '@/lib/seo/llms'
import { pageMetadata } from '@/lib/seo/metadata'
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from '@/lib/seo/site'

/*
 * `/llms.txt` (issue #73).
 *
 * The acceptance criterion is that an AI crawler can reach and cite the tool
 * pages. Reaching them is `app/robots.ts`; citing them is this file, and the
 * failure mode worth asserting is the one a sitemap has too — a generated list
 * that names a URL the page itself does not claim. An assistant given the wrong
 * address either fetches nothing or cites a redirect.
 *
 * The second failure mode is subtler and is why the descriptions are asserted
 * as well: a list of 124 links whose descriptions are a template with two nouns
 * swapped tells a reader nothing it could not have guessed from the URL, and
 * costs the context window it was supposed to save.
 */

const text = llmsTxt()
const lines = text.split('\n')

describe('the shape the convention asks for', () => {
  it('opens with the site name as an H1', () => {
    expect(lines[0]).toBe(`# ${SITE_NAME}`)
  })

  it('follows it with the one-sentence summary, as a blockquote', () => {
    expect(lines[2]).toBe(`> ${SITE_DESCRIPTION}`)
  })

  it('groups the links under H2 sections rather than listing 124 in a row', () => {
    const headings = lines.filter((line) => line.startsWith('## '))

    expect(headings).toEqual([
      '## Start here',
      '## Image conversions',
      '## Document conversions',
      '## Video conversions',
      '## Audio conversions',
    ])
  })

  it('has no empty section, which would promise a list and not have one', () => {
    for (const [index, line] of lines.entries()) {
      if (!line.startsWith('## ')) continue

      expect({ line, next: lines[index + 2]?.startsWith('- ') }).toEqual({ line, next: true })
    }
  })

  it('ends with exactly one newline, as a text file does', () => {
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
  })
})

describe('what it says is here', () => {
  it('names every conversion page in the catalogue', () => {
    const missing = PAIRS.filter((pair) => !text.includes(pageMetadata(pair)!.canonical))

    expect(missing.map((pair) => pair.slug)).toEqual([])
  })

  it('links each of them at the URL the page claims as canonical', () => {
    // The sitemap's failure mode, in a second file. A crawler handed one address
    // and told by the page that the real one is elsewhere believes the page, and
    // the list that sent it is discounted.
    const links = [...text.matchAll(/^- \[[^\]]+\]\((?<url>[^)]+)\):/gmu)].map(
      (match) => match.groups!.url!,
    )
    const canonicals = new Set([
      absoluteUrl('/'),
      absoluteUrl('/convert'),
      ...PAIRS.map((pair) => pageMetadata(pair)!.canonical),
    ])

    expect(links.filter((url) => !canonicals.has(url))).toEqual([])
  })

  it('lists the home page and the hub before the conversions', () => {
    // An assistant reading top-down should meet the two pages that explain the
    // site before the hundred and twenty-four that each explain one conversion.
    expect(text).toContain(`- [${SITE_NAME}](${absoluteUrl('/')})`)
    expect(text).toContain(`- [All converters](${absoluteUrl('/convert')})`)
    expect(text.indexOf('## Start here')).toBeLessThan(text.indexOf('## Image conversions'))
  })

  it('leaves out the page that is not indexable', () => {
    // `/tools` carries `robots: { index: false }`. Handing it to an assistant
    // that is choosing what to cite says the opposite of what the page says.
    expect(text).not.toContain(absoluteUrl('/tools'))
  })

  it('names one line per pair and no more', () => {
    const bullets = lines.filter((line) => line.startsWith('- '))

    // The two under "Start here", plus one for each page.
    expect(bullets).toHaveLength(PAIRS.length + 2)
  })
})

describe('what each line tells a reader', () => {
  const pairLines = lines.filter((line) => line.startsWith('- ') && line.includes('/convert/'))

  it('describes each page with that page own heading', () => {
    for (const pair of PAIRS) {
      const heading = copyFor(pair.slug)!.h1
      const from = formatMeta(pair.from).name
      const to = formatMeta(pair.to).name

      expect({
        slug: pair.slug,
        line: text.includes(`- [${from} to ${to}](${pageMetadata(pair)!.canonical}): ${heading}`),
      }).toEqual({ slug: pair.slug, line: true })
    }
  })

  it('gives no two pages the same description', () => {
    // Which holds because the headings do — `test/registry/copy.test.ts` is
    // what enforces that, and this is the assertion that notices if this file
    // ever starts generating its own sentences instead.
    const descriptions = pairLines.map((line) => line.slice(line.indexOf('): ') + 3))

    expect(new Set(descriptions).size).toBe(descriptions.length)
  })

  it('stays small enough to be read whole', () => {
    // The point of the file. Something that has to be paged through is a
    // sitemap with prose in it, and a sitemap already exists.
    expect(text.length).toBeLessThan(32_000)
  })
})

describe('what it says the tool does', () => {
  it('states that files never leave the browser, which is the fact most likely to be guessed wrong', () => {
    expect(text).toMatch(/no file is uploaded/iu)
    expect(text).toMatch(/no server-side processing/iu)
  })

  it('states that there is no account and no quota', () => {
    expect(text).toMatch(/no sign-up/iu)
    expect(text).toMatch(/quota/iu)
  })
})
