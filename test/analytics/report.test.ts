import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reportPageView } from '@/lib/analytics/report'

/*
 * The client half of the page counter (issue #102).
 *
 * Same two properties as `test/stats/report.test.ts`, and the second one is why
 * this file exists rather than a comment: it sends **one field, and that field
 * is a path**. Everything a hosted analytics script would add here — referrer,
 * screen size, language, timezone, a visitor identifier — is what turns a page
 * counter into a fingerprint, and the way "we do not collect it" stays true is
 * by asserting what actually goes on the wire.
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

describe('reportPageView', () => {
  it('sends the page and nothing else', async () => {
    reportPageView('/convert/heic-to-jpg')

    expect(beacon).toHaveBeenCalledWith('/api/views', expect.anything())
    expect(await sent()).toEqual({ page: '/convert/heic-to-jpg' })
  })

  it('sends no referrer, no screen, no language, no visitor', async () => {
    reportPageView('/')

    expect(Object.keys((await sent()) as object)).toEqual(['page'])
  })

  it('returns synchronously, so no render waits on it', () => {
    expect(reportPageView('/')).toBeUndefined()
  })

  it('is silent when the browser has no sendBeacon', () => {
    vi.stubGlobal('navigator', {})

    expect(() => reportPageView('/')).not.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is silent when there is no navigator at all', () => {
    vi.stubGlobal('navigator', undefined)

    expect(() => reportPageView('/')).not.toThrow()
  })

  it('is silent when the beacon throws', () => {
    beacon.mockImplementation(() => {
      throw new Error('blocked by an extension')
    })

    expect(() => reportPageView('/')).not.toThrow()
  })

  it('retries with fetch only when the beacon existed and refused', () => {
    // A full queue is a real condition worth one retry. A browser with no
    // beacon gets no request instead — otherwise every environment lacking one,
    // including the test renderer, would start making network calls.
    beacon.mockReturnValue(false)
    reportPageView('/convert')

    expect(fetch).toHaveBeenCalledWith('/api/views', expect.objectContaining({ method: 'POST' }))
  })

  it('swallows a rejected retry', async () => {
    beacon.mockReturnValue(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    expect(() => reportPageView('/')).not.toThrow()
    await Promise.resolve()
  })
})
