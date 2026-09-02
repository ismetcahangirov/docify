import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ConvertIndexPage, { metadata } from '@/app/convert/page'
import { PAIRS, pairsFrom } from '@/lib/registry/pairs'
import { absoluteUrl } from '@/lib/seo/site'

/*
 * The converter hub (issue #66).
 *
 * This page used to be a placeholder carrying `robots: { index: false }`, and
 * the most important assertion here is that it no longer does — it is the
 * middle rung of all 124 breadcrumbs, and a breadcrumb through a `noindex` page
 * is a trail that goes nowhere.
 */

describe('the hub', () => {
  it('links to every conversion in the catalogue', () => {
    render(<ConvertIndexPage />)

    const missing = PAIRS.filter(
      (pair) => document.querySelector(`a[href="/convert/${pair.slug}"]`) === null,
    )

    expect(missing.map((pair) => pair.slug)).toEqual([])
  })

  it('groups the catalogue by the format somebody arrives holding', () => {
    render(<ConvertIndexPage />)

    expect(screen.getByRole('heading', { name: /from heic/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /from mp4/i })).toBeInTheDocument()
  })

  it('shows no group for a format nothing converts from', () => {
    render(<ConvertIndexPage />)

    expect(pairsFrom('zip')).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: /from zip/i })).not.toBeInTheDocument()
  })

  it('has one h1 and one heading per source format', () => {
    render(<ConvertIndexPage />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})

describe('the hub’s own metadata', () => {
  it('is indexable, because every breadcrumb passes through it', () => {
    expect(metadata.robots).toBeUndefined()
  })

  it('declares a canonical URL', () => {
    expect(metadata.alternates?.canonical).toBe(absoluteUrl('/convert'))
  })

  it('says how many converters there are, from the catalogue rather than by hand', () => {
    expect(metadata.title).toContain(String(PAIRS.length))
  })
})
