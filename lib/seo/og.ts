/**
 * What one conversion page's social card says.
 *
 * A link to `/convert/heic-to-jpg` posted anywhere — Slack, WhatsApp, a forum,
 * a search result's rich preview — is rendered from the Open Graph tags, and
 * without an image the preview is a grey rectangle with a title in it. A single
 * site-wide card would fix the rectangle and not the problem: a hundred and
 * twenty-four links that all look identical are a hundred and twenty-four links
 * nobody can tell apart in a thread.
 *
 * ## Why the words are here and the picture is not
 *
 * `app/convert/[pair]/opengraph-image.tsx` draws the card. This module decides
 * what is on it, and it is a separate module for the reason
 * `lib/seo/metadata.ts` is: a PNG cannot be asserted against. Comparing image
 * bytes would pin the shade of a border and say nothing about whether two of
 * the cards are identical, which is the only thing that actually matters.
 *
 * ## Where the difference comes from
 *
 * The same place the page's own uniqueness does. The headline is the format
 * pair, which is unique by construction; the subline is the opening of that
 * page's hand-written introduction, which `scripts/check-content-uniqueness`
 * already polices. Nothing here invents a sentence.
 */

import { formatMeta } from '@/lib/registry/formats'
import type { ConversionPair } from '@/lib/registry/pairs'
import { copyFor } from '@/lib/registry/copy'
import type { FormatKind } from '@/lib/registry/formats'

import { convertHref } from '@/lib/registry/slugs'

import { clampToWords } from './clamp'
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from './site'

/**
 * The card's dimensions.
 *
 * 1200 × 630 is the 1.91:1 box Facebook, LinkedIn, Slack and X all crop to. Any
 * other ratio is cropped by each of them differently, which means designing a
 * card and then not knowing what anybody sees.
 */
export const OG_SIZE = { width: 1200, height: 630 } as const

/**
 * The most characters the headline may carry.
 *
 * The headline is drawn at 104px. At that size the card's 1056px of usable
 * width holds about twenty-four characters of a humanist sans; the longest pair
 * in the catalogue is well inside that, and this constant is what keeps it so
 * when the next format is added.
 */
export const MAX_OG_HEADLINE_CHARS = 24

/** The subline is two lines of 30px type over 880px, which is about this many. */
export const MAX_OG_SUBLINE_CHARS = 116

/**
 * The line along the bottom of every card.
 *
 * Fixed, and the only fixed text on it. These are the three claims that decide
 * whether somebody follows the link, and they are true of every pair — writing
 * a variation of them per page would be a hundred and twenty-four chances to
 * make one of them false.
 */
export const OG_FOOTER = 'Free · No sign-up · Nothing is uploaded'

/** What each format family is called on a card. */
const FAMILY: Readonly<Record<FormatKind, string>> = {
  image: 'IMAGE CONVERTER',
  document: 'DOCUMENT CONVERTER',
  video: 'VIDEO CONVERTER',
  audio: 'AUDIO CONVERTER',
  archive: 'ARCHIVE CONVERTER',
}

/** Everything drawn on one conversion page's card. */
export interface OgCard {
  /** Small, uppercase, muted: which family this conversion belongs to. */
  eyebrow: string
  /** The line the card is about: `HEIC to JPG`. */
  headline: string
  /** The opening of the page's own introduction, cut to fit. */
  subline: string
  /** The promise along the bottom, identical on every card. */
  footer: string
  /** What a screen reader is told the image says. */
  alt: string
}

/**
 * The card for one pair, or `undefined` when the pair has no copy.
 *
 * `undefined` rather than a card with the subline left out. A pair with no copy
 * is a bug `test/registry/copy.test.ts` catches; drawing a plausible card for it
 * would let that bug ship as a page whose preview is subtly emptier than the
 * rest.
 */
export function ogCard(pair: ConversionPair): OgCard | undefined {
  const copy = copyFor(pair.slug)
  if (copy === undefined) return undefined

  const from = formatMeta(pair.from)
  const to = formatMeta(pair.to)
  const headline = `${from.name} to ${to.name}`

  return {
    eyebrow: FAMILY[from.kind],
    headline,
    subline: clampToWords(copy.intro, MAX_OG_SUBLINE_CHARS),
    footer: OG_FOOTER,
    // Describes the card, not the page. A reader who cannot see the image is
    // being told what the picture is, and the page's title is already in the
    // link next to it.
    alt: `Docify card for converting ${headline} in the browser`,
  }
}

/**
 * Where one pair's card is served from.
 *
 * The path the `opengraph-image.tsx` file convention creates under the page's
 * own route, made absolute — a relative `og:image` is one no crawler can
 * fetch, and the crawler is not on this origin when it reads the tag.
 *
 * Built here rather than taken from Next.js's own injection because the page
 * declares `openGraph.images` itself: see the header of
 * `app/convert/[pair]/opengraph-image.tsx` for why the alt text could not come
 * from the file convention, and `lib/seo/site.ts` for why every absolute URL on
 * this site is built from one constant.
 */
export function ogImageUrl(pair: ConversionPair): string {
  return absoluteUrl(`${convertHref(pair.from, pair.to)}/opengraph-image`)
}

/**
 * The card for every page that is not about one conversion.
 *
 * The home page, the hub and anything added later inherit it through the App
 * Router's metadata cascade, so a link to a page nobody wrote a card for still
 * previews as something rather than as a grey rectangle.
 */
export function siteCard(): OgCard {
  return {
    eyebrow: 'FILE CONVERTER',
    // Not the brand: the card already carries `Docify` in the mark along its
    // bottom edge, and a headline that repeats it says the same word twice and
    // nothing about what the site does.
    headline: 'Any file, any format',
    subline: SITE_DESCRIPTION,
    footer: OG_FOOTER,
    alt: `${SITE_NAME} — ${SITE_DESCRIPTION}`,
  }
}
