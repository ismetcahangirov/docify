/**
 * Starting and stopping a conversion, from the main thread.
 *
 * This is the surface the UI uses; `client.ts` underneath it only owns the
 * worker's lifetime. Three things happen here that a raw call on the Comlink
 * proxy would get wrong:
 *
 * 1. The progress callback is wrapped in `Comlink.proxy()`. A bare function
 *    cannot be structured-cloned, so an unwrapped one fails the whole call with
 *    a `DataCloneError` the moment it is posted.
 * 2. Every job gets an id whether the caller thought about one or not, because
 *    an id is the only way back to a job that is already running.
 * 3. The promise handed out is one `terminateWorker()` can settle, so killing
 *    the worker cannot leave a caller waiting forever.
 */

import * as Comlink from 'comlink'

import type { ProgressCallback } from '@/lib/engines/types'

import { activeWorker, ensureWorker } from './client'
import { releasePendingJob, trackPendingJob } from './pending'
import type { ConvertRequest } from './types'

/** A job that is on its way, and the handle needed to stop it. */
export interface RunningJob {
  /** Pass this to `cancelConversion()`. */
  jobId: string
  /** Resolves with the converted file, or rejects — with an `AbortError` if it was cancelled. */
  result: Promise<Blob>
}

let minted = 0

/**
 * A unique id for one job.
 *
 * A counter is enough and better than a random id: there is exactly one main
 * thread minting these, they only have to be distinct among the jobs alive at
 * once, and a readable `docify-job-3` beats a UUID in a stack trace. The prefix
 * keeps them out of the way of ids a caller mints itself.
 */
export function createJobId(): string {
  minted += 1
  return `docify-job-${minted}`
}

/**
 * Sends a routed job to the worker and starts it.
 *
 * `request.engine` comes from `route()` — this function never decides anything
 * about it (CLAUDE.md §2.4). `onProgress` receives `0..1`, or `-1` while an
 * engine that cannot measure itself is working, at least every 250 ms; it is
 * advisory once `result` has settled.
 *
 * Never throws: every way a job can fail — including being called during
 * server rendering, where there is no `Worker` to start — arrives as a
 * rejection of `result`.
 */
export function startConversion(
  request: ConvertRequest,
  onProgress?: ProgressCallback,
): RunningJob {
  const jobId = request.jobId ?? createJobId()

  const result = new Promise<Blob>((resolve, reject) => {
    // Inside the executor — which runs synchronously, so the worker still
    // starts before this function returns — because a caller should have one
    // place to handle failure. `ensureWorker()` throwing during server
    // rendering would otherwise be the single case that arrives as a throw
    // while every other way a job can fail arrives on `result`.
    const api = ensureWorker()
    trackPendingJob(jobId, reject)

    // The record is dropped *before* the caller's promise settles, not in a
    // `finally` afterwards. A `finally` runs a microtask later, which is long
    // enough for code awaiting `result` to start the next job — and find the id
    // it just finished with still registered.
    api
      .convert(
        { ...request, jobId },
        onProgress === undefined ? undefined : Comlink.proxy(onProgress),
      )
      .then(
        (blob) => {
          releasePendingJob(jobId)
          resolve(blob)
        },
        (error: unknown) => {
          releasePendingJob(jobId)
          reject(error)
        },
      )
  })

  return { jobId, result }
}

/**
 * Asks the worker to stop the job named `jobId`, and reports whether it found
 * one to stop.
 *
 * Cooperative: the engine is told to abort and unwinds itself, so the worker
 * and everything it has already downloaded survive. The job's own `result`
 * rejects with an `AbortError` once the engine has actually stopped — not when
 * the request is made — so `false` here means the job had already finished, not
 * that cancelling failed.
 *
 * An engine that blocks the worker thread inside one synchronous WASM call
 * cannot be reached this way at all: the message waits behind the work it was
 * meant to interrupt. `terminateWorker()` is the escalation for that, at the
 * cost of every other running job and of the loaded engine.
 *
 * Never starts a worker. Cancelling when nothing is running is a no-op, not a
 * reason to spin up a thread.
 */
export async function cancelConversion(jobId: string): Promise<boolean> {
  const api = activeWorker()
  if (api === null) return false

  return api.cancel(jobId)
}
