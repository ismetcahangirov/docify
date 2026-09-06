import { describe, expect, it, vi } from 'vitest'

import type { ProxyConfig } from '../../../services/url-proxy/src/config'
import { createGuardedFetch, RefusedUrlError } from '../../../services/url-proxy/src/guarded-fetch'
import {
  BlockedAddressError,
  createSafeLookup,
  type DnsLookup,
  type LookupAddress,
} from '../../../services/url-proxy/src/safe-lookup'

/*
 * The two halves of the SSRF guard that need more than a URL to test
 * (issue #88): the pinned lookup, and the bounded redirect loop.
 *
 * Neither touches a socket here. `performHop` and `dns.lookup` are both
 * parameters, so every assertion is about the decision rather than about the
 * network — which is also the only way a test could assert what happens on a
 * redirect to `169.254.169.254` without being the sort of test that tries it.
 */

const config: ProxyConfig = {
  maxBytes: 1_000_000,
  timeoutMs: 5_000,
  port: 8080,
  allowedOrigins: ['https://docify.app'],
  ratePerMinute: 30,
}

/** A resolver that answers with whatever addresses it is given. */
const resolver = (...addresses: string[]): DnsLookup =>
  vi.fn((_hostname, _options, callback) => {
    callback(
      null,
      addresses.map<LookupAddress>((address) => ({
        address,
        family: address.includes(':') ? 6 : 4,
      })),
    )
  })

/** Runs a lookup and settles with what it handed back. */
function resolve(lookup: ReturnType<typeof createSafeLookup>, hostname = 'example.com') {
  return new Promise<{ error: Error | null; addresses: unknown }>((settle) => {
    lookup(hostname, {}, (error, addresses) => settle({ error, addresses }))
  })
}

describe('the pinned lookup', () => {
  it('hands back a public address', async () => {
    const { error, addresses } = await resolve(createSafeLookup(resolver('93.184.216.34')))

    expect(error).toBeNull()
    expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }])
  })

  it('refuses a name that resolves inside', async () => {
    const { error } = await resolve(createSafeLookup(resolver('169.254.169.254')))

    // This is the rebinding case. The name looked fine to `checkUrl`; the
    // answer did not, and the answer is what the socket would have used.
    expect(error).toBeInstanceOf(BlockedAddressError)
  })

  it('refuses a name that resolves to one public address and one private one', async () => {
    const { error } = await resolve(createSafeLookup(resolver('93.184.216.34', '10.0.0.5')))

    // A first-answer check passes this. The client is free to pick the second
    // on a retry, so a host that is partly inside is inside.
    expect(error).toBeInstanceOf(BlockedAddressError)
  })

  it('refuses a name that resolves to nothing', async () => {
    const { error } = await resolve(createSafeLookup(resolver()))

    expect(error).toBeInstanceOf(BlockedAddressError)
  })

  it('passes a resolver error straight through', async () => {
    const failing: DnsLookup = (_hostname, _options, callback) => {
      callback(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }), [])
    }

    const { error } = await resolve(createSafeLookup(failing))

    expect(error).toMatchObject({ code: 'ENOTFOUND' })
    expect(error).not.toBeInstanceOf(BlockedAddressError)
  })

  it('asks for every answer, and does not reorder them', async () => {
    const lookup = resolver('93.184.216.34')
    await resolve(createSafeLookup(lookup))

    expect(lookup).toHaveBeenCalledWith(
      'example.com',
      { all: true, verbatim: true },
      expect.any(Function),
    )
  })
})

/** A hop that answers 200 with no body. */
const answers = () =>
  vi.fn(async () => ({ status: 200, headers: new Headers(), body: null, location: null }))

/** A hop that redirects to `to`, once, then answers. */
function redirectsTo(...targets: string[]) {
  let hop = 0

  return vi.fn(async () => {
    const target = targets[hop]
    hop += 1

    return target === undefined
      ? { status: 200, headers: new Headers(), body: null, location: null }
      : { status: 302, headers: new Headers(), body: null, location: new URL(target) }
  })
}

const guarded = (perform: ReturnType<typeof answers>) =>
  createGuardedFetch(config, { lookup: () => {}, perform: perform as never })

