import { describe, expect, it, vi } from 'vitest'

import type { ConversionEvent } from '@/lib/db/events'
import { type Query, recordConversion } from '@/lib/db/stats'

/*
 * The write, and the one property that matters about it: it cannot take the
 * caller down with it (issue #84, and the acceptance criterion of #86).
 *
 * `recordConversion` is handed its query function rather than reaching for one,
 * for the reason CLAUDE.md §5.1 gives about `Capabilities`: a module that
 * fetches its own dependency cannot be tested without a network, and this one
 * has to be tested precisely *for* what it does when the network is not there.
 */

const event: ConversionEvent = { pair: 'heic-to-jpg', outcome: 'success', bucket: 'm' }

describe('recordConversion', () => {
  it('writes one row and reports that it did', async () => {
    const query = vi.fn<Query>().mockResolvedValue([])

    await expect(recordConversion(event, query)).resolves.toBe(true)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('passes the three fields as parameters, never as SQL', async () => {
    const query = vi.fn<Query>().mockResolvedValue([])
    await recordConversion(event, query)

    const [strings, ...values] = query.mock.calls[0]

    expect(values).toEqual(['heic-to-jpg', 'success', 'm'])
    // A tagged template is the whole defence against injection here: the values
    // travel out of band, so a pair of "'; drop table --" would be a row that
    // matches no CHECK constraint rather than a statement.
    expect(strings.join('?')).toContain('insert into conversion_totals')
    expect(strings.join('?')).not.toContain('heic-to-jpg')
  })

  it('counts the day on the server, not from the request', async () => {
    const query = vi.fn<Query>().mockResolvedValue([])
    await recordConversion(event, query)

    // `current_date` rather than a value: a date supplied by the client is a
    // field the client controls, and a counter whose day column is attacker
    // controlled is not a counter.
    expect(query.mock.calls[0][0].join('?')).toContain('current_date')
  })

  it('increments on conflict rather than failing on the second conversion', async () => {
    const query = vi.fn<Query>().mockResolvedValue([])
    await recordConversion(event, query)

    const sql = query.mock.calls[0][0].join('?')

    expect(sql).toContain('on conflict')
    expect(sql).toContain('conversion_totals.total + 1')
  })

  it('reports false, and does not throw, when there is no database', async () => {
    await expect(recordConversion(event, null)).resolves.toBe(false)
  })

  it('reports false, and does not throw, when the database is unreachable', async () => {
    const query = vi.fn<Query>().mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(recordConversion(event, query)).resolves.toBe(false)
  })

  it('reports false, and does not throw, when the driver throws synchronously', async () => {
    const query = vi.fn<Query>().mockImplementation(() => {
      throw new Error('the connection string is malformed')
    })

    await expect(recordConversion(event, query)).resolves.toBe(false)
  })
})
