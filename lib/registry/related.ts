/**
 * Which other conversions each page points at.
 *
 * A hundred and twenty-four pages linked only from a sitemap is a hundred and
 * twenty-four pages a crawler visits once and never returns to. The links
 * between them are what makes the set a site: they distribute authority from the
 * pages that earn it to the pages that cannot, and they are how a reader who
 * arrived for the wrong conversion finds the right one.
 *
 * ## Hub and spoke, in three rules
 *
 * Every page links to at least six others, chosen deliberately rather than at
 * random:
 *
 * - **Three from the same source.** Somebody with a HEIC who did not want a JPG
 *   wanted a PNG, a WebP or a TIFF. This is the highest-intent link on the page.
 * - **Two into the same target.** Somebody who arrived on "WebP to JPG" is
 *   interested in JPG, which makes "PNG to JPG" a genuine neighbour rather than
 *   a filler link.
 * - **The reverse.** The single most common second search after a conversion is
 *   the way back.
 *
 * Anything still short of six is topped up from the same media family, by
 * demand. The hub itself — `/convert` — is added by the component that renders
 * these, because it is a link to a different kind of page and not a related
 * conversion.
 *
 * ## Why the neighbours are chosen by rotation
 *
 * "Take the first three siblings" gives every page in a family the same three
 * links, and leaves the eleventh target of MP4 linked from nowhere. Starting
 * each page's window at its *own* position and wrapping makes the selection a
 * cyclic cover: every sibling is somebody's first pick, so no page in the set
 * can be orphaned. `test/registry/related.test.ts` asserts that property
 * directly rather than trusting the argument.
 */

import { formatMeta } from './formats'
import type { ConversionPair } from './pairs'
import { PAIRS, pairBySlug, pairsFrom, pairsTo } from './pairs'
import { pairSlug } from './slugs'

/** How many related conversions a page must offer. */
export const RELATED_COUNT = 6

/** How many of them come from each rule, before the top-up. */
const FROM_SAME_SOURCE = 3
const INTO_SAME_TARGET = 2

/** Demand order, for the top-up. Highest first. */
const DEMAND_RANK: Readonly<Record<ConversionPair['demand'], number>> = {
  high: 0,
  medium: 1,
  low: 2,
}

/**
 * The conversions `pair` links to, in the order they should be rendered.
 *
 * Always exactly {@link RELATED_COUNT} of them, never including `pair` itself,
 * and never repeating one. The order is the priority order of the rules above,
 * because a reader scanning the list stops long before the end of it.
 */
export function relatedTo(pair: ConversionPair): readonly ConversionPair[] {
  const chosen: ConversionPair[] = []
  const taken = new Set<string>([pair.slug])

  const add = (candidate: ConversionPair | undefined) => {
    if (candidate === undefined || taken.has(candidate.slug)) return false
    taken.add(candidate.slug)
    chosen.push(candidate)

    return true
  }

  for (const sibling of rotated(pairsFrom(pair.from), pair).slice(0, FROM_SAME_SOURCE)) {
    add(sibling)
  }

  for (const sibling of rotated(pairsTo(pair.to), pair).slice(0, INTO_SAME_TARGET)) {
    add(sibling)
  }

  add(pairBySlug(pairSlug(pair.to, pair.from)))

  for (const candidate of topUp(pair)) {
    if (chosen.length >= RELATED_COUNT) break
    add(candidate)
  }

  return chosen.slice(0, RELATED_COUNT)
}

/**
 * `group` reordered so that it begins with the entry *after* `pair`, wrapping
 * around, and with `pair` itself removed.
 *
 * This is the cyclic cover described in the module header. Taking a fixed
 * prefix instead would give every page in a large family the same three links
 * and leave the tail of that family unlinked.
 */
function rotated(
  group: readonly ConversionPair[],
  pair: ConversionPair,
): readonly ConversionPair[] {
  const at = group.findIndex((candidate) => candidate.slug === pair.slug)
  if (at === -1) return group

  return [...group.slice(at + 1), ...group.slice(0, at)]
}

/**
 * Candidates for filling a short list: the same media family first, then
 * everything else, both by demand.
 *
 * Sparse sources are the reason this exists. A PDF has three targets and no
 * reverse conversion, so its rules produce two links and the remaining four have
 * to come from somewhere a reader might plausibly go next.
 */
function topUp(pair: ConversionPair): readonly ConversionPair[] {
  const family = formatMeta(pair.from).kind

  const rank = (candidate: ConversionPair) => {
    const sameFamily = formatMeta(candidate.from).kind === family ? 0 : 1

    return sameFamily * 10 + DEMAND_RANK[candidate.demand]
  }

  return [...PAIRS]
    .filter((candidate) => candidate.slug !== pair.slug)
    .sort((a, b) => rank(a) - rank(b) || PAIRS.indexOf(a) - PAIRS.indexOf(b))
}
