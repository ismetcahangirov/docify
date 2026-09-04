import { describe, expect, it, vi } from 'vitest'

import type { PageView } from '@/lib/db/parse-view'
import type { Query } from '@/lib/db/stats'
import { recordPageView } from '@/lib/db/views'

/*
 * The page-view counter (issue #102), in the same shape as
 * `test/db/stats.test.ts` and for the same reasons: the query function arrives
 * as a parameter, so the module can be tested for what it does when there is no
 * database — which is the state CI runs in, and the state #86 says the whole
 * app must survive.
 */

const view: PageView = { page: '/convert/heic-to-jpg' }

describe('recordPageView', () => {
  it('writes one row and reports that it did', async () => {
    const query = vi.fn<Query>().mockResolvedValue([])

    await expect(recordPageView(view, query)).resolves.toBe(true)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('passes the page as a parameter, never as SQL', async () => {
    const query = vi.fn<Query>().mockResolvedValue([])
    await recordPageView(view, query)

    const [strings, ...values] = query.mock.calls[0]

    expect(values).toEqual(['/convert/heic-to-jpg'])
    expect(strings.join('?')).toContain('insert into page_totals')
    expect(strings.join('?')).not.toContain('/convert/heic-to-jpg')
  })

  it('counts the day on the server, not from the request', async () => {
    const query = vi.fn<Query>().mockResolvedValue([])
    await recordPageView(view, query)

    expect(query.mock.calls[0][0].join('?')).toContain('current_date')
  })

  it('increments on conflict rather than failing on the second view', async () => {
    const query = vi.fn<Query>().mockResolvedValue([])
    await recordPageView(view, query)

    expect(query.mock.calls[0][0].join('?')).toContain('on conflict (page, day)')
  })

  it('reports false rather than throwing when there is no database', async () => {
    await expect(recordPageView(view, null)).resolves.toBe(false)
  })

  it('reports false rather than throwing when the write fails', async () => {
    const query = vi.fn<Query>().mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(recordPageView(view, query)).resolves.toBe(false)
  })

  it('reports false rather than throwing when the driver throws synchronously', async () => {
    const query = vi.fn<Query>(() => {
      throw new Error('no connection string')
    })

    await expect(recordPageView(view, query)).resolves.toBe(false)
  })
})
