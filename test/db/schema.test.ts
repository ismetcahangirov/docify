import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { OUTCOMES, SIZE_BUCKETS } from '@/lib/db/events'

/*
 * `lib/db/schema.sql` is the only place a Docify server writes anything down,
 * so it is the one file where "no PII" has to be a property rather than an
 * intention (CLAUDE.md §2.1, plan §10.1).
 *
 * These assertions read the DDL as text. That is deliberate: a test that needed
 * a live Postgres would not run in the unit job, and the invariant worth
 * guarding is not "the DDL is valid" — Neon will say so — but "the DDL declares
 * nothing that could identify anybody". A column that does not exist cannot be
 * filled in by a later route handler, and this file is what stops one appearing.
 *
 * ## Why the structural rules are applied per table
 *
 * They were written against a single table and asserted against the first one
 * they found. `page_totals` (issue #102) made that a real gap rather than a
 * theoretical one: a greedy match across two `create table` statements reads
 * their columns as one list, and every rule downstream of it becomes vague.
 *
 * So the DDL is split into tables first, and each rule runs over each of them.
 * `TABLES` is the allowlist: a third table fails this file until somebody adds
 * it here, which is the point. Growing the data model should cost a decision.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const schema = readFileSync(join(repoRoot, 'lib', 'db', 'schema.sql'), 'utf8')

/** The DDL with comments stripped, so prose cannot satisfy a structural test. */
const ddl = schema.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

/** Every table the data model is allowed to have. */
const TABLES = ['conversion_totals', 'page_totals'] as const

/** Each table's `create table` body, keyed by name. */
const bodies = new Map(
  [...ddl.matchAll(/create table if not exists (\w+)\s*\(([\s\S]*?)\n\)\s*;/g)].map((match) => [
    match[1],
    match[2],
  ]),
)

/** Every column declared in one table, in declaration order. */
function columnsOf(table: string): string[] {
  return [...(bodies.get(table) ?? '').matchAll(/^\s{2}([a-z_]+)\s+(?:date|text|bigint)/gm)].map(
    (match) => match[1],
  )
}

/**
 * Words that have no business in an anonymous counter table.
 *
 * Matched against the whole DDL rather than only the column list, so a
 * `create index` or a second table added later is caught by the same net.
 */
const FORBIDDEN = [
  'ip',
  'addr',
  'user',
  'email',
  'name',
  'file',
  'path',
  'session',
  'agent',
  'referer',
  'referrer',
  'country',
  'city',
  'fingerprint',
  'hash',
  'token',
]

describe('lib/db/schema.sql', () => {
  it('declares exactly the tables the data model is allowed to have', () => {
    expect([...bodies.keys()]).toEqual([...TABLES])
    expect(ddl.match(/create table/gi) ?? []).toHaveLength(TABLES.length)
  })

  it('names nothing that could identify anybody', () => {
    const words = new Set(ddl.toLowerCase().match(/[a-z_]+/g) ?? [])

    for (const forbidden of FORBIDDEN) {
      expect([...words].filter((word) => word.split('_').includes(forbidden))).toEqual([])
    }
  })

  it.each(TABLES)('stores the date only in %s, never a time', (table) => {
    // A timestamp is a fingerprint on a quiet day; a date is not.
    expect(bodies.get(table)).toMatch(/^\s{2}day\s+date\b/m)
  })

  it('declares no time column anywhere', () => {
    expect(ddl).not.toMatch(/timestamptz|timestamp\b|time\b/i)
  })

  it.each(TABLES)('counts %s with a non-negative bigint', (table) => {
    expect(bodies.get(table)).toMatch(/^\s{2}total\s+bigint\s+not null default 0/m)
    expect(bodies.get(table)).toMatch(/check \(total >= 0\)/i)
  })

  it.each(TABLES)('declares every column of %s not null, so no row means "unknown"', (table) => {
    const declarations = [
      ...(bodies.get(table) ?? '').matchAll(/^\s{2}[a-z_]+\s+(?:date|text|bigint)[^,\n]*/gm),
    ]

    expect(declarations.length).toBeGreaterThan(0)
    for (const [declaration] of declarations) expect(declaration).toMatch(/not null/i)
  })

  it.each(TABLES)('keys %s on its dimensions, so a row is a group and never a person', (table) => {
    const key = bodies
      .get(table)
      ?.match(/primary key \(([^)]*)\)/i)?.[1]
      .split(',')
      .map((column) => column.trim())

    // Every column except the counter itself. A key that left one out would
    // mean rows that differ in a dimension nobody can see.
    expect(key).toEqual(columnsOf(table).filter((column) => column !== 'total'))
  })

  it('describes a conversion with the four dimensions and nothing else', () => {
    expect(columnsOf('conversion_totals')).toEqual([
      'pair',
      'outcome',
      'size_bucket',
      'day',
      'total',
    ])
  })

  it('constrains outcome to the two values the client can send', () => {
    for (const outcome of OUTCOMES) expect(ddl).toContain(`'${outcome}'`)
    expect(ddl).toMatch(/check \(outcome in \('success', 'failure'\)\)/i)
  })

  it('constrains size_bucket to the five buckets the client can send', () => {
    for (const bucket of SIZE_BUCKETS) expect(ddl).toContain(`'${bucket}'`)
    expect(ddl).toMatch(/check \(size_bucket in \('xs', 's', 'm', 'l', 'xl'\)\)/i)
  })

  it('describes a page view with a page and a day and nothing else', () => {
    // No referrer, no entry page, no duration, no visitor of any kind. Two
    // people opening a page and one person opening it twice are the same row,
    // and there is deliberately no way to ask which happened.
    expect(columnsOf('page_totals')).toEqual(['page', 'day', 'total'])
  })

  it('is idempotent, so applying it twice is not an error', () => {
    expect(ddl.match(/create table/gi) ?? []).toHaveLength(
      (ddl.match(/create table if not exists/gi) ?? []).length,
    )
    for (const [statement] of ddl.matchAll(/create index[^;]*/gi)) {
      expect(statement).toMatch(/if not exists/i)
    }
    // The same rule from the other side. A bare `drop` is the one statement
    // that turns a second `pnpm db:migrate` into an error, and this file is
    // where it would have to be added.
    for (const [statement] of ddl.matchAll(/drop [^;]*/gi)) {
      expect(statement).toMatch(/if exists/i)
    }
  })

  it('indexes what GET /api/stats reads and nothing else', () => {
    /*
     * `readTotals` in lib/db/stats.ts sums all time filtered by `outcome`, and
     * that is the only query on a hot path. The `(day desc)` index that used to
     * be here served a "recent days" read nothing ever performed.
     *
     * `page_totals` has no hot reader either — `pnpm analytics` runs once, by
     * hand — and an index added before there is a query to serve is a guess.
     */
    expect(ddl.match(/create index/gi) ?? []).toHaveLength(1)
    expect(ddl).toMatch(/on conversion_totals \(outcome\)/i)
  })

  it('drops the index it used to declare, so an old database loses it too', () => {
    // The schema is applied to a live database rather than replacing one, so a
    // statement that removes what a previous version created is the only way an
    // index stops existing anywhere but a fresh provision.
    expect(ddl).toMatch(/drop index if exists conversion_totals_day_idx/i)
  })
})
