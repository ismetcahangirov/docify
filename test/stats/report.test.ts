import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reportConversion } from '@/lib/stats/report'

/*
 * The client half of the counter (issue #84).
 *
 * Two properties, and they are the whole point of the module. It is
 * **fire-and-forget** — it returns synchronously, so no conversion ever waits
 * on it and no failure of it can surface in the UI. And it sends **only the
 * three anonymous fields**, which is CLAUDE.md §2.1: `navigator.sendBeacon` is
 * named there as one of the APIs a file must never travel on, and the way to
 * keep that true is to assert what this one actually puts on the wire.
 */

const beacon = vi.fn<(url: string, body?: BodyInit | null) => boolean>()

beforeEach(() => {
  beacon.mockReset().mockReturnValue(true)
  vi.stubGlobal('navigator', { sendBeacon: beacon })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** What the beacon was handed, decoded. */
async function sent(): Promise<unknown> {
  const body = beacon.mock.calls[0]?.[1]

  return JSON.parse(await (body as Blob).text())
}

describe('reportConversion', () => {
  it('sends the pair, the outcome and the size bucket', async () => {
    reportConversion({ from: 'heic', to: 'jpg' }, 12_000_000, 'success')

    expect(beacon).toHaveBeenCalledWith('/api/stats', expect.anything())
    expect(await sent()).toEqual({ pair: 'heic-to-jpg', outcome: 'success', bucket: 'm' })
  })

  it('sends nothing else — no name, no size, no time', async () => {
    reportConversion({ from: 'png', to: 'webp' }, 512, 'failure')

    expect(Object.keys((await sent()) as object).sort()).toEqual(['bucket', 'outcome', 'pair'])
  })

  it('reports the size only as a bucket', async () => {
    reportConversion({ from: 'png', to: 'webp' }, 123_456_789, 'success')

    const payload = (await sent()) as Record<string, unknown>

    expect(payload.bucket).toBe('l')
    expect(JSON.stringify(payload)).not.toContain('123456789')
  })

  it('returns synchronously, so no conversion waits on it', () => {
    expect(reportConversion({ from: 'heic', to: 'jpg' }, 1, 'success')).toBeUndefined()
  })

  it('falls back to a keepalive fetch when the beacon is refused', () => {
    beacon.mockReturnValue(false)
    reportConversion({ from: 'heic', to: 'jpg' }, 1, 'success')

    expect(fetch).toHaveBeenCalledWith(
      '/api/stats',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    )
  })

  it('does not throw when the beacon throws', () => {
    beacon.mockImplementation(() => {
      throw new Error('blocked by an extension')
    })

    expect(() => reportConversion({ from: 'heic', to: 'jpg' }, 1, 'success')).not.toThrow()
  })

  it('does not throw when the fallback fetch rejects', () => {
    beacon.mockReturnValue(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    expect(() => reportConversion({ from: 'heic', to: 'jpg' }, 1, 'success')).not.toThrow()
  })

  it('does nothing at all where there is no navigator', () => {
    vi.stubGlobal('navigator', undefined)

    expect(() => reportConversion({ from: 'heic', to: 'jpg' }, 1, 'success')).not.toThrow()
    expect(beacon).not.toHaveBeenCalled()
  })
})
