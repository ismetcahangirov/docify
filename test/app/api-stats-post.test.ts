import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `POST /api/stats`, end to end through the handler (issue #84).
 *
 * `lib/db/neon.ts` is mocked rather than pointed at a database: the handler's
 * contract is about statuses and refusals, and every one of them has to hold
 * with the database absent — which is the state CI runs in, and the state #86
 * asserts the whole app survives.
 */

const query = vi.hoisted(() => vi.fn())
const connection = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('@/lib/db/neon', () => ({ connection: () => connection.current }))

const { POST } = await import('@/app/api/stats/route')

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://docify.app/api/stats', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

/** A fresh address per test, so one test's requests never spend another's budget. */
let addresses = 0
const from = () => ({ 'x-forwarded-for': `203.0.113.${(addresses += 1) % 250}` })

const valid = { pair: 'heic-to-jpg', outcome: 'success', bucket: 'm' }

beforeEach(() => {
  query.mockReset().mockResolvedValue([])
  connection.current = query
})

describe('POST /api/stats', () => {
  it('accepts a well-formed event and records it', async () => {
    const response = await post(valid, from())

    expect(response.status).toBe(202)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('answers with no body, so nothing is worth reading back', async () => {
    expect(await (await post(valid, from())).text()).toBe('')
  })

  it('still answers 202 when there is no database', async () => {
    connection.current = null

    // The client cannot tell, and must not: a conversion is not the place to
    // learn that a counter is down.
    expect((await post(valid, from())).status).toBe(202)
  })

  it('still answers 202 when the write fails', async () => {
    query.mockRejectedValue(new Error('ECONNREFUSED'))

    expect((await post(valid, from())).status).toBe(202)
  })

  it.each([
    ['a pair with no page', { pair: 'docx-to-mp3', outcome: 'success', bucket: 'm' }],
    [
      'a pair that is a file name',
      { pair: '/Users/ada/holiday.heic', outcome: 'success', bucket: 'm' },
    ],
    ['an unknown outcome', { pair: 'heic-to-jpg', outcome: 'cancelled', bucket: 'm' }],
    ['a surplus field', { pair: 'heic-to-jpg', outcome: 'success', bucket: 'm', referrer: 'x' }],
    ['an array', [{ pair: 'heic-to-jpg', outcome: 'success', bucket: 'm' }]],
    ['a bare string', '"heic-to-jpg"'],
  ])('refuses %s with 400 and writes nothing', async (_label, body) => {
    const response = await post(body, from())

    expect(response.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a body that is not JSON', async () => {
    expect((await post('{ not json', from())).status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a body larger than an event could ever be', async () => {
    const response = await post({ ...valid, pad: 'x'.repeat(4096) }, from())

    expect(response.status).toBe(413)
    expect(query).not.toHaveBeenCalled()
  })

  it('rate-limits one caller without touching another', async () => {
    const attacker = from()
    const bystander = from()

    let refused: Response | undefined
    for (let i = 0; i < 200 && refused === undefined; i += 1) {
      const response = await post(valid, attacker)
      if (response.status === 429) refused = response
    }

    expect(refused?.status).toBe(429)
    expect(refused?.headers.get('retry-after')).toMatch(/^\d+$/)
    expect((await post(valid, bystander)).status).toBe(202)
  })

  it('answers a rate-limited caller without writing', async () => {
    const attacker = from()
    for (let i = 0; i < 200; i += 1) await post(valid, attacker)

    query.mockClear()
    expect((await post(valid, attacker)).status).toBe(429)
    expect(query).not.toHaveBeenCalled()
  })

  it('is never cached', async () => {
    const response = await post(valid, from())

    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})
