/**
 * Reading `lib/db/schema.sql` as statements a driver can send.
 *
 * ## Why this is not `psql "$DATABASE_URL" -f lib/db/schema.sql`
 *
 * That command is still the one the file's own header suggests, and it is still
 * correct. It also requires psql, which is not installed on a Vercel build, on
 * a GitHub runner, or on the Windows machine this repository is developed on.
 * Provisioning a database should not depend on a client nobody has.
 *
 * `@neondatabase/serverless` is already a dependency — the counter route uses
 * it — and it needs nothing but a connection string. What it does not do is
 * accept a file: its HTTP path carries one statement per request. So the file
 * has to be split, and splitting SQL is the one part of this worth testing.
 *
 * ## Why the splitter is this small
 *
 * It handles what `lib/db/schema.sql` actually contains and one class of thing
 * it might: line comments, block comments, single-quoted literals with doubled
 * quotes inside them. It does not handle dollar-quoted function bodies, because
 * there are none and there will not be — the schema is a short list of counter
 * tables (CLAUDE.md §2.1), and a repository that grows a stored procedure has
 * bigger questions to answer than this file's.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Where the entire server-side data model lives. */
export const SCHEMA_PATH = join(repoRoot, 'lib', 'db', 'schema.sql')

/**
 * The executable statements in a SQL source, with comments removed.
 *
 * @param {string} sql
 * @returns {string[]}
 */
export function splitStatements(sql) {
  const statements = []
  let current = ''
  let index = 0

  while (index < sql.length) {
    const rest = sql.slice(index)

    if (rest.startsWith('--')) {
      // A line comment runs to the newline, which is kept so the statement does
      // not lose the whitespace that separated its words.
      const end = sql.indexOf('\n', index)
      index = end === -1 ? sql.length : end
      continue
    }

    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', index + 2)
      index = end === -1 ? sql.length : end + 2
      // Replaced by a space rather than by nothing: `select/**/1` is two tokens.
      current += ' '
      continue
    }

    if (sql[index] === "'") {
      // Copied through verbatim, terminator and all. A doubled quote inside a
      // literal is an escaped quote, not the end of it.
      const start = index
      index += 1
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2
          continue
        }
        if (sql[index] === "'") {
          index += 1
          break
        }
        index += 1
      }
      current += sql.slice(start, index)
      continue
    }

    if (sql[index] === ';') {
      statements.push(current)
      current = ''
      index += 1
      continue
    }

    current += sql[index]
    index += 1
  }

  // A file whose last statement has no terminator is still a file with a last
  // statement. psql accepts it; dropping it here would silently skip whatever
  // somebody appends to the schema last.
  statements.push(current)

  return statements.map((statement) => statement.trim()).filter((statement) => statement.length > 0)
}

/**
 * `lib/db/schema.sql`, ready to send.
 *
 * @returns {string[]}
 */
export function readSchema() {
  return splitStatements(readFileSync(SCHEMA_PATH, 'utf8'))
}

/**
 * Every table the schema declares, in the order it declares them.
 *
 * `cli.mjs` needs this to say which tables a database is missing and which it
 * has that the schema never asked for. It held the answer as a literal until
 * issue #102 added `page_totals` without touching it, at which point every run
 * reported the new table as unexpected and `--check` stopped verifying it was
 * there at all. A list kept in a second file is a fact with somewhere to drift
 * to; reading it back out of the statements is the same fact with nowhere.
 *
 * @param {string[]} [statements] Defaults to the repository's own schema.
 * @returns {string[]}
 */
export function expectedTables(statements = readSchema()) {
  return statements
    .map((statement) => /create table if not exists (\w+)/i.exec(statement)?.[1])
    .filter((name) => name !== undefined)
}
