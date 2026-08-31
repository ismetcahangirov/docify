/**
 * Hitting a requested output size by searching the encoder's quality scale.
 *
 * "Compress this to under 500 kB" cannot be answered in one shot: no lossy
 * encoder exposes a size dial, and the relationship between quality and bytes
 * depends on the picture. A photograph of foliage and a screenshot of a form
 * encode an order of magnitude apart at the same `Q`. The only honest answer is
 * to encode, look, and adjust — which is what every desktop tool does behind its
 * "target file size" field.
 *
 * The search lives here, apart from any engine, for the same reason `route()`
 * takes `Capabilities` as a parameter: the loop is the part with the edge cases
 * — an unreachable target, an inclusive bound, a bounded number of tries — and
 * it should be provable without a WASM module in the room. The engine supplies
 * `encode`; this module decides what to call it with.
 *
 * ## Why bisection, and why a probe first
 *
 * Output size is monotonic in quality for every lossy codec we write (JPEG,
 * WebP, AVIF), so bisection is exact rather than heuristic. What bisection alone
 * gets wrong is the *common* case: a target set as a safety cap on a file that
 * never approaches it still costs seven full re-encodes to discover that quality
 * 100 was fine. So the top of the range is probed first and the bisection only
 * runs when it does not fit.
 *
 * Each attempt is a complete re-encode of a full-resolution image, which is why
 * the count is capped and stated rather than left to the shape of the data —
 * see {@link TARGET_SIZE_MAX_ATTEMPTS}.
 */

import { MAX_QUALITY, MIN_QUALITY } from './image-options'

/**
 * The most encodes one target-size job may pay for.
 *
 * One for the probe at {@link MAX_QUALITY}, then seven for a bisection over the
 * 99 qualities below it — `log2(99)` is 6.63, so seven steps resolve the range
 * exactly and an eighth would be dead code. Stated as a constant because it is
 * the number the caller budgets its progress reporting against, and because a
 * ceiling that silently truncated the search would return a needlessly small
 * file while claiming to have found the best one.
 */
export const TARGET_SIZE_MAX_ATTEMPTS = 8

/** One encoder pass: what it produced, and how large that turned out to be. */
export interface Encoded<T> {
  output: T
  bytes: number
}

export interface TargetSizeResult<T> {
  /** The winning attempt's output, kept from when it was made rather than re-encoded. */
  output: T
  /** The quality that produced it. */
  quality: number
  /** Its size in bytes. */
  bytes: number
  /**
   * Whether {@link bytes} actually landed at or under the target.
   *
   * `false` means the target was unreachable and this is the smallest file the
   * encoder could make. The job still succeeds — the user asked to compress and
   * this is as compressed as it gets — and the caller is free to say by how much
   * it missed.
   */
  withinTarget: boolean
  /** How many encodes the search spent. Never above {@link TARGET_SIZE_MAX_ATTEMPTS}. */
  attempts: number
}

/**
 * Encodes repeatedly, at most {@link TARGET_SIZE_MAX_ATTEMPTS} times, and
 * returns the highest-quality result at or under `targetBytes`.
 *
 * The bound is inclusive: a file that lands exactly on the target has met it,
 * which is what a user reading "under 500 kB" alongside a 512 000-byte result
 * expects.
 *
 * `encode` must be a pure function of quality for the same source — the search
 * assumes calling it twice with the same argument would produce the same size —
 * and its cost is why nothing here calls it speculatively.
 */
export function encodeToTargetSize<T>(
  targetBytes: number,
  encode: (quality: number) => Encoded<T>,
): TargetSizeResult<T> {
  let attempts = 0
  /** The best fit so far: the highest quality whose output met the target. */
  let fitting: TargetSizeResult<T> | null = null

  function attempt(quality: number): TargetSizeResult<T> {
    const { output, bytes } = encode(quality)
    attempts += 1

    return { output, quality, bytes, withinTarget: bytes <= targetBytes, attempts }
  }

  // The probe. A generous target is the usual case and it ends here.
  const top = attempt(MAX_QUALITY)
  if (top.withinTarget) return top

  /** The fallback for a target nothing could meet: the smallest output seen. */
  let smallest = top
  let low = MIN_QUALITY
  let high = MAX_QUALITY - 1

  while (low <= high && attempts < TARGET_SIZE_MAX_ATTEMPTS) {
    const middle = Math.floor((low + high) / 2)
    const result = attempt(middle)
    if (result.bytes < smallest.bytes) smallest = result

    if (result.withinTarget) {
      fitting = result
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  const best = fitting ?? smallest

  // `attempts` is captured per attempt, so the winner carries the count as it
  // stood when *it* ran. The caller wants what the whole search cost.
  return { ...best, attempts }
}
