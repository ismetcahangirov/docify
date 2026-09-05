import { createHash, randomBytes } from 'node:crypto'

/**
 * Who a request is from, in a form that cannot say who a request is from.
 *
 * The rate limiter has to tell callers apart, and the only thing that tells
 * callers apart is the address — which is precisely what CLAUDE.md §2.1 and the
 * plan's task 10.1 say is never retained. The two are reconciled here rather
 * than argued about in a comment somewhere upstream:
 *
 * 1. The address is hashed with a salt minted when the process starts, held
 *    only in memory and never written anywhere. Without the salt the digest
 *    cannot be walked back — an unsalted SHA-256 of an IPv4 address is
 *    reversible by anyone willing to hash four billion strings.
 * 2. The digest is truncated to 64 bits. Enough to keep callers apart, short
 *    enough that it is not a durable identifier even to somebody holding both
 *    the salt and the digest.
 * 3. The result lives in `lib/api/rate-limit.ts`'s map for one window and is
 *    then swept. It never reaches the database — `lib/db/schema.sql` has no
 *    column that could hold it — and it does not survive the process.
 *
 * ## Why only the last hop
 *
 * `x-forwarded-for` is a list a proxy *appends* to, so it runs client-first:
 * the leading entry is whatever the client sent, and the only entry anybody
 * here put there is the last one, written by the platform immediately in front
 * of this process. Reading the first would mean keying the limiter on a string
 * the caller types — one client sending a fresh value per request mints a fresh
 * key per request and never meets the limiter at all.
 *
 * On Vercel the header is normalised before a function sees it, so today the
 * two readings agree. They stop agreeing the moment this runs anywhere else,
 * and a rate limiter that is correct only on one host is a rate limiter with a
 * deployment note nobody will read.
 */

/** Minted per process, never persisted, never logged. */
const SALT = randomBytes(32)

/** No usable header: one shared bucket, so an unidentifiable caller is limited rather than exempt. */
const UNKNOWN = 'unknown'

/** The address a request appears to come from, or `UNKNOWN`. */
function address(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  // Empty entries dropped rather than trusted: a trailing comma would
  // otherwise read as an address of no length and send an identifiable caller
  // to the bucket shared by every unidentifiable one.
  const hops =
    forwarded
      ?.split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0) ?? []
  const nearest = hops.at(-1)

  if (nearest !== undefined) return nearest

  const real = request.headers.get('x-real-ip')?.trim()

  return real !== undefined && real.length > 0 ? real : UNKNOWN
}

/** A stable, unreversible, process-local key for the caller. */
export function clientKey(request: Request): string {
  return createHash('sha256').update(SALT).update(address(request)).digest('hex').slice(0, 16)
}
