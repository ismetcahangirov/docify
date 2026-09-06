import { describe, expect, it, vi } from 'vitest'

import type { ProxyConfig } from '../../../services/url-proxy/src/config'
import { type FetchImpl, handleRequest } from '../../../services/url-proxy/src/proxy'
import { createRateLimiter } from '../../../services/url-proxy/src/rate-limit'

/*
 * The URL import proxy (issue #87).
 *
 * `fetch` is a parameter rather than a global, for the reason CLAUDE.md §5.1
 * gives about `Capabilities`: every assertion below is about what the proxy
 * does with an upstream answer, and none of them should need one.
 *
 * The security half is issue #88 and lives beside this in `ip-ranges.test.ts`,
 * `url-guard.test.ts` and `guarded-fetch.test.ts`. What that leaves for this
 * file is how a refusal reaches the caller, and the shape of the service: it
 * streams, it never stores, it stops at a ceiling, and it answers only the
 * origins it was told about.
 */

const config: ProxyConfig = {
  maxBytes: 1_000,
  timeoutMs: 5_000,
  port: 8080,
  allowedOrigins: ['https://docify.app'],
  ratePerMinute: 30,
}

const ORIGIN = { origin: 'https://docify.app' }

/** An upstream that answers with `body` and whatever headers are asked for. */
const upstream = (body: BodyInit | null, init: ResponseInit = {}) =>
  vi.fn<FetchImpl>(async () => new Response(body, { status: 200, ...init }))

/**
 * A limiter with more allowance than any one test needs.
 *
 * A fresh one per call, so that only the tests in "the rate limit" below are
 * about limiting and the rest cannot fail because of the order they ran in.
 * `proxy.ts` builds a shared one when none is passed, which is what the service
 * itself relies on — a default that limits rather than one that does not.
 */
const generous = () => createRateLimiter({ limit: 1_000, windowMs: 60_000 })

const ask = (target: string, headers: Record<string, string> = ORIGIN, fetch = upstream('data')) =>
  handleRequest(
    new Request(`https://proxy.docify.app/fetch?url=${encodeURIComponent(target)}`, { headers }),
    config,
    fetch,
    { limiter: generous() },
  )

