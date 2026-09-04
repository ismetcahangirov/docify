import { PAIR_SLUGS } from '@/lib/registry/pairs'

/**
 * The only way a page view gets from a request into `lib/db/views.ts`.
 *
 * ## Why the page is validated against the site's own routes
 *
 * `page` is the field that looks like free text, and it is the field an
 * analytics table normally *is*: a `text` column holding whatever path a client
 * reported. That is how a counter becomes a log. A path can carry a query
 * string, a fragment, an id, a token somebody pasted into a URL — and once one
 * of those is written down, "the database holds nothing identifying" is no
 * longer a structural claim about the schema but a hope about callers.
 *
 * So the column's domain is the same list `app/sitemap.ts` publishes. A page
 * that is not one of Docify's own 126 routes is refused rather than trimmed,
 * and the strongest statement about `page_totals` stays a structural one: there
 * is nothing in it that was not already public.
 *
 * ## Why a surplus field is a refusal
 *
 * The same argument `lib/db/parse-event.ts` makes. A client sending `referrer`
 * has misunderstood the contract, and answering it with 202 lets the
 * misunderstanding grow until somebody assumes the field is recorded.
 *
 * Server-side only. It pulls in the registry, which is why the browser half of
 * this — `lib/analytics/report.ts` — knows nothing about it and simply reports
 * the path it is on.
 */

/** One anonymous page view, as the client reports it and the counter stores it. */
export interface PageView {
  /** A route path of this site: `/`, `/convert`, `/convert/heic-to-jpg`. */
  page: string
}

/** The fields a view may carry. Anything else is a refusal, not a strip. */
const FIELDS = ['page'] as const

/**
 * Every path the site serves, and therefore every value this column may hold.
 *
 * `/tools` is included although the sitemap leaves it out: it is a real page a
 * visitor can open, and it is excluded from the sitemap for being `noindex`
 * while it is a placeholder — a statement about crawlers, not about whether the
 * page exists.
 */
const PAGES: ReadonlySet<string> = new Set([
  '/',
  '/convert',
  '/tools',
  ...PAIR_SLUGS.map((slug) => `/convert/${slug}`),
])

/**
 * The view `value` describes, or `null` when it describes none.
 *
 * A trailing slash is normalised away rather than refused. It is the same page,
 * and two rows for one page would be a defect in the figures rather than a
 * defence of anything.
 */
export function parsePageView(value: unknown): PageView | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const keys = Object.keys(value)
  if (keys.length !== FIELDS.length || !FIELDS.every((field) => keys.includes(field))) return null

  const { page } = value as Record<(typeof FIELDS)[number], unknown>
  if (typeof page !== 'string') return null

  const normalised = page.length > 1 && page.endsWith('/') ? page.slice(0, -1) : page

  return PAGES.has(normalised) ? { page: normalised } : null
}
