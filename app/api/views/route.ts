import { clientKey } from '@/lib/api/client-key'
import { createRateLimiter } from '@/lib/api/rate-limit'
import { connection } from '@/lib/db/neon'
import { parsePageView } from '@/lib/db/parse-view'
import { recordPageView } from '@/lib/db/views'

/**
 * `POST /api/views` — one anonymous page counter, incremented (issue #102).
 *
 * The analytics endpoint, and the whole of it. It takes one field, checks it
 * against the site's own route list, adds one to a row keyed on the page and
 * the date, and answers 202. There is nothing else on the wire and nothing else
 * in the table.
 *
 * ## Why there is no GET here
 *
 * `GET /api/stats` exists because a page shows those figures. Nothing shows
 * these. They are read by `pnpm analytics`, by somebody who already holds the
 * connection string — which is why there is no cache policy, no public JSON
 * shape and no second rate limiter to reason about. Publishing which pages get
 * traffic is a decision nobody has made, and a route handler is a strange place
 * to make it by accident.
 *
 * ## Why the limit is higher than the counter's
 *
 * `/api/stats` is written once per conversion; this is written once per page
 * opened, and somebody reading through the catalogue clicks faster than they
 * convert. A hundred and twenty a minute is above any person and far below what
 * makes a script worth writing.
 *
 * Everything else about the shape of this handler — 202 for every outcome the
 * caller cannot act on, 400 only for the caller's own bugs, `no-store` — is the
 * argument `app/api/stats/route.ts` makes at length, and is not repeated.
 */

/** The body of a well-formed view is about forty bytes. */
const MAX_BODY_BYTES = 512

const WINDOW_MS = 60_000
const limiter = createRateLimiter({ limit: 120, windowMs: WINDOW_MS })

/** Nothing about a write is cacheable, and a cached 202 would silently drop counts. */
const NO_STORE = { 'cache-control': 'no-store' }

function answer(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...NO_STORE, ...headers } })
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

  const view = parsePageView(parsed)
  if (view === null) return answer(400)

  await recordPageView(view, connection())

  return answer(202)
}
