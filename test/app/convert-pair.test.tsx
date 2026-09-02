import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ConvertPairPage, {
  dynamicParams,
  generateMetadata,
  generateStaticParams,
} from '@/app/convert/[pair]/page'
import { copyFor } from '@/lib/registry/copy'
import { PAIR_SLUGS, PAIRS, pairBySlug } from '@/lib/registry/pairs'
import { relatedTo } from '@/lib/registry/related'
import { pageMetadata } from '@/lib/seo/metadata'

/*
 * The /convert/[pair] route (issue #66).
 *
 * The acceptance criterion is that every page is produced at build time with no
 * client-side data fetching, and the second half of that is the part worth
 * asserting: everything a search engine reads has to be in the server-rendered
 * markup. So this renders the page component itself and looks for the heading,
 * the steps, the questions and the links — none of which may depend on the
 * converter island having hydrated.
 */

const heicToJpg = 'heic-to-jpg'

const params = (pair: string) => ({ params: Promise.resolve({ pair }) })

/** The page is an async server component; awaiting it gives the element tree. */
const renderPage = async (slug: string) => render(await ConvertPairPage(params(slug)))

describe('generateStaticParams', () => {
  it('names every page in the catalogue', async () => {
    const generated = generateStaticParams().map((entry) => entry.pair)

    expect(generated).toEqual([...PAIR_SLUGS])
    expect(generated).toHaveLength(PAIRS.length)
  })

  it('produces at least the 120 pages the epic is sized against', () => {
    expect(generateStaticParams().length).toBeGreaterThanOrEqual(120)
  })

  /*
   * With dynamic params enabled, /convert/anything-to-anything would render at
   * request time from whatever was in the URL — an indexable page for a
   * conversion nothing can perform.
   */
  it('refuses any slug it did not generate', () => {
    expect(dynamicParams).toBe(false)
  })
})

describe('generateMetadata', () => {
  it('gives the page its title, description and canonical URL', async () => {
    const meta = await generateMetadata(params(heicToJpg))
    const expected = pageMetadata(pairBySlug(heicToJpg)!)!

    expect(meta.title).toBe(expected.title)
    expect(meta.description).toBe(expected.description)
    expect(meta.alternates?.canonical).toBe(expected.canonical)
  })

  it('declares the same URL to Open Graph as it does to the canonical tag', async () => {
    const meta = await generateMetadata(params(heicToJpg))

    expect(meta.openGraph?.url).toBe(meta.alternates?.canonical)
  })

  it('answers with nothing for a slug that names no page', async () => {
    expect(await generateMetadata(params('heic-to-doc'))).toEqual({})
  })
})

describe('the page renders without any JavaScript having run', () => {
  it('puts the copy’s own heading in the h1', async () => {
    await renderPage(heicToJpg)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copyFor(heicToJpg)!.h1)
  })

  it('renders the introduction', async () => {
    await renderPage(heicToJpg)

    expect(screen.getByText(copyFor(heicToJpg)!.intro)).toBeInTheDocument()
  })

  it('renders all three steps, numbered and anchored', async () => {
    await renderPage(heicToJpg)

    for (const [index, step] of copyFor(heicToJpg)!.steps.entries()) {
      expect(screen.getByText(step)).toBeInTheDocument()
      expect(document.getElementById(`step-${index + 1}`)).not.toBeNull()
    }
  })

  it('renders every question and its answer', async () => {
    await renderPage(heicToJpg)

    for (const question of copyFor(heicToJpg)!.faq) {
      expect(screen.getByText(question.q)).toBeInTheDocument()
      expect(screen.getByText(question.a)).toBeInTheDocument()
    }
  })

  it('renders the format-specific note', async () => {
    await renderPage(heicToJpg)

    expect(screen.getByText(copyFor(heicToJpg)!.note)).toBeInTheDocument()
  })

  it('renders the six related links and the hub', async () => {
    await renderPage(heicToJpg)

    for (const link of relatedTo(pairBySlug(heicToJpg)!)) {
      expect(
        document.querySelector(`a[href="/convert/${link.slug}"]`),
        `no link to ${link.slug}`,
      ).not.toBeNull()
    }

    expect(document.querySelector('a[href="/convert"]')).not.toBeNull()
  })

  it('renders a breadcrumb that ends on this page', async () => {
    await renderPage(heicToJpg)

    const trail = screen.getByRole('navigation', { name: /breadcrumb/i })

    expect(within(trail).getByRole('link', { name: 'Docify' })).toHaveAttribute('href', '/')
    expect(within(trail).getByText('HEIC to JPG')).toHaveAttribute('aria-current', 'page')
  })
})

describe('the structured data ships with the markup', () => {
  it('writes one JSON-LD block holding all four types', async () => {
    await renderPage(heicToJpg)

    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    expect(scripts).toHaveLength(1)

    const graph = JSON.parse(scripts[0].textContent ?? '{}') as {
      '@graph': Array<{ '@type': string }>
    }

    expect(graph['@graph'].map((node) => node['@type'])).toEqual([
      'SoftwareApplication',
      'HowTo',
      'FAQPage',
      'BreadcrumbList',
    ])
  })
})
