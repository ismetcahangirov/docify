/**
 * Which addresses the proxy must never connect to (issue #88).
 *
 * A URL import proxy is a request forgery primitive with a friendly name: it
 * takes a URL from a stranger and fetches it from inside a hosting provider's
 * network. The whole difference between that and a service is this table.
 *
 * ## Why it is a table and not three conditions
 *
 * The entries that matter are the ones nobody writes from memory.
 * `169.254.169.254` is the cloud metadata endpoint, and reaching it is how a
 * proxy hands out its own instance credentials. `0.0.0.0` routes to localhost
 * on Linux. `100.64.0.0/10` is carrier-grade NAT and is somebody's LAN.
 * `::ffff:127.0.0.1` is loopback spelled as IPv6. A guard that blocks the three
 * obvious RFC 1918 ranges and stops there is a guard that has not been written.
 *
 * ## Unparseable means blocked
 *
 * Anything this module cannot parse into an address it recognises is refused.
 * An address it cannot read is an address it cannot vouch for, and the
 * alternative — allowing what it does not understand — is the standard way
 * these guards are bypassed.
 */

/** IPv4 ranges, as [first, last] pairs of 32-bit integers. */
const IPV4_BLOCKED: ReadonlyArray<readonly [string, string, string]> = [
  ['0.0.0.0', '0.255.255.255', 'this host — routes to localhost on Linux'],
  ['10.0.0.0', '10.255.255.255', 'private'],
  ['100.64.0.0', '100.127.255.255', 'carrier-grade NAT'],
  ['127.0.0.0', '127.255.255.255', 'loopback'],
  ['169.254.0.0', '169.254.255.255', 'link-local, including cloud metadata'],
  ['172.16.0.0', '172.31.255.255', 'private'],
  ['192.0.0.0', '192.0.0.255', 'IETF protocol assignments'],
  ['192.0.2.0', '192.0.2.255', 'TEST-NET-1'],
  ['192.88.99.0', '192.88.99.255', '6to4 relay anycast'],
  ['192.168.0.0', '192.168.255.255', 'private'],
  ['198.18.0.0', '198.19.255.255', 'benchmarking'],
  ['198.51.100.0', '198.51.100.255', 'TEST-NET-2'],
  ['203.0.113.0', '203.0.113.255', 'TEST-NET-3'],
  ['224.0.0.0', '239.255.255.255', 'multicast'],
  ['240.0.0.0', '255.255.255.255', 'reserved, and the broadcast address'],
]

/** IPv6 prefixes, as [prefix in expanded hextets, prefix length in bits]. */
const IPV6_BLOCKED: ReadonlyArray<readonly [string, number, string]> = [
  ['::', 128, 'unspecified'],
  ['::1', 128, 'loopback'],
  ['100::', 64, 'discard-only'],
  ['2001:db8::', 32, 'documentation'],
  ['fc00::', 7, 'unique local'],
  ['fe80::', 10, 'link-local'],
  ['ff00::', 8, 'multicast'],
]

/** Strictly dotted-quad. No octal, no hex, no shorthand — those are bypasses. */
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** `1.2.3.4` as a 32-bit number, or `null` when it is not that. */
function toIpv4(value: string): number | null {
  const match = IPV4.exec(value)
  if (match === null) return null

  let result = 0
  for (const part of match.slice(1)) {
    // A leading zero is how `010.0.0.1` becomes `8.0.0.1` in one parser and
    // `10.0.0.1` in another. Refuse the ambiguity rather than pick a side.
    if (part.length > 1 && part.startsWith('0')) return null

    const octet = Number(part)
    if (octet > 255) return null

    result = result * 256 + octet
  }

  return result
}

/** The sixteen bytes of an IPv6 address, or `null`. */
function toIpv6(value: string): Uint8Array | null {
  const scoped = value.split('%')[0] ?? value
  const halves = scoped.split('::')
  if (halves.length > 2) return null

  /** One side of the `::`, as bytes; an embedded IPv4 tail counts as four. */
  const sideOf = (side: string): number[] | null => {
    if (side.length === 0) return []

    const bytes: number[] = []
    const parts = side.split(':')

    for (const [index, part] of parts.entries()) {
      if (part.includes('.')) {
        // `::ffff:127.0.0.1` and `64:ff9b::8.8.8.8`: only legal last.
        if (index !== parts.length - 1) return null

        const embedded = toIpv4(part)
        if (embedded === null) return null

        bytes.push(
          (embedded >>> 24) & 255,
          (embedded >>> 16) & 255,
          (embedded >>> 8) & 255,
          embedded & 255,
        )
        continue
      }

      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null

      const hextet = Number.parseInt(part, 16)
      bytes.push(hextet >>> 8, hextet & 255)
    }

    return bytes
  }

  const head = sideOf(halves[0] ?? '')
  const tail = halves.length === 2 ? sideOf(halves[1] ?? '') : []
  if (head === null || tail === null) return null

  const gap = 16 - head.length - tail.length
  if (halves.length === 2 ? gap < 0 : gap !== 0) return null

  return new Uint8Array([...head, ...new Array<number>(gap).fill(0), ...tail])
}

/** Whether `bytes` starts with `prefix`'s first `bits` bits. */
function hasPrefix(bytes: Uint8Array, prefix: Uint8Array, bits: number): boolean {
  const whole = bits >> 3
  for (let i = 0; i < whole; i += 1) if (bytes[i] !== prefix[i]) return false

  const rest = bits & 7
  if (rest === 0) return true

  const mask = (0xff << (8 - rest)) & 0xff

  return ((bytes[whole] ?? 0) & mask) === ((prefix[whole] ?? 0) & mask)
}

/** The IPv4 address an IPv6 one carries, for the two prefixes that carry one. */
function embeddedIpv4(bytes: Uint8Array): Uint8Array | null {
  const IPV4_MAPPED = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff])
  const NAT64 = new Uint8Array([0, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0])

  const mapped = IPV4_MAPPED.every((byte, index) => bytes[index] === byte)
  const nat64 = NAT64.every((byte, index) => bytes[index] === byte)

  return mapped || nat64 ? bytes.slice(12) : null
}

/**
 * Whether connecting to `address` would leave the public internet.
 *
 * `true` also for anything unparseable — see the header.
 */
export function isPrivateAddress(address: string): boolean {
  const ipv4 = toIpv4(address)

  if (ipv4 !== null) {
    return IPV4_BLOCKED.some(([first, last]) => {
      const low = toIpv4(first)
      const high = toIpv4(last)

      return low !== null && high !== null && ipv4 >= low && ipv4 <= high
    })
  }

  const ipv6 = toIpv6(address)
  if (ipv6 === null) return true

  // An IPv4 address wearing an IPv6 hat is still an IPv4 address, and
  // `::ffff:169.254.169.254` reaches exactly what `169.254.169.254` reaches.
  const embedded = embeddedIpv4(ipv6)
  if (embedded !== null) return isPrivateAddress(embedded.join('.'))

  return IPV6_BLOCKED.some(([prefix, bits]) => {
    const parsed = toIpv6(prefix)

    return parsed !== null && hasPrefix(ipv6, parsed, bits)
  })
}
