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

import type { EngineRunner, ProgressCallback } from '@/lib/engines/types'
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
      const relay = onProgress === undefined ? null : createProgressRelay(deliver(onProgress))

      // Nothing more is reported once the user has cancelled: a bar that keeps
      // ticking while the engine unwinds says the click did nothing.
      controller.signal.addEventListener('abort', () => relay?.stop(), { once: true })

      try {
        // Registered before the first `await`, which is what makes the obvious
        // race safe: a `cancel()` posted immediately after `convert()` is
        // delivered second, and by then this line has already run.
        //
        // Inside the try so that a refused duplicate still runs the teardown
        // below — it has a progress proxy of its own to release. Evicting the
        // incumbent is not a risk: `release` matches on the controller, and a
        // refused job's is not the one in the registry.
        if (jobId !== undefined) jobs.register(jobId, controller)

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
 * Every branch is an `await import('@/lib/engines/<id>')` and never a static
 * import — one static import here drops a multi-megabyte WASM binary into the
 * worker chunk and breaks CLAUDE.md §2.3. `test/worker/static-import-graph.test.ts`
 * holds that line.
 *
 * The specifier stays a literal string in each branch. A computed
 * `import(\`@/lib/engines/${engine}\`)` would read as tidier and cost the whole
 * invariant: a bundler that cannot see the target statically either bundles
 * every engine into one chunk or emits none of them.
 */
async function loadEngineRunner(engine: EngineId): Promise<EngineRunner> {
  if (engine === 'canvas') return (await import('@/lib/engines/canvas')).createRunner()
  if (engine === 'heif') return (await import('@/lib/engines/heif')).createRunner()
  if (engine === 'vips') return (await import('@/lib/engines/vips')).createRunner()
  if (engine === 'pdflib') return (await import('@/lib/engines/pdflib')).createRunner()
  if (engine === 'pdfjs') return (await import('@/lib/engines/pdfjs')).createRunner()

  throw new Error(
    `No runner is registered for engine "${engine}" yet. ` +
      'The remaining engines arrive over EPICs 4 to 6.',
  )
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ConversionCancelledError()
}

/**
 * Wraps the caller's callback so that delivering a tick can never fail a job.
 *
 * The type says `ProgressCallback`, but inside the worker the value is a
 * Comlink proxy: calling it posts a message and returns a promise that rejects
 * if the main thread's handler throws. Unhandled, that rejection is at best
 * swallowed noise in the worker and at worst — the platform is inconsistent
 * here — an `error` event on the parent's `Worker` object, which `client.ts`
 * treats as fatal. A `setState` on an unmounted component would then take down
 * the conversion.
 *
 * `new Promise(...)` rather than `Promise.resolve(...)` because it catches the
 * synchronous throw too, which is what a locally supplied callback does.
 *
 * Progress is advisory: the job's own result is the thing that matters, so a
 * tick that cannot be delivered is dropped rather than escalated.
 */
function deliver(onProgress: RemoteProgressCallback): ProgressCallback {
  return (progress) => {
    void new Promise<void>((resolve) => resolve(onProgress(progress))).catch(() => {})
  }
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