describe('the redirect loop', () => {
  it('fetches a URL that needs no redirect', async () => {
    const perform = answers()
    const response = await guarded(perform)('https://example.com/a.heic')

    expect(response.status).toBe(200)
    expect(perform).toHaveBeenCalledTimes(1)
  })

  it('follows a redirect', async () => {
    const perform = redirectsTo('https://cdn.example.com/a.heic')
    const response = await guarded(perform as never)('https://example.com/a.heic')

    expect(response.status).toBe(200)
    expect(perform).toHaveBeenCalledTimes(2)
  })

  it('gives up after three hops rather than following a loop', async () => {
    const perform = redirectsTo(
      'https://a.example.com/',
      'https://b.example.com/',
      'https://c.example.com/',
      'https://d.example.com/',
      'https://e.example.com/',
    )

    await expect(guarded(perform as never)('https://example.com/a.heic')).rejects.toThrow(
      /too many redirects/,
    )
  })

  it('checks every hop, not only the first', async () => {
    const perform = redirectsTo('http://169.254.169.254/latest/meta-data/')

    // The bypass this closes: the URL the caller supplied was unimpeachable,
    // and the URL the connection would have gone to was the metadata endpoint.
    await expect(guarded(perform as never)('https://example.com/a.heic')).rejects.toBeInstanceOf(
      RefusedUrlError,
    )
    expect(perform).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['file:///etc/passwd', 'scheme'],
    ['http://localhost/', 'hostname'],
    ['http://example.com:6379/', 'port'],
    ['http://10.0.0.1/', 'address'],
  ])('refuses a redirect to %s', async (target) => {
    const perform = redirectsTo(target)

    await expect(guarded(perform as never)('https://example.com/a.heic')).rejects.toBeInstanceOf(
      RefusedUrlError,
    )
  })

  it('refuses the first URL too', async () => {
    const perform = answers()

    await expect(guarded(perform)('http://169.254.169.254/')).rejects.toBeInstanceOf(
      RefusedUrlError,
    )
    expect(perform).not.toHaveBeenCalled()
  })
})

/*
 * The abort signal (issue #269).
 *
 * `proxy.ts` has always passed `signal: AbortSignal.timeout(config.timeoutMs)`
 * into this fetch, and this fetch has always ignored it. The `timeout` handed
 * to `node:http` is a *socket idle* timeout, not a deadline: an upstream that
 * sends one byte every 29 seconds keeps a connection open for hours, and on a
 * free instance a handful of those is the whole service.
 *
 * The signal is checked before a hop and honoured during one, so a redirect
 * chain cannot outlive the deadline either.
 */

/** A `node:http`-shaped request that never answers, and remembers being destroyed. */
function silentSend() {
  const listeners = new Map<string, (reason?: unknown) => void>()
  let destroyedWith: unknown = null

  const outgoing = {
    on(event: string, listener: (reason?: unknown) => void) {
      listeners.set(event, listener)

      return outgoing
    },
    end() {},
    destroy(reason?: unknown) {
      destroyedWith = reason ?? null
      listeners.get('error')?.(reason)
    },
  }

  const send = vi.fn(() => outgoing)

  return { send, destroyed: () => destroyedWith }
}

/** A signal that is already aborted, with the name a timeout would carry. */
function timedOut(): AbortSignal {
  const controller = new AbortController()
  controller.abort(Object.assign(new Error('the deadline passed'), { name: 'TimeoutError' }))

  return controller.signal
}

describe('the abort signal', () => {
  it('refuses before the first hop when the signal has already fired', async () => {
    const perform = answers()

    await expect(
      guarded(perform)('https://example.com/a.heic', { signal: timedOut() }),
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(perform).not.toHaveBeenCalled()
  })

  it('checks the signal again between hops, not only at the start', async () => {
    const controller = new AbortController()
    const perform = vi.fn(async () => {
      // Aborted while the first hop was in flight, which is the case a check at
      // the start alone would sail straight past.
      controller.abort(Object.assign(new Error('the deadline passed'), { name: 'TimeoutError' }))

      return {
        status: 302,
        headers: new Headers(),
        body: null,
        location: new URL('https://cdn.example.com/a.heic'),
      }
    })

    await expect(
      guarded(perform as never)('https://example.com/a.heic', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(perform).toHaveBeenCalledTimes(1)
  })

  it('hands the signal down to the hop', async () => {
    const perform = answers()
    const signal = new AbortController().signal

    await guarded(perform)('https://example.com/a.heic', { signal })

    expect(perform).toHaveBeenCalledWith(expect.objectContaining({ signal }))
  })

  it('destroys the socket when the signal fires mid-hop', async () => {
    const { send, destroyed } = silentSend()
    const controller = new AbortController()
    const fetchImpl = createGuardedFetch(config, { lookup: () => {}, send: send as never })

    const pending = fetchImpl('https://example.com/a.heic', { signal: controller.signal })
    controller.abort(Object.assign(new Error('the deadline passed'), { name: 'TimeoutError' }))

    // Destroying is the whole point: without it the socket stays open and the
    // rejection only frees the promise, not the connection.
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(destroyed()).toMatchObject({ name: 'TimeoutError' })
  })

  it('leaves a hop alone when no signal was given', async () => {
    const perform = answers()

    await expect(guarded(perform)('https://example.com/a.heic')).resolves.toMatchObject({
      status: 200,
    })
  })
})
