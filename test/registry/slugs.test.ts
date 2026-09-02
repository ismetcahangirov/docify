// @vitest-environment node

/**
 * The URL a conversion lives at (issues #62 and #65).
 *
 * Small enough to look not worth testing, and load-bearing in four places: the
 * static route, the sitemap, the internal links and the canonical tag. The
 * round trip is the property that matters — a slug the route cannot parse back
 * is a page in the sitemap that returns a 404.
 */

import { describe, expect, it } from 'vitest'

import { convertHref, pairSlug, parsePairSlug } from '@/lib/registry/slugs'

describe('pairSlug', () => {
  it('names a conversion the way people search for it', () => {
    expect(pairSlug('heic', 'jpg')).toBe('heic-to-jpg')
  })

  it('copes with a format whose id starts with a digit', () => {
    expect(pairSlug('7z', 'zip')).toBe('7z-to-zip')
  })
})

describe('convertHref', () => {
  it('points at the page that performs the conversion', () => {
    expect(convertHref('mov', 'mp4')).toBe('/convert/mov-to-mp4')
  })
})

describe('parsePairSlug', () => {
  it('reads back what pairSlug wrote', () => {
    expect(parsePairSlug(pairSlug('heic', 'jpg'))).toEqual({ from: 'heic', to: 'jpg' })
  })

  it('refuses a slug that names no pair', () => {
    expect(parsePairSlug('heic')).toBeNull()
    expect(parsePairSlug('')).toBeNull()
    expect(parsePairSlug('-to-jpg')).toBeNull()
    expect(parsePairSlug('heic-to-')).toBeNull()
  })

  /*
   * Splitting on the first `-to-` would read `photo-to-print-to-pdf` as
   * `photo` and `print-to-pdf`. No format contains the separator today, and
   * relying on that is how this breaks when one does.
   */
  it('splits on the last separator, not the first', () => {
    expect(parsePairSlug('a-to-b-to-c')).toEqual({ from: 'a-to-b', to: 'c' })
  })
})
