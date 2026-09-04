import type { PageView } from './parse-view'
import type { Query } from './stats'

/**
 * The second write a Docify server performs, and the last (issue #102).
 *
 * It is the same shape as `recordConversion` in `lib/db/stats.ts`, for the same
 * reasons: the connection arrives as a parameter so the module can be tested
 * for what it does *without* a database, and it never throws, because a counter
 * is not on the critical path of anything. A page view is even further from one
 * than a conversion is — nobody is waiting on it, and the visitor has already
 * read the page by the time it is sent.
 */

/**
 * Adds one to the counter for a page opened today.
 *
 * Resolves `true` when the row was written and `false` for every other outcome,
 * including there being no database at all. Never rejects.
 *
 * The day comes from `current_date` rather than from the request, for the
 * reason `recordConversion` gives: a date the client supplies is a field the
 * client controls.
 */
export async function recordPageView(view: PageView, query: Query | null): Promise<boolean> {
  if (query === null) return false

  try {
    await query`
      insert into page_totals (page, day, total)
      values (${view.page}, current_date, 1)
      on conflict (page, day)
      do update set total = page_totals.total + 1
    `

    return true
  } catch {
    return false
  }
}
