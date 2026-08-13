/**
 * The contract between the main thread and the conversion worker.
 *
 * Types only — no values, no runtime imports — so `client.ts` can describe the
 * remote API without its module graph touching the worker entry. That
 * separation is what lets the bundler emit the worker as its own chunk
 * (CLAUDE.md §2.3): if the client statically imported the worker module for a
 * type, the two would collapse into one.
 */

import type { ProxyMarked } from 'comlink'

import type { EngineInput, ProgressCallback } from '@/lib/engines/types'
import type { EngineId } from '@/lib/router/types'

/**
 * One job, fully decided before it crosses the boundary.
 *
 * `engine` is chosen by `route()` on the main thread and merely obeyed here.
 * The worker never re-routes: it has no `Capabilities` and, per CLAUDE.md §2.4,
 * engine selection lives in exactly one place.
 */
export interface ConvertRequest extends EngineInput {
  engine: EngineId
  /**
   * The name the main thread will use to cancel this job.
   *
   * Caller-minted, because it has to be known *before* `convert()` settles — an
   * id learnt from the return value would arrive after the only moment it could
   * have been useful. Optional, and the consequence of leaving it out is
   * precise: the job runs exactly as it would otherwise, but nothing can reach
   * it afterwards, so `cancel()` can never stop it. `startConversion()` in
   * `./jobs` therefore always supplies one.
   *
   * Must be unique among the jobs currently in flight; the worker refuses a
   * duplicate rather than letting a second job make the first uncancellable.
   */
  jobId?: string
}

/**
 * A progress callback as it must be handed across the boundary.
 *
 * Functions are not structured-cloneable, so a bare one thrown at
 * `postMessage` fails with a `DataCloneError` on the first tick. Comlink's
 * answer is `Comlink.proxy(fn)`, which marks the function and transfers a
 * `MessagePort` in its place; requiring the mark in the type turns "forgot to
 * wrap it" from a runtime failure at an awkward moment into a compile error.
 *
 * The worker releases the proxy when the job settles — each transfer costs a
 * port pair, and a session's worth of unreleased ports is a leak — so a given
 * proxy belongs to exactly one job.
 *
 * This describes the *sending* side. What arrives in the worker is a
 * `Remote<ProgressCallback>`: calling it posts a message and returns a promise
 * rather than nothing, so the worker treats every tick as fallible.
 */
export type RemoteProgressCallback = ProgressCallback & ProxyMarked

/**
 * What `Comlink.expose()` publishes from the worker and `Comlink.wrap()` returns
 * on the main thread. Comlink makes every method async on the remote side, so a
 * synchronous `ping()` here is `() => Promise<'pong'>` to the caller.
 *
 * ### How cancellation crosses
 *
 * An `AbortSignal` is not cloneable, and it travels the wrong way besides: the
 * main thread has to reach a job that is *already running*. So the signal never
 * crosses at all. The worker mints the `AbortController`, keeps it under the
 * caller's `jobId`, and `cancel(jobId)` — an ordinary second call — is what
 * aborts it. `convert()` keeps resolving with the `Blob`.
 *
 * That cooperative path is the one every engine must honour, and the only one
 * that keeps the worker and its warm engine alive. It works because the abort
 * can be *received*: the worker's message loop has to be free to run the
 * `cancel` call. An engine that disappears into a single synchronous WASM
 * call — single-threaded ffmpeg.wasm on a long GOP, wasm-vips on a large TIFF —
 * never yields, so the message waits in the queue and the abort lands only
 * after the work it was meant to stop has already finished. For those the only
 * real stop is `terminateWorker()`, which kills the thread outright and throws
 * away the loaded engine with it. Cooperative first, sledgehammer second.
 */
export interface ConversionApi {
  /** Liveness check. Cheap, synchronous, and the worker's only job until an engine lands. */
  ping(): 'pong'
  /**
   * Runs one job to completion and resolves with the converted file.
   *
   * Rejects with an `AbortError` if the job is cancelled — including when the
   * cancel lands while the engine is still downloading, and including when a
   * runner ignores its signal and produces a result anyway. A cancelled job
   * never delivers output.
   */
  convert(request: ConvertRequest, onProgress?: RemoteProgressCallback): Promise<Blob>
  /**
   * Aborts the running job named `jobId`, and reports whether there was one.
   *
   * An unknown id answers `false` instead of throwing: the job that finished a
   * moment before the user reached the cancel button is the common case, not an
   * error.
   */
  cancel(jobId: string): boolean
}
