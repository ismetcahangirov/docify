/**
 * The facts about the site itself that every page has to agree on.
 *
 * One module, because a canonical URL built from one constant and an Open Graph
 * URL built from another is how a page ends up declaring itself canonical to an
 * address it is not served from — which is worse than having no canonical tag
 * at all.
 */

/**
 * Where the site lives, with no trailing slash.
 *
 * A literal rather than an environment variable. A canonical URL that varies by
 * deployment is a canonical URL that points at a preview build from production,
 * and the one thing this value must never do is differ between two renders of
 * the same page.
 *
 * It is a free Vercel subdomain rather than a domain of its own (issue #303),
 * and `docify.vercel.app` was taken by an unrelated project. That is a fact
 * about what the deployment answers on, not an aspiration: an origin the site
 * does not serve is one that makes every canonical tag, every sitemap entry and
 * every `og:url` name somebody else's host. Moving to a bought domain later is
 * this line, the allowlist in `render.yaml`, and a redirect — cheapest before
 * there is indexed history to carry across.
 *
 * Nothing else may repeat this string. `test/seo/site-origin.test.ts` is what
 * says so, and it counts comments, because a stale address in prose is the copy
 * that never fails.
 */
export const SITE_ORIGIN = 'https://docify-convert.vercel.app'

/** The name used in titles, structured data and the Open Graph site name. */
export const SITE_NAME = 'Docify'

/** One sentence about the product, for the home page and the organisation card. */
export const SITE_DESCRIPTION =
  'Convert any file entirely in your browser. No upload, no sign-up, no limits.'

/** `${SITE_ORIGIN}/convert/heic-to-jpg` from `/convert/heic-to-jpg`. */
export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}
