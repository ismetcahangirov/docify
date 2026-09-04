import { describe, expect, it } from 'vitest'

import { isPrivateAddress } from '../../../services/url-proxy/src/ip-ranges'

/*
 * The address ranges the proxy must never reach (issue #88).
 *
 * This is the table an SSRF guard is actually made of, and the reason it is a
 * table rather than three `if`s is that the interesting entries are the ones
 * nobody thinks of: the cloud metadata endpoint at 169.254.169.254, carrier-
 * grade NAT at 100.64/10, an IPv4 address written as an IPv6-mapped one, and
 * `0.0.0.0`, which on Linux routes to localhost.
 *
 * Every case below is asserted in both directions — the neighbouring public
 * address is checked too, so a range that is too wide fails as loudly as one
 * that is too narrow.
 */

describe('isPrivateAddress — IPv4', () => {
  it.each([
    ['0.0.0.0', 'this host; on Linux it routes to localhost'],
    ['0.255.255.255', 'the rest of 0.0.0.0/8'],
    ['10.0.0.1', 'private'],
    ['10.255.255.255', 'private'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.127.255.255', 'carrier-grade NAT'],
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'all of 127/8 is loopback, not just .0.0.1'],
    ['169.254.169.254', 'the cloud metadata endpoint'],
    ['169.254.0.1', 'link-local'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['192.0.2.1', 'TEST-NET-1'],
    ['192.88.99.1', '6to4 relay anycast'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.1', 'TEST-NET-2'],
    ['203.0.113.1', 'TEST-NET-3'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.255', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks %s (%s)', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each([
    ['1.1.1.1'],
    ['8.8.8.8'],
    ['9.255.255.255'],
    ['11.0.0.0'],
    ['100.63.255.255'],
    ['100.128.0.0'],
    ['126.255.255.255'],
    ['128.0.0.1'],
    ['169.253.255.255'],
    ['169.255.0.0'],
    ['172.15.255.255'],
    ['172.32.0.0'],
    ['192.167.255.255'],
    ['192.169.0.0'],
    ['198.17.255.255'],
    ['198.20.0.0'],
    ['223.255.255.255'],
  ])('allows %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })
})

describe('isPrivateAddress — IPv6', () => {
  it.each([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local'],
    ['fe80::1', 'link-local'],
    ['febf:ffff::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['100::1', 'discard-only'],
    ['2001:db8::1', 'documentation'],
    ['::ffff:127.0.0.1', 'loopback written as an IPv4-mapped address'],
    ['::ffff:169.254.169.254', 'the metadata endpoint, mapped'],
    ['::ffff:10.0.0.1', 'private, mapped'],
    ['64:ff9b::7f00:1', 'loopback behind NAT64'],
  ])('blocks %s (%s)', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each([['2606:4700:4700::1111'], ['2001:4860:4860::8888'], ['::ffff:8.8.8.8']])(
    'allows %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false)
    },
  )
})

describe('isPrivateAddress — anything else', () => {
  it.each([[''], ['not an address'], ['999.1.1.1'], ['1.2.3'], ['0x7f.0.0.1'], ['::gg']])(
    'blocks %s, because an address it cannot parse is one it cannot vouch for',
    (value) => {
      expect(isPrivateAddress(value)).toBe(true)
    },
  )
})
