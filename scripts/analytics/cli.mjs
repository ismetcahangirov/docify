#!/usr/bin/env node
/**
 * Read the page counters — `pnpm analytics` (issue #102).
 *
 * ```
 * pnpm analytics                     # the busiest 20 pages of the last 30 days
 * pnpm analytics --days 7 --top 50
 * ```
 *
 * ## Why the figures are read here and not served
 *
 * Nothing on the site shows them. `GET /api/stats` exists because a page shows
 * the conversion totals; there is no equivalent for these, so there is no route
 * handler, no cache policy and no public JSON shape to keep stable. They are
 * read by somebody who already holds `DATABASE_URL`, which is the same
 * threshold `pnpm db:migrate` uses.
 *
 * Publishing which pages get traffic would be a decision, and a route handler
 * added "while we are here" is a strange way to make one.
 *
 * ## What the numbers mean, and what they do not
 *
 * Views, not visitors. Two people opening a page and one person opening it
 * twice are the same row — see the comment above `page_totals` in
 * lib/db/schema.sql. The beacon needs JavaScript, so most crawlers are absent
 * from these figures; what crawlers and searchers do is answered by Search
 * Console instead (docs/seo/search-console.md).
 */
import { neon } from '@neondatabase/serverless'

import { formatReport, parseOptions, TOP_PAGES_SQL } from './top-pages.mjs'

/** @param {string} message */
function fail(message) {
  console.error(`\n${message}\n`)
  process.exitCode = 1
}

async function main() {
  const url = process.env.DATABASE_URL

  if (url === undefined || url.trim().length === 0) {
    fail(
      'DATABASE_URL is not set.\n' +
        'See docs/backend/neon-provisioning.md for where the connection string lives.',
    )

    return
  }

  const { days, top } = parseOptions(process.argv.slice(2))
  const sql = neon(url.trim())
  const rows = await sql.query(TOP_PAGES_SQL, [days, top])

  console.log(['', ...formatReport(rows, days), ''].join('\n'))
}

main().catch((reason) => {
  fail(`Could not read the counters: ${reason instanceof Error ? reason.message : String(reason)}`)
})
