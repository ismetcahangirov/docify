import { isPrivateAddress } from './ip-ranges.js'

/**
 * Everything about a URL that can be refused before a socket is opened
 * (issue #88).
 *
 * This is the first of two checks and it is not the important one. A hostname
 * says nothing about where it resolves, so the check that actually holds is in
 * `safe-lookup.ts`, at connection time, on the address the socket will use.
 * What is decidable here is the *shape* — and each of the four things it
 * decides is a real bypass, not a formality.
 *
 * ## Scheme
 *
 * `file:///etc/passwd` is the reason. Anything that is not `http:` or `https:`
 * is refused rather than enumerated, because the interesting scheme is always
 * the one nobody put on the list.
 *
 * ## Port
 *
 * 80 and 443 only. A file at a URL lives on one of those; `:6379` and `:11211`
 * are Redis and memcached, which speak protocols forgiving enough to be driven
 * by a carefully shaped HTTP request. Refusing every other port costs a rare
 * CDN on `:8443` and removes a whole category.
 *
 * ## Credentials
 *
 * `https://expected.com@attacker.test/` reads as `expected.com` to a person and
 * resolves as `attacker.test` to everything else. Nothing legitimate needs
 * them here — the proxy sends no credentials of its own either.
 *
 * ## Names that mean "inside"
 *
 * `localhost`, `.local`, `.internal`, `.home.arpa` and
 * `metadata.google.internal` are refused by name as well as by address. The
 * address check would catch most of them, and defence in depth is cheap when
 * the list is this short.
 */

export type RefusalReason = 'scheme' | 'port' | 'credentials' | 'hostname' | 'address'

export type UrlVerdict = { allowed: true } | { allowed: false; reason: RefusalReason }

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

/** Everything else is refused; see the header. */
const ALLOWED_PORTS = new Set(['', '80', '443'])

/** Exact names, and suffixes, that never point outward. */
const RESERVED_NAMES = new Set(['localhost', 'metadata.google.internal'])
const RESERVED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa']

const ALLOWED: UrlVerdict = { allowed: true }

const refuse = (reason: RefusalReason): UrlVerdict => ({ allowed: false, reason })

/**
 * The hostname with an IPv6 literal's brackets removed.
 *
 * `URL` keeps them, and `isPrivateAddress` parses addresses rather than URL
 * authorities, so this is where the two meet.
 */
function bareHostname(url: URL): string {
  const host = url.hostname.toLowerCase()

  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/** Whether a hostname is written as an address rather than as a name. */
function looksLikeAddress(host: string): boolean {
  return /^[0-9.]+$/.test(host) || host.includes(':')
}

/** Whether `url` may be fetched at all, and why not when it may not. */
export function checkUrl(url: URL): UrlVerdict {
  if (!ALLOWED_SCHEMES.has(url.protocol)) return refuse('scheme')
  if (!ALLOWED_PORTS.has(url.port)) return refuse('port')
  if (url.username.length > 0 || url.password.length > 0) return refuse('credentials')

  const host = bareHostname(url)
  if (host.length === 0) return refuse('hostname')

  if (RESERVED_NAMES.has(host)) return refuse('hostname')
  if (RESERVED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return refuse('hostname')

  // A literal address can be judged now; a name has to wait for `safe-lookup`.
  if (looksLikeAddress(host) && isPrivateAddress(host)) return refuse('address')

  return ALLOWED
}
