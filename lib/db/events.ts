/**
 * What a Docify server is allowed to know about a conversion.
 *
 * Three fields, all of them closed vocabularies. That is the whole design, and
 * it is what makes CLAUDE.md §2.1 checkable rather than aspirational: a counter
 * table cannot leak what it has no column to hold, and a column cannot hold a
 * file name if the only values that reach it come from a list of 125 slugs, a
 * list of five buckets and a list of two outcomes.
 *
 * ## Why the validation is next door
 *
 * This module is the *vocabulary*, and both sides of the wire share it — the
 * browser builds an event here, the route handler checks one. `PAIR_SLUGS` is
 * the registry, and the registry is not something a converter page should be
 * dragging into its client bundle for the sake of one counter. So the check
 * against it lives in `lib/db/parse-event.ts`, which only the server imports,
 * and this file stays pure constants and one pure function.
 *
 * Pure, and free of any database import — `lib/db/stats.ts` is what talks to
 * Neon, and everything worth arguing about is decided here first.
 */

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
