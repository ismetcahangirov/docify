/**
 * What a Docify server is allowed to know about a conversion.
 *
 * Three fields, all of them closed vocabularies. That is the whole design, and
 * it is what makes CLAUDE.md §2.1 checkable rather than aspirational: a counter
 * table cannot leak what it has no column to hold, and a column cannot hold a
 * file name if the only values that reach it come from a list of 125 slugs, a
 * list of five buckets and a list of two outcomes.
 *
 * ## Why the pair is validated against the registry
 *
 * `pair` is the one field that *looks* like free text. Left as a string, the
 * route handler would happily persist whatever a client sent — and the first
 * thing an unfriendly client sends to a `text` column is something that should
 * never have been written down. Checking it against `PAIR_SLUGS` closes that:
 * the column's domain is the same 125 values as the site's own routes, so the
 * strongest statement about the database is a structural one. There is nothing
 * in it that was not already public in `app/sitemap.ts`.
 *
 * ## Why a surplus field is a refusal
 *
 * Stripping unknown keys would work, and would be wrong. A client sending
 * `referrer` has misunderstood the contract; answering it with 202 lets the
 * misunderstanding grow until somebody assumes the field is being recorded.
 * A refusal is the only answer that stays true.
 *
 * Pure, and free of any database import — `lib/db/stats.ts` is what talks to
 * Neon, and everything worth arguing about is decided here first.
 */

import { PAIR_SLUGS } from '@/lib/registry/pairs'

/** How a conversion ended. Two values; there is no third. */
export const OUTCOMES = ['success', 'failure'] as const

export type Outcome = (typeof OUTCOMES)[number]

/**
 * How large the source file was, to within an order of magnitude.
 *
 * Deliberately coarse. A byte count is close to unique for a given file, and a
 * byte count paired with a format and a day is close to unique for a given
 * *person*. Five buckets over four orders of magnitude answer the only question
 * the figures need to answer — whether the engines are being asked for small
 * files or large ones — and answer nothing else.
 */
export const SIZE_BUCKETS = ['xs', 's', 'm', 'l', 'xl'] as const

export type SizeBucket = (typeof SIZE_BUCKETS)[number]

/** The upper bound of each bucket in bytes, in the order of `SIZE_BUCKETS`. */
const BUCKET_CEILINGS = [1_000_000, 10_000_000, 100_000_000, 1_000_000_000] as const

/** One anonymous conversion, as the client reports it and the counter stores it. */
export interface ConversionEvent {
  /** A slug from `lib/registry/pairs.ts`: `heic-to-jpg`. */
  pair: string
  outcome: Outcome
  bucket: SizeBucket
}

/** The fields an event may carry. Anything else is a refusal, not a strip. */
const FIELDS = ['pair', 'outcome', 'bucket'] as const

/**
 * Which bucket a source file of `bytes` falls in.
 *
 * A size that is negative or not a number lands in `xs` rather than throwing:
 * this runs on the way out of a finished conversion, and a bad number there is
 * a reason to report a slightly wrong bucket, never a reason to break the
 * conversion the user is looking at.
 */
export function sizeBucket(bytes: number): SizeBucket {
  if (!Number.isFinite(bytes) || bytes < 0) return SIZE_BUCKETS[0]

  const index = BUCKET_CEILINGS.findIndex((ceiling) => bytes < ceiling)

  return index === -1 ? SIZE_BUCKETS[SIZE_BUCKETS.length - 1] : SIZE_BUCKETS[index]
}

/** Whether `value` is one of the members of `allowed`. */
function isMember<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/**
 * The event `value` describes, or `null` when it describes none.
 *
 * The only way into `lib/db/stats.ts`. A `null` here is the difference between
 * a counter table whose contents are entirely predictable from the sitemap and
 * one whose contents are whatever a client felt like sending.
 */
export function parseConversionEvent(value: unknown): ConversionEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const keys = Object.keys(value)
  if (keys.length !== FIELDS.length || !FIELDS.every((field) => keys.includes(field))) return null

  const { pair, outcome, bucket } = value as Record<(typeof FIELDS)[number], unknown>

  if (typeof pair !== 'string' || !PAIR_SLUGS.includes(pair)) return null
  if (!isMember(OUTCOMES, outcome)) return null
  if (!isMember(SIZE_BUCKETS, bucket)) return null

  return { pair, outcome, bucket }
}
