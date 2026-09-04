import { describe, expect, it, vi } from 'vitest'

import type { ProxyConfig } from '../../../services/url-proxy/src/config'
import { type FetchImpl, handleRequest } from '../../../services/url-proxy/src/proxy'

/*
 * The URL import proxy (issue #87).
 *
 * `fetch` is a parameter rather than a global, for the reason CLAUDE.md §5.1
 * gives about `Capabilities`: every assertion below is about what the proxy
 * does with an upstream answer, and none of them should need one.
 *
 * The security half — private address ranges, DNS rebinding, redirect bounds —
 * is issue #88 and is asserted in `ssrf.test.ts` beside this. What is here is
 * the shape of the service: it streams, it never stores, it stops at a
 * ceiling, and it answers only the origins it was told about.
 */

const config: ProxyConfig = {
  maxBytes: 1_000,
  timeoutMs: 5_000,
  port: 8080,
  allowedOrigins: ['https://docify.app'],
}

const ORIGIN = { origin: 'https://docify.app' }

/** An upstream that answers with `body` and whatever headers are asked for. */
const upstream = (body: BodyInit | null, init: ResponseInit = {}) =>
  vi.fn<FetchImpl>(async () => new Response(body, { status: 200, ...init }))

const ask = (target: string, headers: Record<string, string> = ORIGIN, fetch = upstream('data')) =>
  handleRequest(
    new Request(`https://proxy.docify.app/fetch?url=${encodeURIComponent(target)}`, { headers }),
    config,
    fetch,
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
