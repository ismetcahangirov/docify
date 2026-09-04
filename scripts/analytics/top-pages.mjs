/**
 * The reader's logic, apart from the connection (issue #102).
 *
 * Split out for the reason every other `scripts/*` module here is: the CLI is
 * the part that needs a database and the part that cannot be tested, and
 * everything worth getting right — the window, the ordering, the arithmetic in
 * the summary line — is not that part.
 */

/**
 * The busiest pages over a window, most-opened first.
 *
 * The aggregation happens in Postgres. `page_totals` holds a row per page per
 * day, and summing a year of that in JavaScript would mean pulling the whole
 * table over the wire to print twenty lines.
 *
 * `$1` and `$2` rather than interpolation, even with a CLI's own arguments on
 * the other end: the habit is the defence, and a query that reads safely is one
 * nobody has to re-check when its caller changes.
 */
export const TOP_PAGES_SQL = `select page, sum(total) as views
  from page_totals
 where day > current_date - $1::int
 group by page
 order by views desc, page asc
 limit $2`

/** What is shown when nothing was asked for. */
const DEFAULTS = { days: 30, top: 20 }

/** Above these, the answer is a database dump rather than a report. */
const CEILINGS = { days: 3650, top: 200 }

/**
 * A numeric flag's value, clamped, or the default when it was absent or absurd.
 *
 * @param {string[]} argv
 * @param {'days' | 'top'} name
 * @returns {number}
 */
function option(argv, name) {
  const at = argv.indexOf(`--${name}`)
  if (at === -1) return DEFAULTS[name]

  const parsed = Number(argv[at + 1])
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULTS[name]

  return Math.min(Math.floor(parsed), CEILINGS[name])
}

/**
 * The window and the size of the report, from the command line.
 *
 * @param {string[]} argv
 * @returns {{ days: number, top: number }}
 */
export function parseOptions(argv) {
  return { days: option(argv, 'days'), top: option(argv, 'top') }
}

/**
 * The report, as the lines to print.
 *
 * `views` arrives as a string when Postgres sends a `bigint`, which is why the
 * summary coerces rather than adds. A row whose count cannot be read is skipped
 * rather than shown as `NaN`.
 *
 * @param {Array<{ page: string, views: unknown }>} rows
 * @param {number} days
 * @returns {string[]}
 */
export function formatReport(rows, days) {
  const header = `Page views, last ${days} day${days === 1 ? '' : 's'}`

  const counted = rows.flatMap((row) => {
    const views = Number(row.views)

    return Number.isFinite(views) ? [{ page: row.page, views }] : []
  })

  // A working database with nothing in it yet, which is what every database
  // looks like on the day it is provisioned. Not an outage, and not an error.
  if (counted.length === 0) return [header, '', '  no views recorded yet']

  const width = Math.max(...counted.map((row) => String(row.views).length))
  const total = counted.reduce((sum, row) => sum + row.views, 0)

  return [
    header,
    '',
    ...counted.map((row) => `  ${String(row.views).padStart(width)}  ${row.page}`),
    '',
    `  ${total} across ${counted.length} page${counted.length === 1 ? '' : 's'}`,
  ]
}
