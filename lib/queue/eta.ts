/**
 * How much longer, and when it is honest to say so.
 *
 * The arithmetic is the easy half. The hard half is knowing when to keep quiet:
 * an estimate is a promise, and a converter that says "about 4 seconds left" and
 * then takes a minute has told the user something false about their own machine.
 * Two guards decide that, and both are the point of this module:
 *
 * - **Nothing before {@link MIN_ELAPSED_MS}.** The first fraction arrives while
 *   the engine is still warming its heap, so it describes a rate that no longer
 *   exists a second later.
 * - **Nothing under {@link MIN_PROGRESS}.** Dividing by a very small fraction
 *   turns a hundred milliseconds of noise into hours. That is where the
 *   ridiculous first estimate every download manager used to show came from.
 *
 * Both answer `null`, which is a real answer: "working" with no number is
 * honest, and a bar that is moving already says the rest.
 *
 * ## Why linear, and why that is not a cop-out
 *
 * Remaining time is elapsed time scaled by how much is left. A weighted average
 * of recent throughput would ride out a stall better, and it needs a history per
 * job and a clock the reducer does not have. It is also solving the wrong
 * problem: these engines do not have a variable rate so much as a few discrete
 * phases, and no smoothing survives a phase change. Linear plus the two guards
 * is understandable, and understandable is what an estimate has to be.
 */

/** Nothing is claimed until the job has been running this long. */
export const MIN_ELAPSED_MS = 1_500

/** Nor until this much of it is done, because the division explodes below it. */
export const MIN_PROGRESS = 0.03

/** What the estimate is read off. Every field is one the queue already holds. */
export interface EtaSource {
  /** `0..1`, `-1` for indeterminate, or `null` before anything reported. */
  progress: number | null
  /** When the job left `queued`, in epoch milliseconds. */
  startedAt?: number
}

/**
 * Milliseconds still to go, or `null` when no honest number can be given.
 *
 * `null` covers all four ways of not knowing — the job has not started, nothing
 * has reported, the engine cannot measure itself, or it is too early to divide.
 * The caller renders "working" for every one of them, which is the same thing
 * the user needs to see in each.
 */
export function remainingMs(source: EtaSource, now: number): number | null {
  const { progress, startedAt } = source
  if (startedAt === undefined || progress === null || progress <= 0) return null

  const elapsed = now - startedAt
  if (elapsed < MIN_ELAPSED_MS) return null
  if (progress < MIN_PROGRESS) return null

  const done = Math.min(progress, 1)
  if (done >= 1) return 0

  return Math.max(0, Math.round((elapsed * (1 - done)) / done))
}

/**
 * A duration as a person would say it.
 *
 * Deliberately vague, and vaguer the further out it goes: "about 3 minutes left"
 * is a claim anyone can live with, and "about 187 seconds left" is a claim
 * precise enough to be wrong. Rounded up rather than to nearest, because
 * finishing early is a pleasant surprise and finishing late is a broken promise.
 */
export function formatRemaining(ms: number): string {
  if (ms < 5_000) return 'a few seconds left'

  const seconds = Math.ceil(ms / 1_000)
  if (seconds < 60) return `about ${roundedTo(seconds, 5)} seconds left`

  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'} left`

  return 'over an hour left'
}

/** The whole estimate as one line, or `null` when there is nothing honest to say. */
export function etaLabel(source: EtaSource, now: number): string | null {
  const remaining = remainingMs(source, now)

  return remaining === null ? null : formatRemaining(remaining)
}

/** `value` rounded up to the next multiple of `step`, so a ticking number is calm. */
function roundedTo(value: number, step: number): number {
  return Math.max(step, Math.ceil(value / step) * step)
}
