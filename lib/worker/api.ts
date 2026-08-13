/**
 * The implementation behind `ConversionApi`, kept out of the worker entry.
 *
 * `conversion.worker.ts` runs `Comlink.expose()` the moment it is imported, and
 * that side effect only makes sense inside a worker. Holding the behaviour in a
 * plain factory here means it can be constructed and driven directly by a test,
 * over a `MessageChannel` or with no boundary at all, without a browser and
 * without a real `Worker`.
 */

import { releaseProxy } from 'comlink'

import type { EngineRunner } from '@/lib/engines/types'
import type { EngineId } from '@/lib/router/types'

import { ConversionCancelledError } from './errors'
import { createJobRegistry } from './job-registry'
import { createProgressRelay } from './progress-relay'
import type { ConversionApi, RemoteProgressCallback } from './types'

/**
 * How the worker gets hold of a runner.
 *
 * A parameter rather than a hard-wired `switch` for two reasons: a test can
 * supply a runner that behaves however the case under test needs — one that
 * ignores its `AbortSignal`, one that never finishes — and the real loader
 * stays free to be nothing but `await import()` calls, which is what keeps the
 * engines out of this chunk (CLAUDE.md §2.3).
 */
export type RunnerLoader = (engine: EngineId) => Promise<EngineRunner>

/**
 * Builds the object the worker publishes to the main thread.
 *
 * A factory rather than a module-level constant so each worker — and each test —
 * gets its own job registry; a shared singleton would leak running jobs between
 * tests and make ids collide across workers.
 */
export function createConversionApi(loadRunner: RunnerLoader = loadEngineRunner): ConversionApi {
  const jobs = createJobRegistry()

  return {
    ping() {
      return 'pong'
    },

    cancel(jobId) {
      return jobs.abort(jobId)
    },

    async convert(request, onProgress) {
      const { jobId } = request
      const controller = new AbortController()

      // Registered before the first `await`, which is what makes the obvious
      // race safe: a `cancel()` posted immediately after `convert()` is
      // delivered second, and by then this line has already run.
      //
      // Outside the try/finally on purpose — a refused duplicate must not run
      // the teardown belonging to the job that already owns the id.
      if (jobId !== undefined) jobs.register(jobId, controller)

      const relay = onProgress === undefined ? null : createProgressRelay(onProgress)

      try {
        const runner = await loadRunner(request.engine)

        // Engines take seconds to download. Cancelling during that window is
        // the most likely cancel of all, and starting the job anyway would run
        // work the user has already walked away from.
        throwIfAborted(controller.signal)

        const blob = await runner.run(
          { task: request.task, files: request.files },
          controller.signal,
          (progress) => relay?.report(progress),
        )

        // A runner that swallowed its signal and finished anyway must not hand
        // back a file: the user cancelled, and delivering the output would
        // download something they said they did not want.
        throwIfAborted(controller.signal)

        return blob
      } catch (error) {
        // Whatever an engine throws on its way out — a `DOMException`, its own
        // error type, the `TypeError` from a half-released buffer — a cancelled
        // job rejects with one recognisable thing. The original is kept as the
        // cause for anyone debugging the engine.
        if (controller.signal.aborted && !(error instanceof ConversionCancelledError)) {
          throw new ConversionCancelledError(undefined, { cause: error })
        }

        throw error
      } finally {
        relay?.stop()
        release(onProgress)
        if (jobId !== undefined) jobs.release(jobId, controller)
      }
    },
  }
}

/**
 * The real loader.
 *
 * Every branch this grows in EPIC 4 is an `await import('@/lib/engines/<id>')`
 * and never a static import — one static import here drops a 32 MB WASM binary
 * into the worker chunk and breaks CLAUDE.md §2.3.
 */
async function loadEngineRunner(engine: EngineId): Promise<EngineRunner> {
  throw new Error(
    `No runner is registered for engine "${engine}" yet. ` +
      'Conversion engines arrive in EPIC 4; the worker shell only answers ping() so far.',
  )
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ConversionCancelledError()
}

/**
 * Closes the `MessagePort` pair Comlink created for the progress callback.
 *
 * Without this every conversion in a session leaks a port on both threads. The
 * cast is the price of a symbol that only exists on the far side of the
 * boundary: the type says "a progress callback", the value is a Comlink proxy,
 * and a locally supplied callback in a test simply has no hook to call.
 */
function release(onProgress: RemoteProgressCallback | undefined): void {
  if (onProgress === undefined) return

  const releasable = onProgress as { [releaseProxy]?: () => void }
  releasable[releaseProxy]?.()
}
