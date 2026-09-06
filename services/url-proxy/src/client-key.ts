import { createHash, randomBytes } from 'node:crypto'

/**
 * Who a request is from, in a form that cannot say who a request is from.
 *
 * The same reconciliation `lib/api/client-key.ts` makes for the app, made again
 * here because the service deploys alone and cannot import it (issue #269, and
 * see the header of `rate-limit.ts`). The rate limiter has to tell callers
 * apart, and the only thing that tells callers apart is the address — which is
 * precisely what CLAUDE.md §2.1 says is never retained.
 *
 * 1. The address is hashed with a salt minted when the process starts, held
 *    only in memory and never written anywhere. An unsalted SHA-256 of an IPv4
 *    address is reversible by anyone willing to hash four billion strings.
 * 2. The digest is truncated to 64 bits: enough to keep callers apart, short
 *    enough not to be a durable identifier even to somebody holding the salt.
 * 3. It lives in the limiter's map for one window and is then swept. This
 *    service has no database and no log line that carries it.
 *
 * ## Why the last hop, and why the socket underneath it
 *
 * `x-forwarded-for` is a list a proxy *appends* to, so it runs client-first:
 * the leading entry is whatever the client sent. Keying on that would let one
 * script mint a fresh key per request and never meet the limiter at all. The
 * last entry is the one Render wrote, immediately in front of this process.
 *
 * And when the header is absent entirely, the fallback is the socket's own
 * address — passed in by `server.ts`, never read from a header. A header-only
 * fallback would mean a caller who simply omits the header shares one bucket
 * with everybody else who did, which is a bucket worth being in.
 *
 * The cost is that the last hop is coarse: everybody arriving through one CDN
 * egress shares a bucket. That is the right way round for a limiter — a shared
 * bucket limits people who should not have been, where a forgeable one limits
 * nobody — but it is a real cost rather than a free win.
 */

/** Minted per process, never persisted, never logged. */
const SALT = randomBytes(32)

/** Nothing usable: one shared bucket, so an unidentifiable caller is limited rather than exempt. */
const UNKNOWN = 'unknown'

/** The address a request appears to come from, or `UNKNOWN`. */
function address(request: Request, remoteAddress?: string): string {
  const forwarded = request.headers.get('x-forwarded-for')
  // Empty entries dropped rather than trusted: a trailing comma would otherwise
  // read as an address of no length and send an identifiable caller to the
  // bucket shared by every unidentifiable one.
  const hops =
    forwarded
      ?.split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0) ?? []
  const nearest = hops.at(-1)

  if (nearest !== undefined) return nearest

  const socket = remoteAddress?.trim()

  return socket !== undefined && socket.length > 0 ? socket : UNKNOWN
}

/** A stable, unreversible, process-local key for the caller. */
export function clientKey(request: Request, remoteAddress?: string): string {
  return createHash('sha256')
    .update(SALT)
    .update(address(request, remoteAddress))
    .digest('hex')
    .slice(0, 16)
}
