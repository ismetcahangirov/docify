import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `POST /api/views`, end to end through the handler (issue #102).
 *
 * Mirrors `test/app/api-stats-post.test.ts`: `lib/db/neon.ts` is mocked rather
 * than pointed at a database, because the handler's contract is about statuses
 * and refusals and every one of them has to hold with the database absent —
 * which is the state CI runs in and the state #86 asserts the whole app
 * survives.
 */

const query = vi.hoisted(() => vi.fn())
const connection = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('@/lib/db/neon', () => ({ connection: () => connection.current }))

const { POST } = await import('@/app/api/views/route')

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://docify.app/api/views', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

/** A fresh address per test, so one test's requests never spend another's budget. */
let addresses = 0
const from = () => ({ 'x-forwarded-for': `198.51.100.${(addresses += 1) % 250}` })

const valid = { page: '/convert/heic-to-jpg' }

beforeEach(() => {
  query.mockReset().mockResolvedValue([])
  connection.current = query
})

describe('POST /api/views', () => {
  it('accepts a page of this site and records it', async () => {
    const response = await post(valid, from())

    expect(response.status).toBe(202)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('answers with no body, so nothing is worth reading back', async () => {
    expect(await (await post(valid, from())).text()).toBe('')
  })

  it('still answers 202 when there is no database', async () => {
    connection.current = null

    expect((await post(valid, from())).status).toBe(202)
  })

  it('still answers 202 when the write fails', async () => {
    query.mockRejectedValue(new Error('ECONNREFUSED'))

    expect((await post(valid, from())).status).toBe(202)
  })

  it.each([
    ['a path that is not a route', { page: '/admin' }],
    ['a conversion page that does not exist', { page: '/convert/docx-to-mp3' }],
    ['an absolute URL', { page: 'https://docify.app/' }],
    ['a query string', { page: '/?ref=someone' }],
    ['a fragment', { page: '/convert/heic-to-jpg#faq' }],
    ['a surplus field', { page: '/', referrer: 'https://example.com' }],
    ['an array', [{ page: '/' }]],
    ['a bare string', '"/"'],
  ])('refuses %s with 400 and writes nothing', async (_label, body) => {
    const response = await post(body, from())

    expect(response.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a body that is not JSON', async () => {
    expect((await post('{ not json', from())).status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a body larger than a view could ever be', async () => {
    const response = await post({ page: `/convert/${'x'.repeat(4096)}` }, from())

    expect(response.status).toBe(413)
    expect(query).not.toHaveBeenCalled()
  })

  it('rate-limits one caller without touching another', async () => {
    const attacker = from()
    const bystander = from()

    let refused: Response | undefined
    for (let i = 0; i < 400 && refused === undefined; i += 1) {
      const response = await post(valid, attacker)
      if (response.status === 429) refused = response
    }

    expect(refused?.status).toBe(429)
    expect(refused?.headers.get('retry-after')).toMatch(/^\d+$/)
    expect((await post(valid, bystander)).status).toBe(202)
  })

  it('is never cached', async () => {
    const response = await post(valid, from())

    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('serves no GET, because nothing on the site shows these figures', async () => {
    // They are read by `pnpm analytics`, by somebody who already holds the
    // connection string. Publishing which pages get traffic is a decision
    // nobody has made, and a route handler is a strange place to make it by
    // accident.
    const route: Record<string, unknown> = await import('@/app/api/views/route')

    expect(Object.keys(route)).toEqual(['POST'])
  })
})
