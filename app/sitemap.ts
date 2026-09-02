import type { MetadataRoute } from 'next'

import { PAIRS } from '@/lib/registry/pairs'
import { pageMetadata } from '@/lib/seo/metadata'
import { absoluteUrl } from '@/lib/seo/site'

/*
 * Every page worth crawling, and nothing else.
 *
 * ## Why the URLs come from the metadata generator
 *
 * A sitemap is a list of URLs a crawler is asked to visit, and the canonical
 * tag on each of those pages is the URL it claims to be. When the two disagree —
 * a trailing slash, an origin, a stale path — the crawler is told to fetch one
 * address and then told by the page that the real one is somewhere else, and it
 * believes the page. So neither list is built by hand: both come from
 * `pageMetadata()`, and `test/app/sitemap.test.ts` asserts they are the same
 * string.
 *
 * ## Why a page must be indexable to be listed
 *
 * Submitting a `noindex` page is a contradiction a crawler reports back as a
 * warning, and enough of them devalue the whole submission. `/tools` is still
 * the placeholder that carries `robots: { index: false }` and is therefore
 * deliberately absent; it joins this list when it becomes a real page.
 *
 * ## Why priority is written down at all
 *
 * It is advisory and widely ignored, and it costs nothing to state. What it
 * does say — to the crawler and to whoever reads the file next — is which of a
 * hundred and twenty-four pages the site itself considers load-bearing. The
 * values come from the catalogue's own demand tiers rather than from a second
 * opinion invented here.
 */

/** Where each demand tier sits on the sitemap's 0-to-1 scale. */
const PRIORITY: Readonly<Record<string, number>> = {
  high: 0.9,
  medium: 0.7,
  low: 0.5,
}

/** The hub, which every conversion page's breadcrumb passes through. */
const HUB_PRIORITY = 0.9

/** The home page, which is the one URL that is not about a conversion. */
const HOME_PRIORITY = 1

/**
 * How often the content actually changes.
 *
 * `monthly` rather than `daily`, which is the number sitemaps are usually
 * padded with. These pages change when their copy is rewritten or an engine
 * gains a format, and claiming otherwise trains a crawler to ignore the field.
 */
const CHANGE_FREQUENCY = 'monthly' as const

export default function sitemap(): MetadataRoute.Sitemap {
  // One timestamp for the whole build, not one per entry. `lastModified` is a
  // claim about the content, and 124 slightly different times would be 124
  // claims that the pages changed independently when they were all generated
  // from the same commit.
  const lastModified = new Date()

  const pairs = PAIRS.flatMap((pair) => {
    const meta = pageMetadata(pair)
    // Unreachable through the catalogue — `test/registry/copy.test.ts` proves
    // every pair has copy — and skipping rather than throwing means a missing
    // page cannot take the whole sitemap down with it.
    if (meta === undefined) return []

    return [
      {
        url: meta.canonical,
        lastModified,
        changeFrequency: CHANGE_FREQUENCY,
        priority: PRIORITY[pair.demand] ?? PRIORITY.medium,
      },
    ]
  })

  return [
    {
      url: absoluteUrl('/'),
      lastModified,
      changeFrequency: CHANGE_FREQUENCY,
      priority: HOME_PRIORITY,
    },
    {
      url: absoluteUrl('/convert'),
      lastModified,
      changeFrequency: CHANGE_FREQUENCY,
      priority: HUB_PRIORITY,
    },
    ...pairs,
  ]
}
