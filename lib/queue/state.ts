/**
 * The life of one job, as a table rather than as scattered `if`s.
 *
 * A conversion passes through six states and there is exactly one legal way
 * between any two of them. Written as conditions spread through a component,
 * that invariant survives about a week: a late progress tick from a job the user
 * cancelled sets it back to `processing`, a result that arrives after a failure
 * marks it `done`, and the list shows a bar moving on a job nobody is running.
 * Both of those are ordinary races — the worker is on another thread and its
 * messages do not stop arriving because the main thread changed its mind.
 *
 * So the table below is the whole rule, `transition()` is the only way to move,
 * and an event that does not appear against the current state is **ignored**
 * rather than applied or thrown. Ignoring is the deliberate part: a message
 * about a job that has moved on is not a bug to crash over, it is the normal
 * consequence of two threads, and the right answer is to drop it.
 *
 * ## Why cancelling returns a job to `queued`
 *
 * There is no `cancelled` state. A cancelled job is one nobody is running yet,
 * which is exactly what `queued` means, and it leaves the file in the list where
 * the user can start it again — a dead end would make them drop the file a
 * second time. It also keeps the state set to the six the UI has to render,
 * rather than seven with one of them a synonym.
 */

/** Every state a job can be in. */
export type JobState =
  /** In the list, nothing has happened yet. Also where a cancelled job returns. */
  | 'queued'
  /** `route()` is choosing an engine. */
  | 'routing'
  /** The chosen engine's binary is downloading. */
  | 'loading-engine'
  /** The engine is working on the file. */
  | 'processing'
  /** Finished, with a file to download. */
  | 'done'
  /** Refused or broken, with a message that says why. */
  | 'failed'

/** Everything that can happen to a job. */
export type JobEvent =
  /** The user, or the queue, started it. */
  | 'start'
  /** An engine was chosen. */
  | 'routed'
  /** The engine is loaded and about to run. */
  | 'loaded'
  | 'succeed'
  | 'fail'
  /** The user stopped it, or the worker died under it. */
  | 'cancel'
  /** The user asked for another go at a job that has finished. */
  | 'retry'

/**
 * Every legal move. A state's entry lists the events it answers, and anything
 * absent is impossible by construction rather than by convention.
 *
 * `fail` appears against every running state because a job can break at any
 * point — the router can refuse it, the engine's download can 404, the engine
 * itself can throw — and each of those has to end somewhere the user is told
 * about.
 */
export const TRANSITIONS: Readonly<
  Record<JobState, Readonly<Partial<Record<JobEvent, JobState>>>>
> = {
  queued: { start: 'routing' },
  routing: { routed: 'loading-engine', fail: 'failed', cancel: 'queued' },
  'loading-engine': { loaded: 'processing', fail: 'failed', cancel: 'queued' },
  processing: { succeed: 'done', fail: 'failed', cancel: 'queued' },
  // Terminal until the user says otherwise. `retry` is the only way out, and
  // it goes back to the start rather than to the middle: the device may have
  // changed, so the engine has to be chosen again.
  done: { retry: 'queued' },
  failed: { retry: 'queued' },
}

/**
 * The state `event` leads to from `state`, or `null` when it leads nowhere.
 *
 * `null` is the answer for a late message, and callers are expected to drop it
 * silently. See the module header for why that is a design decision and not a
 * swallowed error.
 */
export function transition(state: JobState, event: JobEvent): JobState | null {
  return TRANSITIONS[state][event] ?? null
}

/** Whether `event` can be applied to a job in `state` at all. */
export function canTransition(state: JobState, event: JobEvent): boolean {
  return transition(state, event) !== null
}

/** Whether the job has finished, one way or the other. */
export function isFinished(state: JobState): boolean {
  return state === 'done' || state === 'failed'
}

/**
 * Whether work is actually happening, which is what "cancel" is offered for and
 * what a progress bar belongs to.
 */
export function isRunning(state: JobState): boolean {
  return state === 'routing' || state === 'loading-engine' || state === 'processing'
}
