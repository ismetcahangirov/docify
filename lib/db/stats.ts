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
