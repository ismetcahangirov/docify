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
