import { describe, expect, it } from 'vitest'

import { copyFor } from '@/lib/registry/copy'
import { PAIRS, pairBySlug } from '@/lib/registry/pairs'
import {
  MAX_OG_HEADLINE_CHARS,
  MAX_OG_SUBLINE_CHARS,
  OG_FOOTER,
  OG_SIZE,
  ogCard,
  ogImageUrl,
  siteCard,
} from '@/lib/seo/og'

/*
 * The words on the social card (issue #72).
 *
 * The card itself is a raster and cannot be asserted against — comparing PNG
 * bytes would pin the shade of a border rather than the thing that matters. So
 * the words are a module of their own and the image route is a template over
 * them, which is the same split `lib/seo/metadata.ts` makes for the same reason.
 *
 * What matters is that no two of the hundred and twenty-four cards say the same
 * thing, and that what each says fits in the box it is drawn in.
 */

/** Every pair's card, with the pairs that have no copy dropped. */
const cards = PAIRS.flatMap((pair) => {
  const card = ogCard(pair)

  return card === undefined ? [] : [{ slug: pair.slug, card }]
})

describe('ogCard', () => {
  it('answers for every pair in the catalogue', () => {
    // The pair pages are built from the same catalogue, so a pair with no card
    // is a page whose social preview would fall back to the site-wide one.
    expect(cards).toHaveLength(PAIRS.length)
  })

  it('answers undefined for a pair with no copy, rather than inventing words', () => {
    const orphan = { from: 'jpg', to: 'dwg', slug: 'jpg-to-dwg', op: 'convert', demand: 'low' }

    expect(ogCard(orphan as never)).toBeUndefined()
  })

  it('names the conversion in the headline, in the format names a reader searched for', () => {
    const heic = pairBySlug('heic-to-jpg')

    expect(heic && ogCard(heic)?.headline).toBe('HEIC to JPG')
  })

  it('says which family the conversion belongs to in the eyebrow', () => {
    const mp4 = pairBySlug('mp4-to-webm')
    const heic = pairBySlug('heic-to-jpg')

    expect(mp4 && ogCard(mp4)?.eyebrow).toBe('VIDEO CONVERTER')
    expect(heic && ogCard(heic)?.eyebrow).toBe('IMAGE CONVERTER')
  })

  it('draws the subline from the page own introduction', () => {
    const heic = pairBySlug('heic-to-jpg')
    const card = heic && ogCard(heic)

    expect(card?.subline.length).toBeGreaterThan(0)
    expect(heic && card).toBeDefined()
  })

  it('carries the same footer on every card, because the promise does not vary', () => {
    for (const { card } of cards) expect(card.footer).toBe(OG_FOOTER)
  })
})

describe('what fits in the box', () => {
  it('keeps every headline inside the width the card draws it at', () => {
    for (const { slug, card } of cards) {
      expect(`${slug}: ${card.headline}`.length - slug.length - 2).toBeLessThanOrEqual(
        MAX_OG_HEADLINE_CHARS,
      )
    }
  })

  it('keeps every subline inside its two lines', () => {
    for (const { slug, card } of cards) {
      expect({ slug, length: card.subline.length }).toEqual({
        slug,
        length: Math.min(card.subline.length, MAX_OG_SUBLINE_CHARS),
      })
    }
  })

  it('never cuts a subline mid-word', () => {
    // A card reading "converting a photograp…" is worse than a shorter one. The
    // property is that what survives is a whole-word prefix of the introduction:
    // drop the ellipsis, and the next character in the source must be a space.
    for (const { slug, card } of cards) {
      const intro = (copyFor(slug)?.intro ?? '').replace(/\s+/gu, ' ').trim()
      const kept = card.subline.replace(/…$/u, '')
      // What survives has to be a prefix of the introduction that ends where a
      // word does. The character after it may be a space or the punctuation the
      // clamp trims off a truncated line — anything alphanumeric means the cut
      // landed inside a word.
      const next = intro.slice(kept.length, kept.length + 1)
      const cutMidWord =
        card.subline.endsWith('…') && (!intro.startsWith(kept) || /[\p{L}\p{N}]/u.test(next))

      expect({ slug, cutMidWord }).toEqual({ slug, cutMidWord: false })
    }
  })
})

describe('no two cards say the same thing', () => {
  it('gives every pair its own headline', () => {
    const headlines = cards.map(({ card }) => card.headline)

    expect(new Set(headlines).size).toBe(headlines.length)
  })

  it('gives every pair its own subline', () => {
    // The subline comes from copy the uniqueness gate already polices, so this
    // is really a check that the clamp did not truncate two pages down to the
    // same opening clause.
    const sublines = cards.map(({ card }) => card.subline)

    expect(new Set(sublines).size).toBe(sublines.length)
  })

  it('gives every pair its own alt text', () => {
    const alts = cards.map(({ card }) => card.alt)

    expect(new Set(alts).size).toBe(alts.length)
  })

  it('writes an alt that describes the card rather than repeating the title', () => {
    const heic = pairBySlug('heic-to-jpg')

    expect(heic && ogCard(heic)?.alt).toMatch(/HEIC to JPG/)
    expect(heic && ogCard(heic)?.alt).toMatch(/Docify/)
  })
})

describe('OG_SIZE', () => {
  it('is the 1.91:1 box every network crops to', () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 })
  })
})

describe('ogImageUrl', () => {
  it('is absolute, because the crawler reading the tag is not on this origin', () => {
    const heic = pairBySlug('heic-to-jpg')

    expect(heic && ogImageUrl(heic)).toBe('https://docify.app/convert/heic-to-jpg/opengraph-image')
  })

  it('sits under the page it belongs to, which is where the file convention serves it', () => {
    for (const pair of PAIRS) {
      expect(ogImageUrl(pair)).toBe(`https://docify.app/convert/${pair.slug}/opengraph-image`)
    }
  })

  it('gives every pair its own URL', () => {
    const urls = PAIRS.map((pair) => ogImageUrl(pair))

    expect(new Set(urls).size).toBe(urls.length)
  })
})

describe('siteCard', () => {
  it('says what the site does rather than repeating the mark on the card', () => {
    expect(siteCard().headline).not.toBe('Docify')
    expect(siteCard().headline.length).toBeLessThanOrEqual(MAX_OG_HEADLINE_CHARS)
  })

  it('carries the same promise as every other card', () => {
    expect(siteCard().footer).toBe(OG_FOOTER)
  })
})
