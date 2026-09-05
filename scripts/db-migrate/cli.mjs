#!/usr/bin/env node
/**
 * Apply the schema to a Neon database — `pnpm db:migrate` (issue #101).
 *
 * ```
 * pnpm db:migrate            # apply lib/db/schema.sql
 * pnpm db:migrate --check    # report what is there, change nothing
 * ```
 *
 * Reads `DATABASE_URL` and nothing else, so the same command provisions a
 * branch database, a preview and production by pointing at a different string.
 * The runbook is docs/backend/neon-provisioning.md.
 *
 * ## Why this exists rather than a migration framework
 *
 * The data model is a short list of counter tables and the indexes they need.
 * A framework would bring a dependency, a versions table and an ordering
 * problem to a schema whose every statement is idempotent — `if not exists` on
 * what it creates, `if exists` on what it drops — and therefore safe to
 * re-apply in any order, any number of times, whatever state a database is
 * already in. `test/db-migrate.test.ts` holds that property.
 *
 * When the schema does change, it changes `lib/db/schema.sql` and this command
 * runs again. A change that could not be expressed idempotently would be the
 * moment to reconsider — and it would also be a change that has to answer to
 * `test/db/schema.test.ts` first.
 */
import { neon } from '@neondatabase/serverless'

import { classify, expectedTables, readSchema, SCHEMA_PATH } from './schema.mjs'

/** @param {string} message */
function fail(message) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error::${message}`)
  console.error(`\n${message}\n`)
  process.exitCode = 1
}

/**
 * The connection string, or `null` with the reason already printed.
 *
 * Absent is a hard stop here, unlike in `lib/db/neon.ts` where it means "skip
 * the counter and carry on". The application is designed to run without a
 * database; a command whose entire purpose is to talk to one is not.
 *
 * @returns {string | null}
 */
function connectionString() {
  const url = process.env.DATABASE_URL

  if (url === undefined || url.trim().length === 0) {
    fail(
      'DATABASE_URL is not set.\n' +
        'Copy the pooled connection string from the Neon console and export it:\n' +
        '  export DATABASE_URL="postgresql://...@...neon.tech/docify?sslmode=require"\n' +
        'See docs/backend/neon-provisioning.md.',
    )

    return null
  }

  return url.trim()
}

/** The first line of a statement, for a log that fits on a terminal. */
function summarise(statement) {
  return statement.split('\n')[0].replace(/\s+/g, ' ').slice(0, 72)
}

/**
 * What the database currently has, as the two facts worth reporting.
 *
 * Read from `information_schema` and `pg_indexes` rather than by selecting from
 * the table, so a missing table is an answer rather than an error.
 */
async function describe(sql) {
  const [tables, indexes] = await Promise.all([
    sql.query(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    ),
    sql.query("select indexname from pg_indexes where schemaname = 'public' order by indexname"),
  ])

  return {
    tables: tables.map((row) => row.table_name),
    indexes: indexes.map((row) => row.indexname),
  }
}

async function main() {
  const check = process.argv.includes('--check')
  const url = connectionString()
  if (url === null) return

  const statements = readSchema()
  const sql = neon(url)

  console.log(`\n${SCHEMA_PATH}`)
  console.log(`${statements.length} statement${statements.length === 1 ? '' : 's'}\n`)

  if (!check) {
    for (const statement of statements) {
      // One request per statement: the HTTP path the driver uses takes one, and
      // that is also what makes a failure name the statement that failed.
      await sql.query(statement)
      console.log(`  applied  ${summarise(statement)}`)
    }
    console.log('')
  }

  const { tables, indexes } = await describe(sql)

  console.log(`  tables   ${tables.length > 0 ? tables.join(', ') : '(none)'}`)
  console.log(`  indexes  ${indexes.length > 0 ? indexes.join(', ') : '(none)'}\n`)

  // Both lists are derived from the schema rather than written down here. A
  // name kept in two places goes stale in one of them, which is exactly what
  // happened when issue #102 added `page_totals` and this file did not notice.
  // The comparison itself lives in schema.mjs, where a test can reach it
  // without a database.
  const { missing, unexpected } = classify(tables, expectedTables(statements))

  if (missing.length > 0) {
    const names = missing.join(', ')
    const verb = missing.length === 1 ? 'is' : 'are'
    const them = missing.length === 1 ? 'it' : 'them'

    fail(
      check
        ? `${names} ${verb} not there. Run \`pnpm db:migrate\` to create ${them}.`
        : `${names} ${verb} still missing after applying the schema.`,
    )

    return
  }

  // Named rather than counted: the point of this line is that the database
  // holds the tables the schema declares and nothing somebody added by hand.
  if (unexpected.length > 0) {
    console.log(`  note     unexpected table(s): ${unexpected.join(', ')}`)
    console.log('           lib/db/schema.sql is the whole data model — see CLAUDE.md §2.1.\n')
  }

  console.log(check ? 'Schema is applied.\n' : 'Schema applied.\n')
}

main().catch((reason) => {
  // A bad connection string, an unreachable host, a statement the server
  // refused. All of them are the operator's to read, so the message is passed
  // through rather than summarised.
  fail(`Could not apply the schema: ${reason instanceof Error ? reason.message : String(reason)}`)
})
