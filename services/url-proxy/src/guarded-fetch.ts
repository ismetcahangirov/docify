import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'

import type { ProxyConfig } from './config.js'
import type { FetchImpl } from './proxy.js'
import { createSafeLookup, type NetLookup } from './safe-lookup.js'
import { checkUrl } from './url-guard.js'

/**
 * The fetch the proxy is given, with the guard attached (issue #88).
 *
 * ## Why this is not the global `fetch`
 *
 * Because the global one cannot be told where to connect. Closing DNS rebinding
 * needs the resolution and the connection to be the same event — see
 * `safe-lookup.ts` — and that means a `lookup` function, which `node:http`
 * accepts and `fetch` does not. Node exposes no supported way to hand `fetch` a
 * dispatcher, so the choice is a dependency (undici) or eighty lines of
 * `node:http`. This is the eighty lines: the service has no dependencies, and
 * the one component that will be handed arbitrary URLs is the last place to
 * want a supply chain.
 *
 * It answers with a `Response`, so `proxy.ts` never learns any of this.
 *
 * ## Redirects are followed here, and bounded
 *
 * Every hop is a new URL from a stranger, so every hop goes through `checkUrl`
 * and through the pinned lookup again. A redirect to `file:///etc/passwd`, to
 * `http://169.254.169.254/`, or to a name that resolves inside is refused at
 * the hop rather than at the first request — which is the bypass that exists
 * precisely because the first URL looked fine.
 *
 * Three hops. Enough for the `http -> https` and bare-domain redirects real
 * files sit behind, few enough that a redirect loop is not a way to hold an
 * instance open.
 *
 * ## The deadline is honoured here or nowhere
 *
 * `proxy.ts` has always passed `signal: AbortSignal.timeout(...)`, and until
 * issue #269 this file ignored it. The `timeout` handed to `node:http` is a
 * *socket idle* timeout: an upstream that sends one byte every 29 seconds
 * renews it forever. So the signal is checked before every hop and listened to
 * during one, and when it fires the socket is destroyed rather than merely
 * abandoned — a rejected promise frees the caller, not the connection.
 *
 * ## Nothing is buffered
 *
 * The `IncomingMessage` is a `Readable` and goes out as a web stream without
 * being collected, so `proxy.ts` can pipe it through the size limiter exactly
 * as it does now.
 */

/** Enough for http -> https and a bare-domain hop; short enough to bound a loop. */
const MAX_REDIRECTS = 3

/** Thrown for a URL that the guard refuses, at the first hop or a later one. */
export class RefusedUrlError extends Error {
  constructor(readonly reason: string) {
    super(`This URL cannot be fetched: ${reason}.`)
    this.name = 'RefusedUrlError'
  }
}

/** `node:http`'s `request`, injectable so the abort path can be tested without a socket. */
export type Send = typeof httpRequest

interface HopOptions {
  url: URL
  timeoutMs: number
  lookup: NetLookup
  userAgent: string
  /** The deadline for the whole fetch, if the caller set one. */
  signal?: AbortSignal
  send?: Send
}

interface Hop {
  status: number
  headers: Headers
  /** `null` for a response with no body, which a redirect usually has. */
  body: ReadableStream<Uint8Array> | null
  /** Where a 3xx points, already resolved against the request URL. */
  location: URL | null
}

/** The error a fired deadline should surface as, so `proxy.ts` answers 504 and not 502. */
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason

  if (reason instanceof Error) return reason

  return Object.assign(new Error('the request was abandoned'), { name: 'TimeoutError' })
}

/** One request, with the connection pinned to a vetted address. */
function performHop({ url, timeoutMs, lookup, userAgent, signal, send }: HopOptions): Promise<Hop> {
  let answered: { destroy(reason?: Error): void } | undefined
  let removeAbortListener = () => {}

  return new Promise<Hop>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortReason(signal))

      return
    }

    const request = send ?? (url.protocol === 'https:' ? httpsRequest : httpRequest)

    const outgoing = request(
      url,
      {
        method: 'GET',
        // Nothing of the visitor's. See the header of `proxy.ts`.
        headers: { 'user-agent': userAgent, accept: '*/*', host: url.host },
        lookup,
        timeout: timeoutMs,
      },
      (incoming) => {
        // From here the deadline belongs to the body, and destroying the
        // request object no longer stops anything arriving on the socket.
        answered = incoming
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue
          for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one)
        }

        const status = incoming.statusCode ?? 502
        const raw = headers.get('location')
        const redirect = status >= 300 && status < 400 && raw !== null

        if (redirect) {
          // The body of a redirect is never wanted, and leaving it unread keeps
          // the socket open until the timeout.
          incoming.resume()

          let location: URL
          try {
            location = new URL(raw, url)
          } catch {
            reject(new RefusedUrlError('the redirect target is not a URL'))

            return
          }

          resolve({ status, headers, body: null, location })

          return
        }

        resolve({
          status,
          headers,
          body: Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>,
          location: null,
        })
      },
    )

    outgoing.on('timeout', () => {
      outgoing.destroy(
        Object.assign(new Error('the upstream did not answer'), { name: 'TimeoutError' }),
      )
    })
    outgoing.on('error', reject)

    if (signal !== undefined) {
      const abandon = () => {
        const reason = abortReason(signal)
        // `destroy` on the request emits `error`, which rejects; rejecting here
        // as well is harmless and covers a `send` that does not.
        outgoing.destroy(reason)
        answered?.destroy(reason)
        reject(reason)
      }

      signal.addEventListener('abort', abandon, { once: true })
      removeAbortListener = () => signal.removeEventListener('abort', abandon)
    }

    outgoing.end()
    // One deadline outlives three hops, so a listener left behind on each is a
    // leak on the signal for as long as the fetch runs.
  }).finally(() => removeAbortListener())
}

/**
 * A `fetch` that refuses to leave the public internet.
 *
 * `lookup` and `perform` are parameters so the redirect loop can be driven
 * without a resolver or a socket.
 */
export function createGuardedFetch(
  config: ProxyConfig,
  options: { lookup?: NetLookup; perform?: typeof performHop; send?: Send } = {},
): FetchImpl {
  const lookup = options.lookup ?? createSafeLookup()
  const perform = options.perform ?? performHop

  return async (target, init) => {
    const userAgent = new Headers(init?.headers).get('user-agent') ?? 'Docify-URL-Import/1.0'
    const signal = init?.signal ?? undefined
    let url = new URL(target)

    for (let hops = 0; hops <= MAX_REDIRECTS; hops += 1) {
      // Before every hop, not only the first: a deadline that passed while the
      // last one was in flight must stop the chain rather than start a request
      // it has already outlived.
      if (signal?.aborted === true) throw abortReason(signal)

      // Re-checked every hop, including the first. A redirect is a URL from a
      // stranger exactly as much as the original was.
      const verdict = checkUrl(url)
      if (!verdict.allowed) throw new RefusedUrlError(verdict.reason)

      const hop = await perform({
        url,
        timeoutMs: config.timeoutMs,
        lookup,
        userAgent,
        signal,
        send: options.send,
      })

      if (hop.location === null) {
        return new Response(hop.body, { status: hop.status, headers: hop.headers })
      }

      url = hop.location
    }

    throw new RefusedUrlError('too many redirects')
  }
}
