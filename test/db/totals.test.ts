import { describe, expect, it, vi } from 'vitest'

import { type Query, readTotals } from '@/lib/db/stats'

/*
 * The read behind `GET /api/stats` (issue #85).
 *
 * Two things are being asserted, and only one of them is arithmetic. The other
 * is that a database which is missing, broken, or answering with something
 * unexpected produces `null` rather than an exception — because the figures are
 * decoration on a page that has to render without them (#86), and a homepage
 * that 500s because a counter table is unreachable would be exactly the
 * critical-path dependency the plan says the backend must never become.
 */

const row = (conversions: string, pairs: string) => [{ conversions, pairs }]

describe('readTotals', () => {
  it('aggregates in Postgres rather than pulling every row', async () => {
    const query = vi.fn<Query>().mockResolvedValue(row('42', '7'))
    await readTotals(query)

    const sql = query.mock.calls[0][0].join('?')

    // The table has one row per pair per outcome per bucket per day. Summing it
    // in JavaScript would mean shipping a year of that over the wire to render
    // two numbers.
    expect(sql).toContain('coalesce(sum(total), 0)')
    expect(sql).toContain('count(distinct pair)')
    expect(sql).toContain('from conversion_totals')
  })

  it('counts successes only', async () => {
    const query = vi.fn<Query>().mockResolvedValue(row('42', '7'))
    await readTotals(query)

    // "12,904 files converted" has to mean converted. A failure is a real event
    // worth recording and not a figure worth advertising.
    expect(query.mock.calls[0][0].join('?')).toContain("outcome = 'success'")
  })

  it('returns the two figures as numbers', async () => {
    // Postgres returns bigint and count as strings over the wire, because they
    // do not fit a double in general. These do.
    const query = vi.fn<Query>().mockResolvedValue(row('12904', '38'))

    await expect(readTotals(query)).resolves.toEqual({ conversions: 12904, pairs: 38 })
  })

  it('reads a driver that already coerced them to numbers', async () => {
    const query = vi.fn<Query>().mockResolvedValue([{ conversions: 12904, pairs: 38 }])

    await expect(readTotals(query)).resolves.toEqual({ conversions: 12904, pairs: 38 })
  })

  it('returns zeroes for an empty table rather than null', async () => {
    // An empty table is a working database with nothing in it yet, which is a
    // different answer from "there is no database".
    const query = vi.fn<Query>().mockResolvedValue(row('0', '0'))

    await expect(readTotals(query)).resolves.toEqual({ conversions: 0, pairs: 0 })
  })

  it('returns null when there is no database', async () => {
    await expect(readTotals(null)).resolves.toBeNull()
  })

  it('returns null, and does not throw, when the database is unreachable', async () => {
    const query = vi.fn<Query>().mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(readTotals(query)).resolves.toBeNull()
  })

  it('returns null when the answer is not the shape it asked for', async () => {
    for (const answer of [[], [{}], [{ conversions: 'not a number', pairs: '1' }], ['nonsense']]) {
      const query = vi.fn<Query>().mockResolvedValue(answer)

      await expect(readTotals(query)).resolves.toBeNull()
    }
  })
})
