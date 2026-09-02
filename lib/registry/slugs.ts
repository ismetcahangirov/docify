/**
 * The URL a conversion lives at.
 *
 * One function, in one place, because the slug is load-bearing in four: the
 * static route reads it, the sitemap lists it, the internal links point at it,
 * and the canonical tag declares it. A second copy of `${from}-to-${to}` is how
 * a page ends up canonicalised to a URL it is not served from.
 *
 * Values only, no data: the catalogue of which pairs exist is
 * `lib/registry/pairs.ts`, and this module is what that one names them with.
 */

import type { FormatId } from '@/lib/router/types'

/** The path segment for a conversion: `heic-to-jpg`. */
export function pairSlug(from: FormatId, to: FormatId): string {
  return `${from}-to-${to}`
}

/**
 * The page a conversion is performed on.
 *
 * Keyed on the format pair alone and not on the operation. A page is a
 * destination people arrive at from a search for "heic to jpg", and one URL per
 * `op` would split that search between two pages that do the same thing; the
 * operations that are not a format swap — merge, split, protect — have their own
 * `/tools/` pages instead.
 */
export function convertHref(from: FormatId, to: FormatId): string {
  return `/convert/${pairSlug(from, to)}`
}

/**
 * The pair a slug names, or `null` when it names none.
 *
 * Splits on the *last* `-to-` so that a format containing the separator could
 * never be mis-split. None does today; relying on that is how it breaks when one
 * does.
 */
export function parsePairSlug(slug: string): { from: string; to: string } | null {
  const at = slug.lastIndexOf('-to-')
  if (at <= 0) return null

  const from = slug.slice(0, at)
  const to = slug.slice(at + '-to-'.length)

  return from.length === 0 || to.length === 0 ? null : { from, to }
}
