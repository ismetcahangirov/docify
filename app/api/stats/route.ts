import { clientKey } from '@/lib/api/client-key'
import { createRateLimiter } from '@/lib/api/rate-limit'
import { connection } from '@/lib/db/neon'
import { parseConversionEvent } from '@/lib/db/parse-event'
import { recordConversion } from '@/lib/db/stats'

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

/** Nothing here is cacheable, and a cached 202 would silently drop counts. */
const HEADERS = { 'cache-control': 'no-store' }

function answer(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...HEADERS, ...headers } })
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
