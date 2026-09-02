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
 */
export const SITE_ORIGIN = 'https://docify.app'

/** The name used in titles, structured data and the Open Graph site name. */
export const SITE_NAME = 'Docify'

/** One sentence about the product, for the home page and the organisation card. */
export const SITE_DESCRIPTION =
  'Convert any file entirely in your browser. No upload, no sign-up, no limits.'

/** `https://docify.app/convert/heic-to-jpg` from `/convert/heic-to-jpg`. */
export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}
