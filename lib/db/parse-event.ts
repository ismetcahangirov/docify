import { type ConversionEvent, OUTCOMES, SIZE_BUCKETS } from './events'

import { PAIR_SLUGS } from '@/lib/registry/pairs'

/**
 * The only way an event gets from a request into `lib/db/stats.ts`.
 *
 * ## Why the pair is validated against the registry
 *
 * `pair` is the one field that *looks* like free text. Left as a string, the
 * route handler would happily persist whatever a client sent — and the first
 * thing an unfriendly client sends to a `text` column is something that should
 * never have been written down. Checking it against `PAIR_SLUGS` closes that:
 * the column's domain becomes the same 125 values as the site's own routes, so
 * the strongest statement about the database is a structural one. There is
 * nothing in it that `app/sitemap.ts` did not already publish.
 *
 * ## Why a surplus field is a refusal
 *
 * Stripping unknown keys would work, and would be wrong. A client sending
 * `referrer` has misunderstood the contract; answering it with 202 lets the
 * misunderstanding grow until somebody assumes the field is being recorded.
 * A refusal is the only answer that stays true.
 *
 * Server-side only. It pulls in the registry, which is why it is not in
 * `lib/db/events.ts` alongside the vocabulary the browser also uses.
 */

/** The fields an event may carry. Anything else is a refusal, not a strip. */
const FIELDS = ['pair', 'outcome', 'bucket'] as const

/** Whether `value` is one of the members of `allowed`. */
function isMember<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/**
 * The event `value` describes, or `null` when it describes none.
 *
 * A `null` here is the difference between a counter table whose contents are
 * entirely predictable from the sitemap and one whose contents are whatever a
 * client felt like sending.
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
