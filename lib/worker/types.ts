/**
 * The contract between the main thread and the conversion worker.
 *
 * Types only — no values, no runtime imports — so `client.ts` can describe the
 * remote API without its module graph touching the worker entry. That
 * separation is what lets the bundler emit the worker as its own chunk
 * (CLAUDE.md §2.3): if the client statically imported the worker module for a
 * type, the two would collapse into one.
 */

import type { EngineInput } from '@/lib/engines/types'
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
}

/**
 * What `Comlink.expose()` publishes from the worker and `Comlink.wrap()` returns
 * on the main thread. Comlink makes every method async on the remote side, so a
 * synchronous `ping()` here is `() => Promise<'pong'>` to the caller.
 *
 * ### Seam for issue #28 (progress + cancellation)
 *
 * `convert()` deliberately takes the request and nothing else for now. Neither
 * half of the progress/cancel protocol can be expressed with a plain argument,
 * so #28 owns both decisions:
 *
 * - **Progress.** A `ProgressCallback` is a function, and functions are not
 *   structured-cloneable. It has to cross as `Comlink.proxy(onProgress)` and be
 *   typed as `ProxyOrClone<ProgressCallback>`, which turns every engine tick
 *   into a round trip — so the 250 ms floor from `lib/engines/types.ts` is a
 *   throttling requirement on the worker side, not a UI concern.
 * - **Cancellation.** An `AbortSignal` is not cloneable either, and it travels
 *   the wrong way: the main thread has to reach a job that is already running.
 *   That needs a job identity plus a sibling `cancel(jobId)` which aborts the
 *   `AbortController` the worker owns for that job. Keep `convert()` resolving
 *   with the `Blob`: a caller-minted `jobId?: string` added to `ConvertRequest`
 *   below gets the identity across without changing the return type, whereas
 *   *returning* an id would break every caller. Terminating the worker is the
 *   blunt fallback and throws away the warm engine, so it should stay the last
 *   resort rather than the mechanism.
 *
 * Taken that way both additions are backwards compatible — an optional
 * parameter and an optional field — and nothing here has to be unpicked first.
 *
 * One gap this shell knowingly leaves open, because closing it needs the job
 * registry that #28 introduces: `terminateWorker()` abandons in-flight calls
 * rather than rejecting them, so their promises never settle and the caller's
 * `Blob`s stay reachable. Nothing long-running exists yet — `convert()` throws
 * immediately — but the first real engine makes it a leak, and the registry
 * that backs `cancel(jobId)` is exactly what is needed to reject them.
 */
export interface ConversionApi {
  /** Liveness check. Cheap, synchronous, and the worker's only job until an engine lands. */
  ping(): 'pong'
  /** Runs one job to completion and resolves with the converted file. */
  convert(request: ConvertRequest): Promise<Blob>
}
