import { describe, expect, it } from 'vitest'

import { readSchema, splitStatements } from '../scripts/db-migrate/schema.mjs'

/*
 * The provisioning script's one piece of logic (issue #101).
 *
 * ## Why splitting the DDL is a function and not an inline regular expression
 *
 * `@neondatabase/serverless` speaks over HTTP, and that path takes exactly one
 * statement per request — it is the same constraint that makes it the right
 * driver for a single-statement counter write in `lib/db/neon.ts`. So applying
 * `lib/db/schema.sql` means sending it a statement at a time, which means
 * knowing where one ends.
 *
 * That is the whole risk in provisioning a database from a file: a splitter
 * that gets it wrong sends half a `create table` to production and reports
 * success on the half that parsed. It is pure, it is cheap to test, and the
 * cases below are the ones that would actually reach it — a semicolon inside a
 * comment, a semicolon inside a string literal, a trailing statement with no
 * terminator, and the file the repository really ships.
 *
 * What is deliberately *not* here is a test against a live Postgres. The unit
 * job has no database and should not grow one: `test/db/schema.test.ts` already
 * asserts what the DDL declares, and whether Neon accepts it is answered by
 * running the script, which is what the runbook in docs/backend asks for.
 */

describe('splitStatements', () => {
  it('splits on the semicolons that end statements', () => {
    expect(splitStatements('select 1; select 2;')).toEqual(['select 1', 'select 2'])
  })

  it('keeps a final statement that was never terminated', () => {
    // psql accepts it and so does the driver; dropping it would silently skip
    // whatever somebody appends to the file last.
    expect(splitStatements('select 1;\nselect 2')).toEqual(['select 1', 'select 2'])
  })

  it('drops line comments without dropping the statement around them', () => {
    expect(splitStatements('-- a note; with a semicolon\nselect 1;')).toEqual(['select 1'])
  })

  it('drops block comments without dropping the statement around them', () => {
    expect(splitStatements('/* a note; with a semicolon */ select 1;')).toEqual(['select 1'])
  })

  it('does not split inside a string literal', () => {
    // `check (outcome in ('success', 'failure'))` is the real shape this
    // protects; a semicolon in a default value would be the one that bites.
    expect(splitStatements("insert into t values (';');")).toEqual(["insert into t values (';')"])
  })

  it('understands a doubled quote as an escaped one', () => {
    expect(splitStatements("select 'it''s; fine';")).toEqual(["select 'it''s; fine'"])
  })

  it('returns nothing for a file that is only comments and whitespace', () => {
    expect(splitStatements('-- nothing here\n\n/* nor here */\n')).toEqual([])
  })
})

describe('readSchema', () => {
  it('reads lib/db/schema.sql as one statement per object it declares', () => {
    // Named rather than counted, so a `create` that stopped being split out —
    // or one that appeared without anybody meaning it to — is visible here
    // rather than as a silently shorter list.
    expect(readSchema().map((statement) => statement.split('\n')[0].trim())).toEqual([
      'create table if not exists conversion_totals (',
      'create index if not exists conversion_totals_day_idx',
      'create table if not exists page_totals (',
    ])
  })

  it('carries no comment text into what gets sent to the server', () => {
    // The file is four fifths prose. Sending it would work, and it would also
    // put the reasoning about PII into a server log somebody else operates.
    for (const statement of readSchema()) {
      expect(statement).not.toContain('--')
      expect(statement).not.toContain('/*')
    }
  })

  it('sends only idempotent statements, so re-provisioning is not an error', () => {
    // The deploy runbook applies this on every schema change, and a second
    // apply has to be a no-op rather than a failure somebody works around.
    for (const statement of readSchema()) {
      expect(statement.toLowerCase()).toContain('if not exists')
    }
  })
})
