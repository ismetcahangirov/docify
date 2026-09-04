import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `GET /api/stats` (issue #85).
 *
 * The acceptance criterion is a five-minute cache, and that is asserted as a
 * header rather than by waiting five minutes: the cache is the CDN's, and the
 * only thing this handler controls is what it tells the CDN.
 *
 * The rest is the same contract as the POST beside it. The figures are
 * decoration; a page that renders them has to render without them too, so an
 * absent or broken database is a 200 with `available: false` and never a 500.
 */

const query = vi.hoisted(() => vi.fn())
const connection = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('@/lib/db/neon', () => ({ connection: () => connection.current }))

const { GET } = await import('@/app/api/stats/route')

let addresses = 0
const get = () =>
  GET(
    new Request('https://docify.app/api/stats', {
      headers: { 'x-forwarded-for': `198.51.100.${(addresses += 1) % 250}` },
    }),
  )

beforeEach(() => {
  query.mockReset().mockResolvedValue([{ conversions: '12904', pairs: '38' }])
  connection.current = query
})

describe('GET /api/stats', () => {
  it('serves the figures', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ available: true, conversions: 12904, pairs: 38 })
  })

  it('asks the CDN to hold it for five minutes', async () => {
    const cacheControl = (await get()).headers.get('cache-control')

    expect(cacheControl).toContain('s-maxage=300')
    expect(cacheControl).toContain('public')
  })

  it('lets the CDN serve a stale answer while it fetches a fresh one', async () => {
    // The alternative is that every five minutes one visitor pays for the
    // round trip to Neon. Counters are the least urgent data on the page.
    expect((await get()).headers.get('cache-control')).toMatch(/stale-while-revalidate=\d+/)
  })

  it('says so, with a 200, when there is no database', async () => {
    connection.current = null
    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ available: false })
  })

  it('says so, with a 200, when the database is unreachable', async () => {
    query.mockRejectedValue(new Error('ECONNREFUSED'))
    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ available: false })
  })

  it('does not let the CDN hold an unavailable answer for five minutes', async () => {
    connection.current = null

    // Caching the outage would outlast the outage. A short window still absorbs
    // a stampede without pinning "we have no figures" to the page for a
    // deployment that has since been given a connection string.
    const cacheControl = (await get()).headers.get('cache-control')

    expect(cacheControl).not.toContain('s-maxage=300')
    expect(cacheControl).toMatch(/s-maxage=[1-9]\d?\b/)
  })

  it('rate-limits a caller that goes around the cache', async () => {
    const headers = { 'x-forwarded-for': '198.51.100.254' }
    const request = () => GET(new Request('https://docify.app/api/stats', { headers }))

    let refused: Response | undefined
    for (let i = 0; i < 400 && refused === undefined; i += 1) {
      const response = await request()
      if (response.status === 429) refused = response
    }

    expect(refused?.status).toBe(429)
  })
})
