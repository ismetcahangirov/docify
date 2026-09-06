import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { importFromUrl, isUrlImportConfigured, PROXY_UNCONFIGURED } from '@/lib/import/url'

/*
 * Importing a file the visitor named by URL (issue #270).
 *
 * ## What this does not contradict
 *
 * CLAUDE.md §2.1 says no file content ever reaches a server, and it still
 * holds. Nothing here reads a local file: the only thing that leaves the tab is
 * a URL the visitor typed, and it goes to `services/url-proxy` because a
 * browser cannot fetch an arbitrary URL itself — almost no origin says yes
 * through CORS. The bytes come back and are converted in the tab like every
 * other file.
 *
 * ## Why `fetch` is a parameter
 *
 * The reason CLAUDE.md §5.1 gives about `Capabilities`. Every assertion below
 * is about what the caller is told, and none of them should need a network or a
 * running proxy to make it.
 */

const PROXY = 'https://proxy.docify.test'

/** A proxy answer, with the headers the real one sends. */
const answer = (body: BodyInit | null, init: ResponseInit = {}) =>
  vi.fn(async () => new Response(body, { status: 200, ...init }))

const refusal = (status: number, headers: Record<string, string> = {}) =>
  vi.fn(async () => new Response(null, { status, headers }))

beforeEach(() => {
  process.env.NEXT_PUBLIC_PROXY_URL = PROXY
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_PROXY_URL
})

describe('isUrlImportConfigured', () => {
  it('is false when no proxy is deployed', () => {
    delete process.env.NEXT_PUBLIC_PROXY_URL

    expect(isUrlImportConfigured()).toBe(false)
  })

  it('is false for an endpoint that is only whitespace', () => {
    // A variable declared in the dashboard and left blank reads as set.
    process.env.NEXT_PUBLIC_PROXY_URL = '   '

    expect(isUrlImportConfigured()).toBe(false)
  })

  it('is true once an endpoint is configured', () => {
    expect(isUrlImportConfigured()).toBe(true)
  })
})

describe('importFromUrl', () => {
  it('asks the proxy for the URL, encoded', async () => {
    const fetch = answer('bytes')
    const target = 'https://example.com/a.heic?size=full&v=2'

    await importFromUrl(target, { fetch })

    // Encoded whole, so the visitor's own `&` cannot end the proxy's `url`
    // parameter and start a second one.
    expect(fetch).toHaveBeenCalledWith(
      `${PROXY}/fetch?url=${encodeURIComponent(target)}`,
      expect.anything(),
    )
  })

  it('normalises the URL before sending it', async () => {
    const fetch = answer('bytes')

    await importFromUrl('https://example.com/a b.heic', { fetch })

    // `new URL` percent-encodes the space, and the proxy parses what it is
    // given — sending the raw text would make the two disagree about the path.
    expect(fetch).toHaveBeenCalledWith(
      `${PROXY}/fetch?url=${encodeURIComponent('https://example.com/a%20b.heic')}`,
      expect.anything(),
    )
  })

  it('trims a trailing slash off the endpoint rather than sending a double one', async () => {
    process.env.NEXT_PUBLIC_PROXY_URL = `${PROXY}/`
    const fetch = answer('bytes')

    await importFromUrl('https://example.com/a.heic', { fetch })

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`${PROXY}/fetch?`),
      expect.anything(),
    )
  })

  it('names the file from the content disposition the proxy sent', async () => {
    const fetch = answer('bytes', {
      headers: {
        'content-disposition': 'attachment; filename="holiday.heic"',
        'content-type': 'image/heic',
      },
    })

    const file = await importFromUrl('https://example.com/x', { fetch })

    expect(file.name).toBe('holiday.heic')
    expect(file.type).toBe('image/heic')
    expect(await file.text()).toBe('bytes')
  })

  it('keeps the bytes, rather than a description of them', async () => {
    // `new File([blob], …)` stringifies the blob on some Node versions and
    // reads it on others: the file arrived containing "[object Blob]" in CI
    // while this suite was green on the dev machine.
    const fetch = answer(new Uint8Array([1, 2, 3, 4]))

    const file = await importFromUrl('https://example.com/x', { fetch })

    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(file.size).toBe(4)
  })

  it('falls back to an opaque type when the proxy declared none', async () => {
    const file = await importFromUrl('https://example.com/x', {
      fetch: answer(new Uint8Array([1, 2, 3])),
    })

    // Never a guess. These bytes are about to be handed to a conversion engine.
    expect(file.type).toBe('application/octet-stream')
  })

  it('falls back to a generic name when the proxy sent no disposition', async () => {
    const file = await importFromUrl('https://example.com/x', { fetch: answer('bytes') })

    expect(file.name).toBe('download')
  })

  it('ignores a disposition that names a path', async () => {
    // The proxy already strips separators, but a name that arrives with one
    // anyway must not become a path here either.
    const fetch = answer('bytes', {
      headers: { 'content-disposition': 'attachment; filename="../../etc/passwd"' },
    })

    const file = await importFromUrl('https://example.com/x', { fetch })

    expect(file.name).toBe('passwd')
  })

  it('refuses before fetching anything when no proxy is deployed', async () => {
    delete process.env.NEXT_PUBLIC_PROXY_URL
    const fetch = answer('bytes')

    await expect(importFromUrl('https://example.com/x', { fetch })).rejects.toThrow(
      PROXY_UNCONFIGURED,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('says what the guard refused, in the guard’s own words', async () => {
    const fetch = refusal(400, { 'x-proxy-refused': 'address' })

    // The reason is only ever a fact about the URL the visitor typed, which is
    // why it is safe to repeat and why repeating it is the useful thing to do.
    await expect(importFromUrl('http://10.0.0.1/x', { fetch })).rejects.toThrow(
      /This URL cannot be fetched: address/,
    )
  })

  it.each([
    [413, /larger than/i],
    [429, /too many|again in a minute/i],
    [502, /could not be reached/i],
    [504, /did not answer in time/i],
  ])('explains a %i rather than repeating the number', async (status, expected) => {
    await expect(
      importFromUrl('https://example.com/x', { fetch: refusal(status) }),
    ).rejects.toThrow(expected)
  })

  it('explains a status nobody planned for', async () => {
    await expect(importFromUrl('https://example.com/x', { fetch: refusal(418) })).rejects.toThrow(
      /could not be fetched/i,
    )
  })

  it('explains a proxy that is not there at all', async () => {
    // A sleeping free Render instance, a wrong endpoint, or no network: `fetch`
    // rejects and the browser's own message is "Failed to fetch".
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(importFromUrl('https://example.com/x', { fetch })).rejects.toThrow(
      /could not be reached/i,
    )
  })

  it('passes the signal down and lets a cancellation through unchanged', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      controller.abort()
      init?.signal?.throwIfAborted()

      return new Response('bytes')
    })

    // Matched by name, never by type — see lib/abort.ts.
    await expect(
      importFromUrl('https://example.com/x', { fetch, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses a URL the proxy would refuse anyway, without asking', async () => {
    const fetch = answer('bytes')

    // One round trip to a sleeping free instance costs about a minute. A URL
    // that is not http(s) can be turned down here for nothing.
    await expect(importFromUrl('file:///etc/passwd', { fetch })).rejects.toThrow(/http/i)
    await expect(importFromUrl('not a url at all', { fetch })).rejects.toThrow(/valid/i)
    expect(fetch).not.toHaveBeenCalled()
  })
})
