import { describe, expect, it } from 'vitest'

import { clientKey } from '@/lib/api/client-key'

/*
 * The rate limiter has to tell callers apart, and the only thing that tells
 * callers apart is their address — which is the one thing CLAUDE.md §2.1 and
 * the plan's task 10.1 say is never retained.
 *
 * The reconciliation: the address is hashed with a salt minted per process and
 * never written down, the digest is truncated, and the result lives only in the
 * limiter's in-memory map for one window. Nothing reaches the database, nothing
 * survives the process, and the salt makes the digest unreversible even to
 * somebody holding a memory dump and a list of every IPv4 address.
 */

const withHeaders = (headers: Record<string, string>) =>
  new Request('https://docify.app/api/stats', { method: 'POST', headers })

describe('clientKey', () => {
  it('is stable for the same address within a process', () => {
    const request = () => withHeaders({ 'x-forwarded-for': '203.0.113.7' })

    expect(clientKey(request())).toBe(clientKey(request()))
  })

  it('differs between addresses', () => {
    expect(clientKey(withHeaders({ 'x-forwarded-for': '203.0.113.7' }))).not.toBe(
      clientKey(withHeaders({ 'x-forwarded-for': '203.0.113.8' })),
    )
  })

  it('never contains the address it was derived from', () => {
    const key = clientKey(withHeaders({ 'x-forwarded-for': '203.0.113.7' }))

    expect(key).not.toContain('203')
    expect(key).toMatch(/^[0-9a-f]{16}$/)
  })

  it('reads only the first hop of x-forwarded-for', () => {
    // Everything after the first entry was appended by a proxy and can be
    // forged by the client; counting it would let one caller mint keys freely.
    const direct = clientKey(withHeaders({ 'x-forwarded-for': '203.0.113.7' }))
    const chained = clientKey(withHeaders({ 'x-forwarded-for': '203.0.113.7, 198.51.100.2' }))

    expect(chained).toBe(direct)
  })

  it('falls back to x-real-ip, then to a shared bucket', () => {
    expect(clientKey(withHeaders({ 'x-real-ip': '203.0.113.9' }))).toBe(
      clientKey(withHeaders({ 'x-real-ip': '203.0.113.9' })),
    )

    // No header at all: one shared key, so an unidentifiable caller is limited
    // rather than exempt.
    expect(clientKey(withHeaders({}))).toBe(clientKey(withHeaders({})))
    expect(clientKey(withHeaders({}))).not.toBe(clientKey(withHeaders({ 'x-real-ip': '1.2.3.4' })))
  })
})
