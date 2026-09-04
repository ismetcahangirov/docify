import type { Metadata } from 'next'

/**
 * The Search Console ownership tag, when there is one (issue #103).
 *
 * ## Why this is not in `lib/seo/site.ts`
 *
 * Everything in that module is a fact about the site that every page has to
 * agree on, and every one of them is a literal for the reason its header gives:
 * a value that varies by deployment is how a page ends up claiming to be
 * something it is not.
 *
 * A verification token is not that kind of fact. It is issued by a console, to
 * one property, for one account, and it can be reissued without anything about
 * the site changing. It belongs to whoever owns the deployment rather than to
 * the source, which is what makes it an environment variable — and what makes
 * its absence normal rather than broken. Preview deployments have no token,
 * local builds have no token, and neither should render a tag claiming
 * ownership.
 *
 * ## Why the value is parsed
 *
 * Search Console does not hand over a token. It hands over
 * `<meta name="google-site-verification" content="…" />` behind a copy button,
 * and the whole line going into an environment variable is the ordinary
 * outcome. Rendering that produces a `content` attribute full of escaped markup
 * in the `<head>` of all 128 pages, and Google reports a failed verification
 * without saying why — so the tag is unwrapped here, and anything that is still
 * not a token is dropped rather than rendered.
 *
 * ## Why the meta tag rather than a DNS record
 *
 * Both work, and the DNS TXT record is the better one — it verifies a *domain*
 * property, which covers `www`, every subdomain and both protocols at once, and
 * it survives a change of host. `docs/seo/search-console.md` recommends it
 * first. This exists for the case the record cannot cover: verifying before DNS
 * has moved, or on a deployment that is not the apex domain.
 */

/** What a verification token is allowed to contain. */
const TOKEN = /^[A-Za-z0-9_-]+$/

/** `content="…"` out of a whole meta tag, in either quote style. */
const PASTED_TAG = /<meta[^>]*\bcontent=("([^"]*)"|'([^']*)')[^>]*>/i

/**
 * The token in a value that may be a token or may be the tag around one.
 *
 * @returns the token, or `null` when what is left is not one.
 */
function tokenIn(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  const unwrapped = trimmed.startsWith('<')
    ? (PASTED_TAG.exec(trimmed)?.[2] ?? PASTED_TAG.exec(trimmed)?.[3] ?? '').trim()
    : trimmed

  return TOKEN.test(unwrapped) ? unwrapped : null
}

/**
 * The `verification` block for the root metadata, or `undefined` for no tag.
 *
 * The environment is a parameter rather than read from `process.env` inside, so
 * this is testable without mutating global state — the same rule the router
 * follows about `Capabilities` (CLAUDE.md §5.1).
 */
export function siteVerification(
  env: Record<string, string | undefined> = process.env,
): Metadata['verification'] | undefined {
  const token = tokenIn(env.GOOGLE_SITE_VERIFICATION ?? '')

  return token === null ? undefined : { google: token }
}
