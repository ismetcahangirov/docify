'use client'

import * as React from 'react'

import { isAbort } from '@/lib/abort'
import { rasterSize } from '@/lib/engines/raster-size'
import type { EngineInput } from '@/lib/engines/types'
import type { JobPatch, QueueAction, QueuedJob } from '@/lib/queue/queue'
import { createJob, queueReducer } from '@/lib/queue/queue'
import type { JobEvent } from '@/lib/queue/state'
import { isFinished, isRunning } from '@/lib/queue/state'
import { budgetBytes } from '@/lib/router/budget'
import { probeCapabilities } from '@/lib/router/capabilities'
import { route } from '@/lib/router/route'
import type { Capabilities, ConversionTask, EngineId, RouteFile } from '@/lib/router/types'
import { reportConversion } from '@/lib/stats/report'
import { cancelConversion, startConversion } from '@/lib/worker/jobs'

/*
 * The queue, and the impure half of it (issue #57).
 *
 * `lib/queue/` is the rules: which states exist, which moves between them are
 * legal, and what the list looks like afterwards. All of it is pure, and none of
 * it can start a conversion. This module is the part that reads a clock, mints
 * an id, probes the device and talks to the worker — kept separate so that
 * everything worth arguing about can be tested without any of it.
 *
 * ## What running a job actually is
 *
 * Four steps, and the state machine names each one. `start` opens `routing`;
 * `route()` picks an engine or refuses; `routed` opens `loading-engine`, which
 * is the window a 31 MB download lands in; and the worker's first progress tick
 * is what says the engine is finally up, which is `loaded` and `processing`.
 * Nothing here decides *which* engine — that is `route()`'s alone (CLAUDE.md
 * §2.4) — and nothing re-decides it afterwards.
 *
 * ## Why every worker message goes back through the reducer
 *
 * A conversion outlives the user's attention. They cancel, they retry, they drop
 * another file, and the worker keeps posting about the job they walked away from
 * because it is on another thread and has not heard yet. Rather than guarding
 * each callback with "is this still the job I think it is", every message is
 * dispatched and `lib/queue/state.ts` drops the ones that no longer apply.
 */

/** How much of a file to read looking for its pixel dimensions. */
const HEADER_BYTES = 64 * 1024

let minted = 0

/**
 * A unique id for one queued file.
 *
 * A counter, for the reason `lib/worker/jobs.ts` gives about its own: there is
 * one main thread minting these, they only have to be distinct among the jobs
 * alive at once, and a readable id beats a UUID in a stack trace.
 */
function nextId(): string {
  minted += 1

  return `docify-file-${minted}`
}

/** The settings a job carries into whichever engine takes it. */
export type JobSettings = Pick<EngineInput, 'image' | 'pdf' | 'video' | 'audio'>

export interface FileQueue {
  jobs: readonly QueuedJob[]
  /** Puts files in the list, in the order they were offered, and returns them. */
  add(files: readonly File[]): QueuedJob[]
  /**
   * Routes and runs one queued job.
   *
   * Resolves when the job has finished one way or the other, and never rejects:
   * every failure is a state the list already shows, and a second channel for
   * the same news is a second place to forget to handle it.
   */
  run(id: string, task: ConversionTask, settings?: JobSettings): Promise<void>
  /** Stops a running job, which returns it to `queued` with the file still there. */
  cancel(id: string): void
  /**
   * Returns a finished job to `queued` without starting it.
   *
   * Starting is the scheduler's job, and deliberately not this one's: whoever
   * owns the "one at a time" rule is the only thing that may start a run, so a
   * retry joins the line rather than jumping it (issue #263).
   */
  retry(id: string): void
  remove(id: string): void
  /** Drops everything that has finished, leaving whatever is still in flight. */
  clearFinished(): void
}

