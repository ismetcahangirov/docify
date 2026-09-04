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
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const schema = readFileSync(join(repoRoot, 'lib', 'db', 'schema.sql'), 'utf8')

/** The DDL with comments stripped, so prose cannot satisfy a structural test. */
const ddl = schema.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

/** Every column declared in the one table, in declaration order. */
const columns = (() => {
  const body = ddl.match(/create table[^(]*\(([\s\S]*)\)\s*;/i)?.[1] ?? ''
  return [...body.matchAll(/^\s{2}([a-z_]+)\s+(?:date|text|bigint|timestamptz)/gm)].map(
    (match) => match[1],
  )
})()

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
  it('declares exactly one table', () => {
    expect(ddl.match(/create table/gi) ?? []).toHaveLength(1)
    expect(ddl).toMatch(/create table if not exists conversion_totals/i)
  })

  it('declares only the five documented columns', () => {
    expect(columns).toEqual(['pair', 'outcome', 'size_bucket', 'day', 'total'])
  })

  it('names nothing that could identify anybody', () => {
    const words = new Set(ddl.toLowerCase().match(/[a-z_]+/g) ?? [])

    for (const forbidden of FORBIDDEN) {
      expect([...words].filter((word) => word.split('_').includes(forbidden))).toEqual([])
    }
  })

  it('keys the counter on the four dimensions, so a row is a group and never a person', () => {
    expect(ddl).toMatch(/primary key \(pair, outcome, size_bucket, day\)/i)
  })

  it('constrains outcome to the two values the client can send', () => {
    for (const outcome of OUTCOMES) expect(ddl).toContain(`'${outcome}'`)
    expect(ddl).toMatch(/check \(outcome in \('success', 'failure'\)\)/i)
  })

  it('constrains size_bucket to the five buckets the client can send', () => {
    for (const bucket of SIZE_BUCKETS) expect(ddl).toContain(`'${bucket}'`)
    expect(ddl).toMatch(/check \(size_bucket in \('xs', 's', 'm', 'l', 'xl'\)\)/i)
  })

  it('stores the date only, never a time', () => {
    // A timestamp is a fingerprint on a quiet day; a date is not.
    expect(ddl).toMatch(/^\s{2}day\s+date\b/m)
    expect(ddl).not.toMatch(/timestamptz|timestamp\b|time\b/i)
  })

  it('counts with a non-negative bigint', () => {
    expect(ddl).toMatch(/^\s{2}total\s+bigint\s+not null default 0/m)
    expect(ddl).toMatch(/check \(total >= 0\)/i)
  })

  it('declares every column not null, so no row can mean "unknown"', () => {
    const body = ddl.match(/create table[^(]*\(([\s\S]*)\)\s*;/i)?.[1] ?? ''
    const declarations = [...body.matchAll(/^\s{2}[a-z_]+\s+(?:date|text|bigint)[^,\n]*/gm)]

    expect(declarations).toHaveLength(5)
    for (const [declaration] of declarations) expect(declaration).toMatch(/not null/i)
  })

  it('is idempotent, so applying it twice is not an error', () => {
    expect(ddl).toMatch(/create table if not exists/i)
    for (const [statement] of ddl.matchAll(/create index[^;]*/gi)) {
      expect(statement).toMatch(/if not exists/i)
    }
  })

  it('indexes what GET /api/stats reads and nothing else', () => {
    expect(ddl.match(/create index/gi) ?? []).toHaveLength(1)
    expect(ddl).toMatch(/on conversion_totals \(day desc\)/i)
  })
})
