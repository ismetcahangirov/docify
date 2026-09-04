import { clientKey } from '@/lib/api/client-key'
import { createRateLimiter } from '@/lib/api/rate-limit'
import { connection } from '@/lib/db/neon'
import { parseConversionEvent } from '@/lib/db/parse-event'
import { readTotals, recordConversion } from '@/lib/db/stats'

/**
 * `POST /api/stats` — one anonymous conversion counter, incremented.
 *
 * ## What "fire-and-forget" means, and where
 *
 * The acceptance criterion is that a failure never blocks or slows a
 * conversion. That is a property of the *client*, and it is enforced there:
 * `lib/stats/report.ts` sends with `navigator.sendBeacon`, returns
 * synchronously, and nothing in `components/converter/` ever awaits it.
 *
 * So this handler does not need to be fire-and-forget as well, and deliberately
 * is not. Answering before the write lands would mean unawaited work on a
 * platform that may freeze the instance the moment a response is returned —
 * dropping the write for no gain, since nobody is waiting on the answer anyway.
 * It awaits the write, and then answers 202 whatever happened.
 *
 * ## Why every failure is a 202
 *
 * A client that learns the counter is down can do nothing useful with that.
 * There is no retry worth making, and a browser console full of failed beacons
 * on a conversion page is a support question about a feature the user never
 * asked for. The one thing the response does distinguish is a *client* error —
 * a malformed event, an over-large body, too many requests — because those are
 * bugs in the caller and silence would hide them.
 *
 * `GET` serves the same counters back as two figures, and takes the same view
 * of an outage: `{ available: false }` with a 200, never a 500. A page that
 * shows the figures has to render without them anyway (#86), and a homepage
 * that fails because a statistics table is unreachable would be precisely the
 * critical-path dependency the plan says this backend must never become.
 */

/** The body of a well-formed event is about sixty bytes. */
const MAX_BODY_BYTES = 512

/**
 * Per instance, per minute, per caller.
 *
 * Sixty is far above what a person converting files can produce and far below
 * what makes a script worth writing. See `lib/api/rate-limit.ts` for why an
 * in-memory limiter is the right size of answer for a counter.
 */
const WINDOW_MS = 60_000
const limiter = createRateLimiter({ limit: 60, windowMs: WINDOW_MS })

/** Nothing about a write is cacheable, and a cached 202 would silently drop counts. */
const NO_STORE = { 'cache-control': 'no-store' }

function answer(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...NO_STORE, ...headers } })
}

/**
 * Five minutes at the CDN, and a stale answer served while the next one is
 * fetched.
 *
 * The alternative to `stale-while-revalidate` is that every five minutes one
 * unlucky visitor waits on a round trip to Neon so that everyone after them
 * does not. Counters are the least urgent data on the page; nobody should pay
 * latency for them.
 */
const FRESH_SECONDS = 300
const STALE_SECONDS = 600

/**
 * A much shorter window for an outage.
 *
 * Caching "we have no figures" for five minutes would outlast the outage — a
 * deployment given its connection string would keep serving the empty answer
 * from the edge long after it could serve a real one. Ten seconds still absorbs
 * a stampede.
 */
const UNAVAILABLE_SECONDS = 10

function figures(body: unknown, seconds: number, stale: number): Response {
  return Response.json(body, {
    headers: {
      'cache-control': `public, s-maxage=${seconds}, stale-while-revalidate=${stale}`,
    },
  })
}

export async function POST(request: Request): Promise<Response> {
  if (!limiter.check(clientKey(request))) {
    return answer(429, { 'retry-after': String(Math.ceil(WINDOW_MS / 1000)) })
  }

  const body = await request.text()

  // Measured in bytes rather than characters: a multi-byte payload that is
  // short in code points is not short on the wire.
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return answer(413)

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return answer(400)
  }

  const event = parseConversionEvent(parsed)
  if (event === null) return answer(400)

  await recordConversion(event, connection())

  return answer(202)
}

/**
 * Read far more generously than the write.
 *
 * Behind a five-minute CDN cache almost nothing reaches this handler at all, so
 * the limiter is here for the caller that sets `cache-control: no-cache` and
 * asks two hundred times a second. Two hundred a minute is well past any page
 * and well short of a useful load generator.
 */
const readLimiter = createRateLimiter({ limit: 200, windowMs: WINDOW_MS })

export async function GET(request: Request): Promise<Response> {
  if (!readLimiter.check(clientKey(request))) {
    return answer(429, { 'retry-after': String(Math.ceil(WINDOW_MS / 1000)) })
  }

  const totals = await readTotals(connection())

  if (totals === null)
    return figures({ available: false }, UNAVAILABLE_SECONDS, UNAVAILABLE_SECONDS)

  return figures({ available: true, ...totals }, FRESH_SECONDS, STALE_SECONDS)
}
