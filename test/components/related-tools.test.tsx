import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RelatedTools } from '@/components/blocks/related-tools'
import { PAIRS } from '@/lib/registry/pairs'
import { RELATED_COUNT, relatedTo } from '@/lib/registry/related'

/*
 * The rendered half of the linking matrix (issue #71).
 *
 * What is asserted here is that the component renders the selection rather than
 * making one of its own. The moment it filters or reorders, the property
 * `lib/registry/related.ts` proves — that no page is orphaned — stops being true
 * of what actually ships.
 */

const heicToJpg = PAIRS.find((pair) => pair.slug === 'heic-to-jpg')!
const pdfToTxt = PAIRS.find((pair) => pair.slug === 'pdf-to-txt')!

const block = () => screen.getByRole('region', { name: /convert/i })

describe('RelatedTools', () => {
  it('renders every link the registry chose, in that order', () => {
    render(<RelatedTools pair={heicToJpg} />)

    const expected = relatedTo(heicToJpg).map((pair) => `/convert/${pair.slug}`)
    const rendered = within(block())
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))

    // The hub link is the extra one; the six conversions come first.
    expect(rendered.slice(0, RELATED_COUNT)).toEqual(expected)
  })

  it('gives a page at least six internal links plus the hub', () => {
    render(<RelatedTools pair={heicToJpg} />)

    expect(within(block()).getAllByRole('link').length).toBeGreaterThanOrEqual(RELATED_COUNT + 1)
  })

  it('names the whole conversion in each link, not just the target', () => {
    render(<RelatedTools pair={heicToJpg} />)

    expect(within(block()).getByRole('link', { name: /HEIC to PNG/ })).toBeInTheDocument()
  })

  it('links back to the hub the spokes hang off', () => {
    render(<RelatedTools pair={heicToJpg} />)

    expect(screen.getByRole('link', { name: /every converter/i })).toHaveAttribute(
      'href',
      '/convert',
    )
  })

  it('fills a sparse source out to the full six', () => {
    render(<RelatedTools pair={pdfToTxt} />)

    const conversions = within(block())
      .getAllByRole('link')
      .filter((link) => (link.getAttribute('href') ?? '').startsWith('/convert/'))

    expect(conversions).toHaveLength(RELATED_COUNT)
  })

  it('never links a page to itself', () => {
    render(<RelatedTools pair={heicToJpg} />)

    const hrefs = within(block())
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))

    expect(hrefs).not.toContain('/convert/heic-to-jpg')
  })

  /*
   * A converter route is cross-origin isolated and a soft navigation carries the
   * previous document's isolation with it. A full load is what guarantees the
   * destination — which is about to instantiate a WASM engine — gets its own
   * headers evaluated.
   */
  it('loads each destination as a whole document', () => {
    render(<RelatedTools pair={heicToJpg} />)

    for (const link of within(block()).getAllByRole('link')) {
      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('href')
    }
  })

  it('is a region a screen reader can jump to, named after the source format', () => {
    render(<RelatedTools pair={heicToJpg} />)

    expect(block()).toHaveAccessibleName(/HEIC/)
  })
})