describe('the proxy', () => {
  it('streams the upstream body back', async () => {
    const response = await ask('https://example.com/photo.heic')

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('data')
  })

  it('passes the upstream content type through', async () => {
    const fetch = upstream('data', { headers: { 'content-type': 'image/heic' } })
    const response = await ask('https://example.com/photo.heic', ORIGIN, fetch)

    expect(response.headers.get('content-type')).toBe('image/heic')
  })

  it('falls back to an opaque type when the upstream declares none', async () => {
    // Bytes rather than a string: a string body makes `Response` invent
    // `text/plain`, and the case worth testing is the one where nothing did.
    const fetch = vi.fn<FetchImpl>(
      async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    )
    const response = await ask('https://example.com/photo', ORIGIN, fetch)

    // Never text/html. The browser is going to hand these bytes to an engine,
    // and a guess about the type is worse than an honest refusal to guess.
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('names the file after the URL, as an attachment', async () => {
    const response = await ask('https://example.com/holiday/photo.heic')

    expect(response.headers.get('content-disposition')).toBe('attachment; filename="photo.heic"')
  })

  it('refuses to put a quote or a path separator in the file name', async () => {
    const response = await ask('https://example.com/a%22b%2Fc.heic')
    const disposition = response.headers.get('content-disposition') ?? ''

    expect(disposition).not.toContain('"b')
    expect(disposition).toMatch(/^attachment; filename="[^"/\\]+"$/)
  })

  it('is readable by a cross-origin isolated document', async () => {
    const response = await ask('https://example.com/photo.heic')

    // /convert/* is COEP: require-corp. Without this header the browser blocks
    // the response before a single byte reaches the page, and the failure looks
    // like a network error with no explanation anywhere.
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(response.headers.get('access-control-allow-origin')).toBe('https://docify.app')
  })

  it('is never cached, because nothing here is ours to cache', async () => {
    expect((await ask('https://example.com/a.heic')).headers.get('cache-control')).toBe('no-store')
  })

  it('answers a preflight without fetching anything', async () => {
    const fetch = upstream('data')
    const response = await handleRequest(
      new Request('https://proxy.docify.app/fetch?url=https%3A%2F%2Fexample.com%2Fa', {
        method: 'OPTIONS',
        headers: ORIGIN,
      }),
      config,
      fetch,
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://docify.app')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('answers a health check without an origin at all', async () => {
    const response = await handleRequest(
      new Request('https://proxy.docify.app/healthz'),
      config,
      upstream('data'),
    )

    expect(response.status).toBe(200)
  })
})

describe('what the proxy refuses', () => {
  it('refuses an origin it was not told about', async () => {
    const fetch = upstream('data')
    const response = await ask('https://example.com/a.heic', { origin: 'https://evil.test' }, fetch)

    expect(response.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a request with no origin header', async () => {
    // A browser always sends one for a cross-origin request. Something that
    // does not is not the app, and this proxy exists for the app.
    expect((await ask('https://example.com/a.heic', {})).status).toBe(403)
  })

  it('refuses a path it does not serve', async () => {
    const response = await handleRequest(
      new Request('https://proxy.docify.app/', { headers: ORIGIN }),
      config,
      upstream('data'),
    )

    expect(response.status).toBe(404)
  })

  it('refuses a method it does not serve', async () => {
    const response = await handleRequest(
      new Request('https://proxy.docify.app/fetch?url=https%3A%2F%2Fexample.com%2Fa', {
        method: 'POST',
        headers: ORIGIN,
      }),
      config,
      upstream('data'),
    )

    expect(response.status).toBe(405)
  })

  it('refuses a missing or unparseable url', async () => {
    const bare = await handleRequest(
      new Request('https://proxy.docify.app/fetch', { headers: ORIGIN }),
      config,
      upstream('data'),
      { limiter: generous() },
    )

    expect(bare.status).toBe(400)
    expect((await ask('not a url at all')).status).toBe(400)
  })

  it('refuses a body the upstream declares as too large, before reading a byte', async () => {
    const fetch = vi.fn<FetchImpl>(
      async () =>
        new Response('x'.repeat(10), {
          status: 200,
          headers: { 'content-length': String(config.maxBytes + 1) },
        }),
    )
    const response = await ask('https://example.com/huge.mp4', ORIGIN, fetch)

    expect(response.status).toBe(413)
  })

  it('stops a body that turns out to be too large while streaming', async () => {
    // No content-length, so the ceiling can only be enforced on the way past.
    const fetch = vi.fn<FetchImpl>(async () => new Response('x'.repeat(config.maxBytes + 500)))
    const response = await ask('https://example.com/chunked', ORIGIN, fetch)

    expect(response.status).toBe(200)
    await expect(response.arrayBuffer()).rejects.toThrow()
  })

  it('lets a body exactly at the ceiling through', async () => {
    const fetch = vi.fn<FetchImpl>(async () => new Response('x'.repeat(config.maxBytes)))
    const response = await ask('https://example.com/exact', ORIGIN, fetch)

    expect((await response.arrayBuffer()).byteLength).toBe(config.maxBytes)
  })

  it('reports an upstream that refuses as 502, with its status', async () => {
    const fetch = vi.fn<FetchImpl>(async () => new Response('nope', { status: 404 }))
    const response = await ask('https://example.com/missing.heic', ORIGIN, fetch)

    expect(response.status).toBe(502)
    expect(response.headers.get('x-upstream-status')).toBe('404')
  })

  it('reports an upstream that never answers as 504', async () => {
    const fetch = vi.fn<FetchImpl>(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    })

    expect((await ask('https://example.com/slow', ORIGIN, fetch)).status).toBe(504)
  })

  it('reports an upstream that fails as 502', async () => {
    const fetch = vi.fn<FetchImpl>(async () => {
      throw new Error('ECONNREFUSED')
    })

    expect((await ask('https://example.com/gone', ORIGIN, fetch)).status).toBe(502)
  })
})

describe('what the proxy sends upstream', () => {
  it('sends nothing that identifies the visitor', async () => {
    const fetch = upstream('data')
    await handleRequest(
      new Request('https://proxy.docify.app/fetch?url=https%3A%2F%2Fexample.com%2Fa.heic', {
        headers: {
          ...ORIGIN,
          cookie: 'session=secret',
          authorization: 'Bearer secret',
          'user-agent': 'Mozilla/5.0 (a very specific machine)',
          referer: 'https://docify.app/convert/heic-to-jpg',
        },
      }),
      config,
      fetch,
      { limiter: generous() },
    )

    const sent = new Headers(fetch.mock.calls[0][1]?.headers)

    expect(sent.get('cookie')).toBeNull()
    expect(sent.get('authorization')).toBeNull()
    expect(sent.get('referer')).toBeNull()
    expect(sent.get('user-agent')).toBe('Docify-URL-Import/1.0')
  })

  it('never sends credentials of its own', async () => {
    const fetch = upstream('data')
    await ask('https://example.com/a.heic', ORIGIN, fetch)

    expect(fetch.mock.calls[0][1]?.credentials).toBe('omit')
  })

  it('gives up after the configured timeout', async () => {
    const fetch = upstream('data')
    await ask('https://example.com/a.heic', ORIGIN, fetch)

    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('how a refused URL reaches the caller', () => {
  it.each([
    ['file:///etc/passwd', 'scheme'],
    ['ftp://example.com/a', 'scheme'],
    ['http://localhost/a', 'hostname'],
    ['http://metadata.google.internal/', 'hostname'],
    ['http://169.254.169.254/latest/meta-data/', 'address'],
    ['http://10.0.0.1/a', 'address'],
    ['http://[::1]/a', 'address'],
    ['http://example.com:6379/a', 'port'],
    ['https://victim.example.com@attacker.test/a', 'credentials'],
  ])('answers %s with 400 and never contacts an upstream', async (target, reason) => {
    const fetch = upstream('data')
    const response = await ask(target, ORIGIN, fetch)

    // 400 rather than 502: the URL is the caller's own input, and a 502 would
    // claim this service tried to reach something it deliberately did not.
    expect(response.status).toBe(400)
    expect(response.headers.get('x-proxy-refused')).toBe(reason)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('answers 400 when the guarded fetch refuses a redirect', async () => {
    const fetch = vi.fn<FetchImpl>(async () => {
      throw Object.assign(new Error('refused'), { name: 'RefusedUrlError' })
    })
    const response = await ask('https://example.com/a.heic', ORIGIN, fetch)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-proxy-refused')).toBe('redirect')
  })

  it('answers 400 when a name resolves somewhere it must not', async () => {
    const fetch = vi.fn<FetchImpl>(async () => {
      throw Object.assign(new Error('blocked'), { name: 'BlockedAddressError' })
    })
    const response = await ask('https://rebind.example.com/a.heic', ORIGIN, fetch)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-proxy-refused')).toBe('address')
  })

  it('never follows a redirect on the platform behalf', async () => {
    const fetch = upstream('data')
    await ask('https://example.com/a.heic', ORIGIN, fetch)

    expect(fetch.mock.calls[0][1]?.redirect).toBe('manual')
  })
})

/*
 * What `Origin` was doing on its own, and what now stands beside it (issue #269).
 *
 * A browser sets `Origin` honestly. `curl -H "Origin: https://docify.app"` does
 * not, and anybody who reads `render.yaml` knows what to put there. So the
 * allowlist is a CORS decision that was being asked to do a job CORS cannot do:
 * on its own it left an open 100 MiB-per-request proxy on the owner's Render
 * bandwidth.
 *
 * Two things are added, and only one of them is a defence. The referer check
 * removes the copy-paste `curl` case and nothing harder — a header is a header.
 * The rate limit is what actually bounds the cost, and it is keyed by address
 * rather than by anything the caller writes.
 */

const limiterFor = (limit: number) => createRateLimiter({ limit, windowMs: 60_000 })

/** One request, with a context that would otherwise be `server.ts`'s job to build. */
const askWith = (
  headers: Record<string, string>,
  context: Parameters<typeof handleRequest>[3] = { limiter: generous() },
  fetch = upstream('data'),
) =>
  handleRequest(
    new Request(
      `https://proxy.docify.app/fetch?url=${encodeURIComponent('https://example.com/a.heic')}`,
      { headers },
    ),
    config,
    fetch,
    context,
  )

describe('the referer check', () => {
  it('answers a request with no referer at all', async () => {
    // Privacy settings and `rel="noreferrer"` both strip it, so a missing
    // referer has to stay allowed or the feature breaks for the people most
    // careful about their browsing.
    const response = await askWith(ORIGIN)

    expect(response.status).toBe(200)
  })

  it('answers a request whose referer is on an allowed origin', async () => {
    const response = await askWith({ ...ORIGIN, referer: 'https://docify.app/convert/heic-to-jpg' })

    expect(response.status).toBe(200)
  })

  it('refuses a request whose referer is somewhere else', async () => {
    const response = await askWith({ ...ORIGIN, referer: 'https://evil.test/' })

    expect(response.status).toBe(403)
  })

  it('refuses a referer that only starts like an allowed origin', async () => {
    // `https://docify.app.evil.test/` passes a naive `startsWith` against the
    // origin without its separator, which is the whole trick.
    const response = await askWith({ ...ORIGIN, referer: 'https://docify.app.evil.test/' })

    expect(response.status).toBe(403)
  })
})

describe('the rate limit', () => {
  it('answers inside the allowance and refuses past it', async () => {
    const limiter = limiterFor(2)
    const headers = { ...ORIGIN, 'x-forwarded-for': '203.0.113.7' }

    expect((await askWith(headers, { limiter })).status).toBe(200)
    expect((await askWith(headers, { limiter })).status).toBe(200)

    const refused = await askWith(headers, { limiter })

    expect(refused.status).toBe(429)
    expect(refused.headers.get('retry-after')).toBe('60')
  })

  it('keeps the CORS headers on a refusal, so the page can read the status', async () => {
    const limiter = limiterFor(1)
    const headers = { ...ORIGIN, 'x-forwarded-for': '203.0.113.7' }

    await askWith(headers, { limiter })
    const refused = await askWith(headers, { limiter })

    // Without these the browser reports a network error and the page cannot
    // tell "you are going too fast" from "the service is down".
    expect(refused.headers.get('access-control-allow-origin')).toBe('https://docify.app')
  })

  it('counts callers apart', async () => {
    const limiter = limiterFor(1)

    await askWith({ ...ORIGIN, 'x-forwarded-for': '203.0.113.7' }, { limiter })
    const other = await askWith({ ...ORIGIN, 'x-forwarded-for': '198.51.100.4' }, { limiter })

    expect(other.status).toBe(200)
  })

  it('keys on the hop the platform appended, not the one the caller wrote', async () => {
    const limiter = limiterFor(1)

    // A caller that prepends a fresh value per request mints a fresh key per
    // request and never meets the limiter at all — unless the *last* entry is
    // the one read, which is the only one Render put there.
    await askWith({ ...ORIGIN, 'x-forwarded-for': 'first.of.many, 203.0.113.7' }, { limiter })
    const again = await askWith(
      { ...ORIGIN, 'x-forwarded-for': 'a.different.lie, 203.0.113.7' },
      { limiter },
    )

    expect(again.status).toBe(429)
  })

  it('falls back to the socket address when there is no header', async () => {
    const limiter = limiterFor(1)

    await askWith(ORIGIN, { limiter, remoteAddress: '203.0.113.9' })
    const again = await askWith(ORIGIN, { limiter, remoteAddress: '203.0.113.9' })

    expect(again.status).toBe(429)
  })

  it('does not spend the allowance on a preflight', async () => {
    const limiter = limiterFor(1)

    await handleRequest(
      new Request('https://proxy.docify.app/fetch?url=https%3A%2F%2Fexample.com%2Fa.heic', {
        method: 'OPTIONS',
        headers: ORIGIN,
      }),
      config,
      upstream('data'),
      { limiter },
    )

    // A browser sends one of these before every cross-origin GET. Counting them
    // would halve the allowance for no reason.
    expect((await askWith(ORIGIN, { limiter })).status).toBe(200)
  })

  it('does not spend the allowance on a health check', async () => {
    const limiter = limiterFor(1)

    await handleRequest(new Request('https://proxy.docify.app/healthz'), config, upstream('data'), {
      limiter,
    })

    expect((await askWith(ORIGIN, { limiter })).status).toBe(200)
  })
})

describe('the transfer deadline', () => {
  it('errors a body that never finishes', async () => {
    vi.useFakeTimers()

    try {
      // One chunk, then silence. The socket idle timeout `node:http` was given
      // never fires for this, and before #269 nothing else did either.
      const trickle = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
        },
      })
      const response = await askWith(
        ORIGIN,
        { limiter: generous() },
        vi.fn<FetchImpl>(async () => new Response(trickle)),
      )
      const reading = response.text()

      vi.advanceTimersByTime(config.timeoutMs + 1)

      await expect(reading).rejects.toThrow(/did not finish/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets a body that finishes in time through', async () => {
    vi.useFakeTimers()

    try {
      const response = await askWith(ORIGIN)
      const text = await response.text()

      // And the deadline must not fire afterwards on a controller that has
      // already closed, which would throw somewhere nothing is listening.
      vi.advanceTimersByTime(config.timeoutMs * 2)

      expect(text).toBe('data')
    } finally {
      vi.useRealTimers()
    }
  })
})
