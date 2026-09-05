/**
 * The list of jobs, and the one function allowed to change it.
 *
 * A pure reducer over an immutable array, for the same reason `./state` is a
 * table: everything that touches this list arrives from somewhere with its own
 * timing — a drop, a click, a worker on another thread — and the only way to
 * keep those from writing over each other is to funnel them through one place
 * that can decide what is legal.
 *
 * Nothing here reads a clock or mints an id. `Date.now()` inside a reducer makes
 * every elapsed-time assertion a race against the test runner, and an id
 * generated here would change on every replay. Both arrive on the action, from
 * `components/converter/use-file-queue`, which is the impure half by design.
 */

import type { EngineId, RejectionCode, Warning } from '@/lib/router/types'

import type { JobEvent, JobState } from './state'
import { isFinished, transition } from './state'

/** Why a job stopped, in words the user can act on. */
export interface JobFailure {
  /** What went wrong, in the user's terms and with concrete numbers. */
  message: string
  /**
   * A concrete next step.
   *
   * Always present for a router rejection — CLAUDE.md §2.5 makes it a compile
   * error to build one without — and absent only where an engine threw
   * something we can quote but cannot advise on.
   */
  suggestion?: string
  /** The router's code, where the router is what refused. */
  code?: RejectionCode
}

/** One file on its way through the app. */
export interface QueuedJob {
  /** Stable for the job's whole life, and the key the list renders on. */
  id: string
  file: File
  state: JobState
  /**
   * Fractional completion in `0..1`, `-1` while an engine that cannot measure
   * itself is working, or `null` before anything has reported.
   *
   * `null` and `-1` are different things: nothing has happened yet, against
   * something is happening and cannot say how far along it is.
   */
  progress: number | null
  /** The engine `route()` chose, once it has. */
  engine?: EngineId
  /** Why that engine was chosen, in words. */
  reason?: string
  /** What the user should know about a job that is going to run anyway. */
  warnings?: readonly Warning[]
  /** The converted file, once there is one. */
  result?: Blob
  failure?: JobFailure
  /** When the job left `queued`, in epoch milliseconds. The clock an ETA runs on. */
  startedAt?: number
  /** When it reached `done` or `failed`. */
  endedAt?: number
}

/**
 * The fields an event may carry with it.
 *
 * Deliberately not `Partial<QueuedJob>`: `id`, `file` and `state` are the
 * reducer's own business, and a patch that could set `state` would be a second
 * way to move a job — the one thing `./state` exists to prevent.
 */
export type JobPatch = Partial<
  Pick<QueuedJob, 'engine' | 'reason' | 'warnings' | 'result' | 'failure' | 'progress'>
>

export type QueueAction =
  /** Put files in the list. Ids and the arrival time come from the caller. */
  | { type: 'add'; jobs: readonly QueuedJob[] }
  /** Move one job along, optionally recording what the step produced. */
  | { type: 'advance'; id: string; event: JobEvent; at: number; patch?: JobPatch }
  /** A tick from the worker. Dropped unless the job is actually running. */
  | { type: 'progress'; id: string; progress: number }
  | { type: 'remove'; id: string }
  /** Drop everything that has finished, leaving whatever is still in flight. */
  | { type: 'clearFinished' }

/** A job in its starting state. The caller supplies the id; see the module header. */
export function createJob(id: string, file: File): QueuedJob {
  return { id, file, state: 'queued', progress: null }
}

/**
 * The queue after `action`.
 *
 * Returns the *same array* when nothing changed, so a component that memoises on
 * identity does not re-render for a message that was dropped. That matters more
 * than it looks: progress ticks arrive several times a second per job, and the
 * ones aimed at a job that has already finished are exactly the ones that must
 * cost nothing.
 */
export function queueReducer(
  jobs: readonly QueuedJob[],
  action: QueueAction,
): readonly QueuedJob[] {
  switch (action.type) {
    case 'add':
      return action.jobs.length === 0 ? jobs : [...jobs, ...action.jobs]

    case 'advance':
      return replace(jobs, action.id, (job) => advance(job, action))

    case 'progress':
      return replace(jobs, action.id, (job) => report(job, action.progress))

    case 'remove': {
      const kept = jobs.filter((job) => job.id !== action.id)

      return kept.length === jobs.length ? jobs : kept
    }

    case 'clearFinished': {
      const kept = jobs.filter((job) => !isFinished(job.state))

      return kept.length === jobs.length ? jobs : kept
    }

    default:
      return unhandled(action)
  }
}

/**
 * One job moved along, or the job untouched when the move is impossible.
 *
 * The `null` from `transition` is the late-message case the state table exists
 * for: a result that arrives after a cancel, a tick after a failure.
 */
function advance(job: QueuedJob, action: Extract<QueueAction, { type: 'advance' }>): QueuedJob {
  const next = transition(job.state, action.event)
  if (next === null) return job

  const moved: QueuedJob = { ...job, ...action.patch, state: next }

  if (action.event === 'start') {
    // A fresh run, so nothing is carried over from the last one: a stale
    // failure under a running bar is worse than no explanation at all.
    return {
      ...moved,
      progress: null,
      startedAt: action.at,
      endedAt: undefined,
      result: action.patch?.result,
      failure: action.patch?.failure,
      engine: action.patch?.engine,
      reason: action.patch?.reason,
      warnings: action.patch?.warnings,
    }
  }

  if (isFinished(next)) return { ...moved, endedAt: action.at }

  if (action.event === 'cancel') {
    // Back to the start, and back to knowing nothing: the engine it had chosen
    // may not be the one it gets next time.
    return { ...moved, progress: null, startedAt: undefined, endedAt: undefined }
  }

  if (action.event === 'retry') {
    // Back to `queued`, and the old outcome goes with it. A retried job may
    // wait its turn behind another one (issue #263), and a "Waiting" card that
    // still explains a failure looks like a retry that did nothing.
    return {
      ...moved,
      progress: null,
      startedAt: undefined,
      endedAt: undefined,
      result: undefined,
      failure: undefined,
      engine: undefined,
      reason: undefined,
      warnings: undefined,
    }
  }

  return moved
}

/**
 * A progress tick applied, or the job untouched.
 *
 * Ignored unless the job is in `processing`: an engine reports while it works,
 * and a tick against any other state is a message that outlived the job it
 * belonged to. Values are clamped rather than refused, because `-1` is a
 * meaningful report and a fraction slightly over 1 is a rounding artefact, not
 * an error worth failing a conversion over.
 */
function report(job: QueuedJob, progress: number): QueuedJob {
  if (job.state !== 'processing') return job

  const clamped = progress < 0 ? -1 : Math.min(1, progress)

  return clamped === job.progress ? job : { ...job, progress: clamped }
}

/** `jobs` with the one matching `id` replaced, or `jobs` itself when nothing moved. */
function replace(
  jobs: readonly QueuedJob[],
  id: string,
  change: (job: QueuedJob) => QueuedJob,
): readonly QueuedJob[] {
  const at = jobs.findIndex((job) => job.id === id)
  if (at === -1) return jobs

  const changed = change(jobs[at])
  if (changed === jobs[at]) return jobs

  const next = [...jobs]
  next[at] = changed

  return next
}

/** Exhaustiveness guard: a new action without a branch is a compile error. */
function unhandled(action: never): never {
  throw new Error(`Unknown queue action: ${JSON.stringify(action)}`)
}
