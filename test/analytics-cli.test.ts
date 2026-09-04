import { describe, expect, it } from 'vitest'

import { formatReport, parseOptions, TOP_PAGES_SQL } from '../scripts/analytics/top-pages.mjs'

/*
 * The reader behind `pnpm analytics` (issue #102).
 *
 * Tested on arguments and rows rather than against a database, for the reason
 * `test/db-migrate.test.ts` gives: the unit job has no Postgres and should not
 * grow one. What is worth getting right here is not the connection — it is the
 * window, the clamps, and the arithmetic that turns rows into a report.
 */

describe('parseOptions', () => {
  it('reports the last thirty days and the busiest twenty pages by default', () => {
    expect(parseOptions([])).toEqual({ days: 30, top: 20 })
  })

  it('takes a window and a size from the command line', () => {
    expect(parseOptions(['--days', '7', '--top', '50'])).toEqual({ days: 7, top: 50 })
  })

  it('falls back rather than failing on a value that is not a number', () => {
    // A mistyped flag should print a report, not a stack trace.
    expect(parseOptions(['--days', 'last week'])).toEqual({ days: 30, top: 20 })
    expect(parseOptions(['--top'])).toEqual({ days: 30, top: 20 })
  })

  it('falls back on a value below one', () => {
    expect(parseOptions(['--days', '0', '--top', '-5'])).toEqual({ days: 30, top: 20 })
  })

  it('clamps a request for the whole table', () => {
    expect(parseOptions(['--days', '100000', '--top', '100000'])).toEqual({
      days: 3650,
      top: 200,
    })
  })

  it('takes the whole part of a fractional value', () => {
    expect(parseOptions(['--days', '7.9'])).toEqual({ days: 7, top: 20 })
  })
})

describe('TOP_PAGES_SQL', () => {
  it('aggregates in Postgres rather than over the wire', () => {
    // `page_totals` holds a row per page per day; summing a year of that in
    // JavaScript would mean pulling the whole table over to print twenty lines.
    expect(TOP_PAGES_SQL).toContain('sum(total)')
    expect(TOP_PAGES_SQL).toContain('group by page')
  })

  it('passes the window and the limit as parameters', () => {
    expect(TOP_PAGES_SQL).toContain('$1')
    expect(TOP_PAGES_SQL).toContain('$2')
  })

  it('breaks a tie by page, so two runs of the same data agree', () => {
    expect(TOP_PAGES_SQL).toContain('order by views desc, page asc')
  })
})

describe('formatReport', () => {
  it('says the window it is reporting on', () => {
    expect(formatReport([{ page: '/', views: 1 }], 7)[0]).toBe('Page views, last 7 days')
    expect(formatReport([{ page: '/', views: 1 }], 1)[0]).toBe('Page views, last 1 day')
  })

  it('lists the pages with their counts right-aligned', () => {
    const lines = formatReport(
      [
        { page: '/convert/heic-to-jpg', views: 412 },
        { page: '/', views: 7 },
      ],
      30,
    )

    expect(lines).toContain('  412  /convert/heic-to-jpg')
    expect(lines).toContain('    7  /')
  })

  it('adds the counts up, including the ones Postgres sent as strings', () => {
    // A `bigint` arrives as a string from the driver, and `'412' + '7'` is a
    // number nobody wants to read.
    const lines = formatReport(
      [
        { page: '/convert/heic-to-jpg', views: '412' },
        { page: '/', views: '7' },
      ],
      30,
    )

    expect(lines[lines.length - 1]).toBe('  419 across 2 pages')
  })

  it('says so plainly when there is nothing yet', () => {
    // A working database with no rows in it, which is what every database looks
    // like on the day it is provisioned. Not an outage and not an error.
    expect(formatReport([], 30)).toContain('  no views recorded yet')
  })

  it('skips a row whose count cannot be read rather than printing NaN', () => {
    const lines = formatReport(
      [
        { page: '/', views: 'not a number' },
        { page: '/convert', views: 3 },
      ],
      30,
    )

    expect(lines.join('\n')).not.toContain('NaN')
    expect(lines[lines.length - 1]).toBe('  3 across 1 page')
  })
})
