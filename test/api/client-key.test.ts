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

  it('reads only the last hop of x-forwarded-for', () => {
    /*
     * A proxy *appends*, so the list runs client-first and the only entry we
     * put there ourselves is the last one. Reading the first would take a
     * string the caller typed: one client sending a fresh value per request
     * mints a fresh key per request and never meets the limiter at all.
     */
    const direct = clientKey(withHeaders({ 'x-forwarded-for': '198.51.100.2' }))

    expect(clientKey(withHeaders({ 'x-forwarded-for': '203.0.113.7, 198.51.100.2' }))).toBe(direct)
    // A different forged prefix in front of the same real hop is the same
    // caller, and has to land in the same bucket.
    expect(clientKey(withHeaders({ 'x-forwarded-for': '203.0.113.8, 198.51.100.2' }))).toBe(direct)
  })

  it('falls through to x-real-ip when x-forwarded-for holds no address at all', () => {
    // A header of nothing but separators is not an address, and treating it as
    // one would skip a fallback that does hold the caller.
    expect(clientKey(withHeaders({ 'x-forwarded-for': ' , ', 'x-real-ip': '203.0.113.9' }))).toBe(
      clientKey(withHeaders({ 'x-real-ip': '203.0.113.9' })),
    )
  })

  it('ignores empty entries in x-forwarded-for', () => {
    // A trailing comma would otherwise read as an address of zero length and
    // send the caller to the shared bucket with everybody unidentifiable.
    expect(clientKey(withHeaders({ 'x-forwarded-for': '198.51.100.2, ' }))).toBe(
      clientKey(withHeaders({ 'x-forwarded-for': '198.51.100.2' })),
    )
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