export function useFileQueue(): FileQueue {
  const [jobs, dispatch] = React.useReducer(queueReducer, EMPTY)

  /**
   * The worker's own id for each running job, so a cancel can reach it.
   *
   * A ref and not state: nothing renders from it, and it has to be readable
   * from inside a callback that closed over an older render.
   */
  const running = React.useRef(new Map<string, string>())

  /**
   * Which attempt at each job is the current one (issue #264).
   *
   * The state table drops a message by *state*, and state is not enough: a job
   * that was cancelled and started again is `processing` twice over, and the
   * first worker's result would land on the second run's card. So every run
   * takes a number, a cancel takes the next one, and anything a run learns
   * after an `await` is checked against it before it is dispatched. The table
   * stays as the second line of defence.
   */
  const runs = React.useRef(new Map<string, number>())
  const nextRun = React.useCallback((id: string) => {
    const token = (runs.current.get(id) ?? 0) + 1
    runs.current.set(id, token)

    return token
  }, [])

  /**
   * The list as it is *now*, for the same reason.
   *
   * `run` is called from an event handler and then awaits twice; by the time it
   * resumes, the `jobs` in its own closure is two renders old.
   */
  const latest = React.useRef(jobs)
  latest.current = jobs

  const advance = React.useCallback((id: string, event: JobEvent, patch?: JobPatch) => {
    dispatch({ type: 'advance', id, event, at: Date.now(), patch })
  }, [])

  const add = React.useCallback((files: readonly File[]) => {
    const added = files.map((file) => createJob(nextId(), file))
    dispatch({ type: 'add', jobs: added })

    return added
  }, [])

  const cancel = React.useCallback(
    (id: string) => {
      const workerJobId = running.current.get(id)
      if (workerJobId !== undefined) void cancelConversion(workerJobId)

      // Whatever the run is doing — reading the header, waiting on the worker —
      // it is no longer the current one, even if the worker never answers.
      nextRun(id)

      // Dispatched whatever the worker answers. `cancelConversion` reports
      // `false` for a job that had already finished, and waiting a round trip
      // for that would leave the button looking dead.
      advance(id, 'cancel')
    },
    [advance, nextRun],
  )

  const retry = React.useCallback((id: string) => advance(id, 'retry'), [advance])

  const run = React.useCallback(
    async (id: string, task: ConversionTask, settings: JobSettings = {}) => {
      const job = latest.current.find((candidate) => candidate.id === id)
      if (job === undefined || isRunning(job.state)) return

      // The table has no `start` out of `done` or `failed` — only `retry`, which
      // goes back to `queued`. Without this step the reducer drops `start` and
      // every event after it, and the worker converts a file whose card never
      // moves (issue #263).
      if (isFinished(job.state)) advance(id, 'retry')

      const token = nextRun(id)
      const isCurrent = () => runs.current.get(id) === token

      advance(id, 'start')

      const caps = probeCapabilities()
      const header = await routeFile(job.file)
      // A cancel that landed during the header read: the job is back in
      // `queued` and nothing below may happen — least of all the download.
      if (!isCurrent()) return

      const decision = route(task, [header], caps)

      if (!decision.ok) {
        advance(id, 'fail', {
          failure: {
            message: decision.message,
            suggestion: decision.suggestion,
            code: decision.code,
          },
        })

        // A refusal is a conversion that did not happen, which is exactly the
        // kind of thing the figures should show. Anonymous, and never awaited —
        // see lib/stats/report.ts.
        reportConversion(task, job.file.size, 'failure')

        return
      }

      advance(id, 'routed', {
        engine: decision.engine,
        reason: decision.reason,
        warnings: decision.warnings,
      })

      await convert({
        id,
        file: job.file,
        task,
        settings,
        engine: decision.engine,
        caps,
        running: running.current,
        dispatch,
        isCurrent,
      })
    },
    [advance, nextRun],
  )

  const remove = React.useCallback((id: string) => {
    running.current.delete(id)
    runs.current.delete(id)
    dispatch({ type: 'remove', id })
  }, [])
  const clearFinished = React.useCallback(() => dispatch({ type: 'clearFinished' }), [])

  return { jobs, add, run, cancel, retry, remove, clearFinished }
}

/** The starting list, hoisted so `useReducer` is not handed a new array each render. */
const EMPTY: readonly QueuedJob[] = []

