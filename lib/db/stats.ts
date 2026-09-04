import type { ConversionEvent } from './events'

/**
 * The one write a Docify server performs.
 *
 * ## It is handed its connection
 *
 * `recordConversion` takes the query function as a parameter for the reason
 * CLAUDE.md §5.1 gives about `Capabilities`: a module that reaches for its own
 * dependency cannot be tested without one, and this module has to be tested
 * precisely *for* what it does when the database is not there. `lib/db/neon.ts`
 * is what produces the argument; the route handler is what joins them.
 *
 * ## It never throws
 *
 * A counter is not on the critical path of anything (plan §0: "the backend is
 * an *optional* dependency, never on the critical path"), so every failure mode
 * — no connection string, a refused connection, a driver that throws before it
 * returns a promise — resolves to `false`. The caller decides what to do with
 * that, and what `app/api/stats/route.ts` decides is: nothing. It answers 202
 * either way, because a user converting a file is not the person to tell that a
 * statistics table is down.
 */

/**
 * A tagged-template SQL function, which is the shape `@neondatabase/serverless`
 * exports and the smallest surface this module needs.
 *
 * The tagged template is also the whole defence against injection: the values
 * travel out of band as parameters, so a `pair` of `'; drop table --` reaches
 * Postgres as a string that fails a CHECK constraint rather than as SQL.
 */
export type Query = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>

/**
 * Adds one to the counter this event belongs to.
 *
 * Resolves `true` when the row was written and `false` for every other outcome,
 * including there being no database at all. Never rejects.
 *
 * The day comes from `current_date` rather than from the request: a date the
 * client supplies is a field the client controls, and a counter whose day
 * column is attacker-controlled is not a counter.
 */
export async function recordConversion(
  event: ConversionEvent,
  query: Query | null,
): Promise<boolean> {
  if (query === null) return false

  try {
    await query`
      insert into conversion_totals (pair, outcome, size_bucket, day, total)
      values (${event.pair}, ${event.outcome}, ${event.bucket}, current_date, 1)
      on conflict (pair, outcome, size_bucket, day)
      do update set total = conversion_totals.total + 1
    `

    return true
  } catch {
    return false
  }
}

/** The two figures a page can show about what Docify has done. */
export interface Totals {
  /** Successful conversions, all time. */
  conversions: number
  /** How many distinct format pairs have been converted at least once. */
  pairs: number
}

/** A count that Postgres may have sent as a string, or `null` if it sent neither. */
function count(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value

  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

/**
 * The figures, or `null` when there are none to be had.
 *
 * `null` covers every reason equally: no connection string, a refused
 * connection, a driver that threw, an answer in a shape this function did not
 * ask for. The caller has one thing to decide — show the figures or do not —
 * and four ways of not having them would be four ways of writing the same
 * branch.
 *
 * An empty table is *not* one of those reasons. It is a working database with
 * nothing in it yet, and it answers zero.
 *
 * The aggregation happens in Postgres. The table has a row per pair per outcome
 * per bucket per day, and summing that in JavaScript would mean shipping a
 * year of it over the wire to render two numbers.
 */
export async function readTotals(query: Query | null): Promise<Totals | null> {
  if (query === null) return null

  try {
    const rows = await query`
      select
        coalesce(sum(total), 0) as conversions,
        count(distinct pair) as pairs
      from conversion_totals
      where outcome = 'success'
    `

    const row = rows[0]
    if (typeof row !== 'object' || row === null) return null

    const { conversions, pairs } = row as Record<string, unknown>
    const totals = { conversions: count(conversions), pairs: count(pairs) }

    if (totals.conversions === null || totals.pairs === null) return null

    return { conversions: totals.conversions, pairs: totals.pairs }
  } catch {
    return null
  }
}
