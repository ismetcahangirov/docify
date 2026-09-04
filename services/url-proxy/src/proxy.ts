import type { ProxyConfig } from './config.js'
import { limitStream } from './limit-stream.js'
import { checkUrl } from './url-guard.js'

/**
 * The URL import proxy (issue #87).
 *
 * A browser cannot fetch an arbitrary URL: the origin on the other end decides,
 * through CORS, and almost none of them say yes. So importing "a file at a URL"
 * needs one server in the middle, and this is the smallest one that does the
 * job — it reads the bytes and writes them straight back out.
 *
 * ## It never stores anything
 *
 * There is no disk write here and no buffer that holds a whole body. The
 * upstream's `ReadableStream` is piped through a counter and out to the client,
 * so a 90 MB file costs the chunk in flight and nothing else. That is the
 * privacy claim as well as the memory one: a file the service never holds is a
 * file it cannot leak, log or leave behind on a restarted instance.
 *
 * ## The ceiling is enforced twice
 *
 * `content-length`, when the upstream declares one, refuses the transfer before
 * a byte is read. When it does not — a chunked response, which is most of
 * them — `limitStream` counts on the way past and errors the stream at the
 * ceiling. The first is polite and the second is what actually holds.
 *
 * ## Two headers that are not decoration
 *
 * `access-control-allow-origin` is what lets the page read the answer at all.
 * `cross-origin-resource-policy: cross-origin` is what lets it read the answer
 * from a **cross-origin isolated** document, which every `/convert/*` page is
 * (`next.config.ts`). Without the second, Chromium blocks the response before
 * the page sees a byte, and the failure surfaces as an unexplained network
 * error — the same class of bug the COEP comment in `next.config.ts` records
 * about the worker chunk.
 *
 * ## Where the SSRF guard is
 *
 * In two places, and neither of them is here. `checkUrl` refuses what can be
 * decided from the URL — scheme, port, credentials, reserved names, literal
 * private addresses — and it runs below, so a refused URL is a 400 about the
 * URL rather than a 502 about an upstream. Everything else is inside the
 * `fetchImpl` this handler is given: `createGuardedFetch` pins the connection
 * to a vetted address and re-checks every redirect hop. See
 * `guarded-fetch.ts` and `safe-lookup.ts` (issue #88).
 */

/** What the proxy answers on. */
const FETCH_PATH = '/fetch'
const HEALTH_PATH = '/healthz'

/** Sent upstream instead of the visitor's own. Honest, and identical for everybody. */
const USER_AGENT = 'Docify-URL-Import/1.0'

/** When the upstream will not say, do not guess. */
const OPAQUE = 'application/octet-stream'

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

/** CORS and isolation headers for one allowed origin. */
function crossOrigin(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'cross-origin-resource-policy': 'cross-origin',
    vary: 'Origin',
  }
}

function fail(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { 'cache-control': 'no-store', ...headers } })
}

/**
 * A file name for the imported bytes, from the URL's last path segment.
 *
 * Stripped of anything that could change what the name means: a quote would end
 * the `filename="..."` early, and a separator would make it look like a path.
 * A URL with nothing usable gets a generic name rather than an empty one.
 */
function filenameOf(target: URL): string {
  const last = decodeURIComponent(target.pathname.split('/').filter(Boolean).pop() ?? '')
  const safe = last.replace(/[^A-Za-z0-9._-]/g, '')

  return safe.length > 0 ? safe.slice(0, 120) : 'download'
}

/** The URL the caller asked for, or `null` when it did not ask for one this service can use. */
function requestedUrl(request: Request): URL | null {
  const raw = new URL(request.url).searchParams.get('url')
  if (raw === null || raw.length === 0) return null

  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** Whether the upstream has already said the body is over the ceiling. */
function declaredTooLarge(upstream: Response, maxBytes: number): boolean {
  const declared = Number(upstream.headers.get('content-length'))

  return Number.isFinite(declared) && declared > maxBytes
}

export async function handleRequest(
  request: Request,
  config: ProxyConfig,
  fetchImpl: FetchImpl,
): Promise<Response> {
  const { pathname } = new URL(request.url)

  // Render polls this, and it has no origin. Answered before the allowlist so
  // a misconfigured `ALLOWED_ORIGINS` does not make the service look dead.
  if (pathname === HEALTH_PATH)
    return new Response('ok', { headers: { 'cache-control': 'no-store' } })

  if (pathname !== FETCH_PATH) return fail(404)

  const origin = request.headers.get('origin')
  if (origin === null || !config.allowedOrigins.includes(origin)) return fail(403)

  const cors = crossOrigin(origin)

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-max-age': '86400',
      },
    })
  }

  if (request.method !== 'GET') return fail(405, cors)

  const target = requestedUrl(request)
  if (target === null) return fail(400, cors)

  // Refused here rather than inside the fetch, so the caller gets a 400 about
  // the URL it supplied instead of a 502 about an upstream that was never
  // contacted. The reason is echoed because it is only ever a fact about the
  // caller's own input — it says nothing about this service's network.
  const verdict = checkUrl(target)
  if (!verdict.allowed) return fail(400, { ...cors, 'x-proxy-refused': verdict.reason })

  let upstream: Response
  try {
    upstream = await fetchImpl(target.toString(), {
      // Nothing of the visitor's travels with it: no cookie, no authorization,
      // no referer, and a user agent that is the same for everybody. The
      // upstream learns that Docify asked, and not who asked Docify.
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      credentials: 'omit',
      // The guarded fetch follows redirects itself, bounded and re-checking
      // each hop. Left to the platform, a 302 to http://169.254.169.254/ would
      // be followed by a client that has never heard of `checkUrl`.
      redirect: 'manual',
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (reason) {
    if (reason instanceof Error && reason.name === 'RefusedUrlError') {
      // A redirect walked somewhere the first URL did not. Still the caller's
      // URL, so still a 400.
      return fail(400, { ...cors, 'x-proxy-refused': 'redirect' })
    }

    if (reason instanceof Error && reason.name === 'BlockedAddressError') {
      return fail(400, { ...cors, 'x-proxy-refused': 'address' })
    }

    const timedOut = reason instanceof Error && /Timeout|TimeoutError|aborted/i.test(reason.name)

    return fail(timedOut ? 504 : 502, cors)
  }

  if (!upstream.ok) return fail(502, { ...cors, 'x-upstream-status': String(upstream.status) })
  if (declaredTooLarge(upstream, config.maxBytes)) return fail(413, cors)

  const headers: Record<string, string> = {
    ...cors,
    'content-type': upstream.headers.get('content-type') ?? OPAQUE,
    'content-disposition': `attachment; filename="${filenameOf(target)}"`,
    'cache-control': 'no-store',
    // The browser must not sniff a type out of bytes it is about to hand to a
    // conversion engine.
    'x-content-type-options': 'nosniff',
  }

  const declared = upstream.headers.get('content-length')
  if (declared !== null) headers['content-length'] = declared

  const body = upstream.body

  // A body-less 200 is legal and means an empty file.
  if (body === null) return new Response(null, { status: 200, headers })

  return new Response(body.pipeThrough(limitStream(config.maxBytes)), { status: 200, headers })
}
