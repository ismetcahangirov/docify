import { type Outcome, sizeBucket } from '@/lib/db/events'
import { pairSlug } from '@/lib/registry/slugs'
import type { ConversionTask } from '@/lib/router/types'

/**
 * Tells the server that a conversion happened, and nothing else about it.
 *
 * ## What goes on the wire
 *
 * Three fields: the pair, whether it worked, and a size bucket. CLAUDE.md §2.1
 * names `navigator.sendBeacon` as one of the APIs a file must never travel on,
 * and the way that stays true is that this module is the only thing in the app
 * that calls it — `test/stats/report.test.ts` decodes the beacon body and fails
 * on a fourth key, on a raw byte count, or on anything that is not one of those
 * three.
 *
 * The bucket rather than the size is the whole point. A byte count is close to
 * unique for a given file; five buckets across four orders of magnitude answer
 * the only question the figures need to answer.
 *
 * ## Why it returns nothing
 *
 * Fire-and-forget is a property of the caller, and this is where it is
 * enforced. There is no promise to await, so no conversion can wait on the
 * network, and no rejection can surface as a failed job. Every failure mode —
 * a blocked beacon, an extension that throws, a browser with no `sendBeacon` —
 * ends here silently. That is also what makes #86 true: with the backend
 * unreachable, this function does nothing observable at all.
 *
 * No `sendBeacon` means no report, rather than a fetch instead. The fallback
 * only fires when the beacon *exists and refuses* — typically because the
 * browser's queue is full — which is a real condition worth retrying. Reaching
 * for `fetch` where `sendBeacon` was never there would put a network request on
 * the page of every environment that lacks it, including the test renderer.
 */

/** Where the counter lives. Same origin, so it crosses no isolation boundary. */
const ENDPOINT = '/api/stats'

/** Never throws, never returns a promise, never blocks a conversion. */
export function reportConversion(
  task: Pick<ConversionTask, 'from' | 'to'>,
  bytes: number,
  outcome: Outcome,
): void {
  const body = JSON.stringify({
    pair: pairSlug(task.from, task.to),
    outcome,
    bucket: sizeBucket(bytes),
  })

  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return

    if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return

    void fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => {
      // The conversion already succeeded or failed on its own terms. Whether
      // the counter heard about it is not the user's problem.
    })
  } catch {
    // A blocked beacon, a locked-down extension environment, a browser that
    // throws on a Blob body. All of them are "the count is one lower than it
    // could have been", and none of them is worth a line in the console.
  }
}
