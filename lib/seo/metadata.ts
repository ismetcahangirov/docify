/**
 * The title, description and canonical URL for one conversion page.
 *
 * A hundred and twenty-four pages built from one template is a hundred and
 * twenty-four chances to ship the same `<title>` twice, and a set of pages that
 * share a title is a set Google picks one of and discards the rest. So the
 * generator is here, in one place, and `test/seo/metadata.test.ts` asserts
 * across the whole catalogue rather than on an example.
 *
 * ## Where the uniqueness actually comes from
 *
 * Not from the generator, which is a template like any other. It comes from the
 * copy: every page's `h1` is written by hand and distinct, and the description
 * is built from that heading plus the opening of that page's own introduction.
 * A template over unique inputs is fine; a template over interchangeable inputs
 * is the thing being avoided.
 *
 * ## Why the lengths are enforced rather than advised
 *
 * A title past about sixty characters is truncated in the result, and a
 * description under a hundred and forty is a description Google rewrites from
 * the page body. Both limits are arithmetic, and arithmetic is exactly what a
 * person writing the hundredth page stops doing.
 */

import { copyFor } from '@/lib/registry/copy'
import { formatMeta } from '@/lib/registry/formats'
import type { ConversionPair } from '@/lib/registry/pairs'
import { convertHref } from '@/lib/registry/slugs'

import { SITE_NAME, absoluteUrl } from './site'

/** The most a title can carry before a search result truncates it. */
export const MAX_TITLE_CHARS = 60

/** The window a description has to land in to be used as written. */
export const MIN_DESCRIPTION_CHARS = 140
export const MAX_DESCRIPTION_CHARS = 155

/**
 * The sentence every description ends with.
 *
 * Fixed, and deliberately short. It carries the two claims that decide whether
 * somebody clicks — it costs nothing and the file does not leave their machine —
 * and it is thirty-one characters, so the hundred and nine before it are still
 * doing the work of telling the pages apart.
 */
const DESCRIPTION_TAIL = ' Free, and nothing is uploaded.'

/** Everything a conversion page declares about itself. */
export interface PageMetadata {
  title: string
  description: string
  /** Absolute, and the same URL the page is served from. */
  canonical: string
  /** The path, for internal links and the sitemap. */
  path: string
}

/**
 * Metadata for one pair, or `undefined` when the pair has no copy.
 *
 * `undefined` rather than a fallback title. A page whose copy is missing is a
 * bug the catalogue test catches; generating a plausible title for it would let
 * that bug ship instead.
 */
export function pageMetadata(pair: ConversionPair): PageMetadata | undefined {
  const copy = copyFor(pair.slug)
  if (copy === undefined) return undefined

  const path = convertHref(pair.from, pair.to)

  return {
    title: pageTitle(pair),
    description: pageDescription(copy.h1, copy.intro),
    canonical: absoluteUrl(path),
    path,
  }
}

/**
 * `HEIC to JPG Converter — Free, In Your Browser | Docify`
 *
 * The format pair leads, because that is what was searched for and what has to
 * survive truncation on a narrow result. The brand is last for the same reason:
 * it is the part a reader can lose without losing the meaning.
 */
export function pageTitle(pair: ConversionPair): string {
  const from = formatMeta(pair.from).name
  const to = formatMeta(pair.to).name

  return `${from} to ${to} Converter — Free, In Your Browser | ${SITE_NAME}`
}

/**
 * The page's own heading, then as much of its own introduction as fits, then
 * the fixed tail.
 *
 * Truncation is at a word boundary with an ellipsis, which is what a search
 * result does anyway — the difference is that doing it here means the sentence
 * that survives is the one that was chosen, rather than whichever hundred and
 * fifty-five characters the crawler happened to take.
 */
export function pageDescription(h1: string, intro: string): string {
  const room = MAX_DESCRIPTION_CHARS - DESCRIPTION_TAIL.length
  const lead = `${h1}. ${intro}`

  return `${clamp(lead, room)}${DESCRIPTION_TAIL}`
}

/**
 * `text` cut to at most `limit` characters, at a word boundary, with an
 * ellipsis where anything was removed.
 *
 * The ellipsis is one character (U+2026) rather than three full stops, because
 * three cost three of the characters the sentence needed.
 */
function clamp(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= limit) return collapsed

  // One character back from the limit, to leave room for the ellipsis itself.
  const cut = collapsed.slice(0, limit - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const words = lastSpace === -1 ? cut : cut.slice(0, lastSpace)

  // A trailing comma or full stop in front of an ellipsis reads as a mistake.
  return `${words.replace(/[\s,.;:—-]+$/u, '')}…`
}
