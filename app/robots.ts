import type { MetadataRoute } from 'next'

import { SITE_ORIGIN, absoluteUrl } from '@/lib/seo/site'

/*
 * What a crawler is allowed to fetch, which here is everything.
 *
 * ## Why there is nothing to disallow
 *
 * A `robots.txt` disallow is usually protecting a search page, a user account
 * area or an admin route from being crawled. This site has none of those: there
 * is no account, no server-side processing, and every URL is a static page
 * generated from the catalogue. `/api/*` will eventually hold the anonymous
 * counters, and even that is a route no crawler would follow, since nothing
 * links to it.
 *
 * ## Why `noindex` is not expressed here
 *
 * `robots.txt` controls crawling, not indexing, and the two are routinely
 * confused. Disallowing a page stops a crawler reading it — including reading
 * the `noindex` on it, which is why a disallowed page can still appear in
 * results as a bare URL. Pages that should not be indexed say so in their own
 * metadata, where a crawler can actually see it. `/tools` is the current
 * example.
 *
 * ## Why the sitemap is named here
 *
 * It is the one line in `robots.txt` that is about discovery rather than
 * permission, and it is how a crawler that arrived from a link rather than from
 * Search Console finds the other 125 pages.
 */

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE_ORIGIN,
  }
}
