import { lookup as dnsLookup } from 'node:dns'
import type { LookupFunction } from 'node:net'

import { isPrivateAddress } from './ip-ranges.js'

/**
 * The check that actually holds, and the reason it lives in a `lookup`
 * callback rather than anywhere more obvious (issue #88).
 *
 * ## Why checking the hostname is not enough
 *
 * `checkUrl` can refuse `http://127.0.0.1/`. It cannot refuse
 * `http://rebind.attacker.test/`, because a hostname says nothing about where
 * it resolves — and the attacker owns the DNS. The name is what the guard sees;
 * the address is what the socket uses.
 *
 * ## Why resolving and then fetching is not enough either
 *
 * The obvious fix is to resolve the name, check the answer, and then fetch. It
 * does not work: between the check and the connection the attacker's DNS
 * answers again, this time with `169.254.169.254`, and the socket goes there.
 * That is DNS rebinding, and a resolve-then-fetch guard is its textbook victim.
 * A short TTL is all it takes.
 *
 * ## What closes it
 *
 * Node's HTTP client takes a `lookup` function and connects to **exactly the
 * address that function returns**. So the resolution and the decision are the
 * same event: this module resolves, refuses if any answer is private, and hands
 * back the vetted address. There is no window between them because there is no
 * second resolution.
 *
 * Every answer is checked, not the first. A name that resolves to one public
 * address and one private one is refused outright — `all: true` is what makes
 * that visible, and a round-robin that returned the private answer second is
 * exactly the case a first-answer check would miss.
 *
 * `dns.lookup` is injectable so the whole thing can be asserted without a
 * resolver, for the reason CLAUDE.md §5.1 gives about `Capabilities`.
 */

/** The shape `node:net` hands a custom lookup, reduced to what is used here. */
export interface LookupAddress {
  address: string
  family: number
}

export type DnsLookup = (
  hostname: string,
  options: { all: true; verbatim?: boolean },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void

/**
 * What `node:http` expects in `options.lookup`.
 *
 * Node's own type, aliased rather than restated: a hand-written version is
 * structurally close enough to look right and different enough that `tsc`
 * refuses it at the one call site that matters.
 */
export type NetLookup = LookupFunction

/** Thrown for a name that resolves anywhere it should not. */
export class BlockedAddressError extends Error {
  constructor(readonly hostname: string) {
    super(`${hostname} resolves to an address this service will not connect to.`)
    this.name = 'BlockedAddressError'
  }
}

/**
 * A `lookup` that refuses to hand back an address inside the network.
 *
 * Returns every vetted answer, in order, so the client keeps its own retry
 * behaviour across a multi-homed name.
 */
export function createSafeLookup(lookup: DnsLookup = dnsLookup as DnsLookup): NetLookup {
  return (hostname, _options, callback) => {
    // `verbatim` keeps the resolver's own ordering rather than re-sorting IPv4
    // ahead of IPv6. Every answer is checked, so the order is not load-bearing
    // for safety — but reordering would change which address is used, and this
    // module should not be making that decision.
    lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error !== null) {
        callback(error, [])

        return
      }

      if (addresses.length === 0) {
        callback(new BlockedAddressError(hostname), [])

        return
      }

      // One private answer refuses the name. A host that is partly inside is
      // inside: the client would be free to pick the private one on a retry.
      if (addresses.some((entry) => isPrivateAddress(entry.address))) {
        callback(new BlockedAddressError(hostname), [])

        return
      }

      callback(null, addresses)
    })
  }
}
