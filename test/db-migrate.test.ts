import { describe, expect, it } from 'vitest'

import {
  classify,
  expectedTables,
  readSchema,
  splitStatements,
} from '../scripts/db-migrate/schema.mjs'

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
      'drop index if exists conversion_totals_day_idx',
      'create index if not exists conversion_totals_outcome_idx',
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
    // `if not exists` on what the file creates, `if exists` on what it drops:
    // both are the same property, and a statement with neither breaks it.
    for (const statement of readSchema()) {
      expect(statement.toLowerCase()).toMatch(/\bif (not )?exists\b/)
    }
  })
})

describe('expectedTables', () => {
  /*
   * The names the schema declares, read from the schema.
   *
   * `cli.mjs` used to hold the list as a literal, and issue #102 added a table
   * without touching it — so every run since has reported `page_totals` as an
   * unexpected table, and `--check` never verified it was there at all. A
   * literal in a second file is a fact that can go stale silently; scanning the
   * statements is the same fact with nowhere to drift to.
   */
  it('names every table lib/db/schema.sql declares', () => {
    expect(expectedTables()).toEqual(['conversion_totals', 'page_totals'])
  })

  it('reads the names from the statements it is given', () => {
    expect(
      expectedTables([
        'create table if not exists widgets (\n  id text not null\n)',
        'create index if not exists widgets_id_idx on widgets (id)',
      ]),
    ).toEqual(['widgets'])
  })

  it('names nothing for a schema that creates no table', () => {
    expect(expectedTables(['select 1'])).toEqual([])
  })

  it('reads a name the way Postgres would rather than the way the file writes it', () => {
    // Not what `lib/db/schema.sql` looks like today, and that is the point: a
    // scanner that only understands the current formatting silently returns
    // nothing — or the schema name — the day somebody reformats a statement.
    expect(
      expectedTables(['CREATE  TABLE   IF NOT EXISTS  public.widgets (\n  id text not null\n)']),
    ).toEqual(['widgets'])
  })
})

describe('classify', () => {
  /*
   * The comparison `cli.mjs` prints, lifted out of it.
   *
   * It is the defect issue #271 reports — a database was told it held an
   * unexpected table because the script knew one name — and it lived in a
   * function that can only be reached with a live Postgres behind it. Split out,
   * the classification is a pure comparison of two lists of strings, and the
   * shape that matters (a table the schema declares that the database has, and
   * therefore is neither missing nor unexpected) costs three lines to hold.
   */
  it('finds nothing wrong with a database that holds exactly the schema', () => {
    expect(
      classify(['conversion_totals', 'page_totals'], ['conversion_totals', 'page_totals']),
    ).toEqual({ missing: [], unexpected: [] })
  })

  it('names every table the schema declares and the database lacks', () => {
    expect(classify(['conversion_totals'], ['conversion_totals', 'page_totals'])).toEqual({
      missing: ['page_totals'],
      unexpected: [],
    })
  })

  it('names a table nobody declared, and does not call a declared one unexpected', () => {
    // The regression this file exists for: `page_totals` is in the schema, so
    // its presence is never a note the operator has to think about.
    expect(
      classify(
        ['conversion_totals', 'page_totals', 'somebody_elses_table'],
        ['conversion_totals', 'page_totals'],
      ),
    ).toEqual({ missing: [], unexpected: ['somebody_elses_table'] })
  })

  it('reports both at once for a database that is wrong in both directions', () => {
    expect(classify(['leftovers'], ['conversion_totals'])).toEqual({
      missing: ['conversion_totals'],
      unexpected: ['leftovers'],
    })
  })
})
