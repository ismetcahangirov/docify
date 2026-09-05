import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import HomePage from '@/app/page'
import { PAIRS } from '@/lib/registry/pairs'

/*
 * The home page (issue #267): the brand search result, and the one page that
 * links the site together from the root.
 *
 * The assertions are about what a visitor and a crawler can act on — one
 * heading, a way into the catalogue, the popular conversions as real links, the
 * three steps, the questions — and not about the wording, which is free to
 * move. The one string asserted *against* is the scaffold placeholder, which
 * shipped to production for far too long.
 */

describe('HomePage', () => {
  it('renders its content inside a main landmark with exactly one level-1 heading', () => {
    render(<HomePage />)

    const main = screen.getByRole('main')
    const headings = within(main).getAllByRole('heading', { level: 1 })

    expect(headings).toHaveLength(1)
    expect(headings[0].textContent?.trim()).not.toBe('')
  })

  it('no longer shows the scaffold placeholder', () => {
    render(<HomePage />)

    expect(screen.queryByText(/scaffold placeholder/i)).not.toBeInTheDocument()
  })

  it('leads with the on-device claim and a way into every converter', () => {
    render(<HomePage />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/in your browser/i)

    // A plain anchor, not a soft navigation: `/convert` is cross-origin
    // isolated and has to be a whole-document load (next.config.ts).
    const links = screen.getAllByRole('link', { name: /every converter/i })
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute('href', '/convert')
  })

  it('links straight to the popular conversions', () => {
    render(<HomePage />)

    const popular = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => /^\/convert\/[a-z0-9]+-to-[a-z0-9]+$/.test(href))

    expect(popular.length).toBeGreaterThanOrEqual(8)
    // Each one once: a grid that repeats a link is a grid with a bug in it.
    expect(new Set(popular).size).toBe(popular.length)
  })

  it('explains the three steps, and that nothing is uploaded', () => {
    render(<HomePage />)

    const heading = screen.getByRole('heading', { level: 2, name: /how it works/i })
    const section = heading.closest('section')

    expect(section).not.toBeNull()
    expect(within(section as HTMLElement).getAllByRole('listitem')).toHaveLength(3)
    expect(section).toHaveTextContent(/(nothing|never) (is )?uploaded|no upload/i)
  })

  it('answers four questions of its own', () => {
    render(<HomePage />)

    const heading = screen.getByRole('heading', { level: 2, name: /questions/i })
    const section = heading.closest('section') as HTMLElement

    expect(section.querySelectorAll('dt')).toHaveLength(4)
    expect(section.querySelectorAll('dd')).toHaveLength(4)
  })

  it('states the catalogue size from the registry rather than a typed number', () => {
    render(<HomePage />)

    // Whatever `PAIRS.length` is today, stated as a figure of its own — not a
    // number somebody typed in a sentence and will forget to update.
    expect(screen.getByText(String(PAIRS.length))).toBeInTheDocument()
  })
})
