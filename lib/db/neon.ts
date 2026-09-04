import { neon } from '@neondatabase/serverless'

import type { Query } from './stats'

/**
 * The connection to Neon, or `null` when there is not one.
 *
 * `null` is a first-class answer here, not an error path. Docify has to build,
 * test, run locally and deploy a preview with no `DATABASE_URL` at all, and in
 * every one of those the correct behaviour is the same: skip the counter and
 * carry on. Returning `null` puts that decision in the type system rather than
 * in a `try` around every call site.
 *
 * `@neondatabase/serverless` is used over the HTTP path rather than the WebSocket
 * one. A counter is a single-statement write with no transaction and no session
 * state, which is exactly what that path is for, and it keeps the route handler
 * free of a connection pool that a Fluid Compute instance would have to manage
 * across invocations.
 *
 * The client is cached per connection string, so a warm instance builds it once.
 * Keyed on the string rather than a boolean, so rotating the secret is picked up
 * without a redeploy.
 */

let cached: { url: string; query: Query } | null = null

export function connection(): Query | null {
  const url = process.env.DATABASE_URL

  if (url === undefined || url.length === 0) return null
  if (cached !== null && cached.url === url) return cached.query

  try {
    // The driver's own type is a much wider callable than this module needs —
    // it is also an ordinary function, and overloaded. `Query` is the tagged
    // template half of it, which is the only half anything here uses.
    cached = { url, query: neon(url) as unknown as Query }
  } catch {
    // A malformed connection string. Nothing about that is worth failing a
    // conversion over, and a thrown constructor is the one failure mode
    // `recordConversion` cannot catch on the caller's behalf.
    return null
  }

  return cached.query
}