interface ConvertRun {
  id: string
  file: File
  task: ConversionTask
  settings: JobSettings
  engine: EngineId
  caps: Capabilities
  running: Map<string, string>
  dispatch: React.Dispatch<QueueAction>
  /** Whether this is still the run the job is on. False after a cancel or a restart. */
  isCurrent: () => boolean
}

/**
 * Hands the job to the worker and reports what comes back.
 *
 * Split out of the hook because it is choreography rather than state, and
 * because it takes everything it touches as an argument — which is what lets the
 * whole path be driven in a test without a real `Worker`.
 */
async function convert(run: ConvertRun): Promise<void> {
  const { id, file, task, settings, engine, caps, running, dispatch, isCurrent } = run
  let loaded = false

  /**
   * The engine is up.
   *
   * The first progress tick is the only signal the platform gives: `convert()`
   * resolves once, at the very end, and the download in front of it has no event
   * of its own. A job that finishes without ever reporting is marked loaded on
   * the way out instead, so it cannot end while the list still shows it
   * downloading.
   */
  const markLoaded = () => {
    if (loaded) return
    loaded = true
    dispatch({ type: 'advance', id, event: 'loaded', at: Date.now() })
  }

  const { jobId, result } = startConversion(
    {
      engine,
      task,
      files: [file],
      budgetBytes: budgetBytes(caps),
      ...settings,
    },
    (progress) => {
      // A tick from a worker job the user has since cancelled, arriving after
      // the job was started again, would move the new run's bar.
      if (!isCurrent()) return
      markLoaded()
      dispatch({ type: 'progress', id, progress })
    },
  )

  running.set(id, jobId)

  try {
    const blob = await result
    // Every branch below is news about *this* run. Once the user has cancelled
    // it — and possibly started another — none of it may reach the list, and
    // none of it may be counted (issue #264).
    if (!isCurrent()) return
    markLoaded()
    dispatch({ type: 'advance', id, event: 'succeed', at: Date.now(), patch: { result: blob } })
    reportConversion(task, file.size, 'success')
  } catch (reason) {
    if (!isCurrent()) return

    // A cancel is not a failure: the user asked for it, and the list already
    // moved the job back to `queued` when they did. Dispatching it again is
    // harmless — the state table ignores what no longer applies — and it is what
    // catches the other way a job is cancelled, which is the worker dying.
    if (isAbort(reason)) {
      dispatch({ type: 'advance', id, event: 'cancel', at: Date.now() })

      return
    }

    dispatch({
      type: 'advance',
      id,
      event: 'fail',
      at: Date.now(),
      patch: { failure: { message: describe(reason) } },
    })
    reportConversion(task, file.size, 'failure')
  } finally {
    // Only this run's own entry: a newer run may already have put its worker
    // id here, and a cancel still has to be able to find it.
    if (running.get(id) === jobId) running.delete(id)
  }
}

/**
 * One file as the router sees it: its size, and its pixels where the header
 * says.
 *
 * Reading the header is what stops a 24 megapixel photograph being routed on its
 * compressed size alone — a flat screenshot and a photograph of the same
 * dimensions differ a hundredfold in bytes and cost exactly the same memory to
 * decode. It costs one 64 kB read and never blocks a job: a file with no
 * readable header is routed exactly as it was before the field existed.
 */
async function routeFile(file: File): Promise<RouteFile> {
  const header = await readHeader(file)
  const size = header === null ? null : rasterSize(header)

  if (size === null) return { bytes: file.size }

  return { bytes: file.size, pixels: size.width * size.height }
}

async function readHeader(file: File): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
  } catch {
    // A file the browser can no longer read — moved on disk, or a permission
    // withdrawn between the drop and the run. Routing continues without the
    // pixel bound, and the engine fails it with a message about the file rather
    // than about a header.
    return null
  }
}

/** Whatever an engine threw, as one sentence. */
function describe(reason: unknown): string {
  if (reason instanceof Error && reason.message.length > 0) return reason.message
  if (typeof reason === 'string' && reason.length > 0) return reason

  return 'The conversion stopped without saying why. Try it again, or try a different format.'
}
