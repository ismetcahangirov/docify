/**
 * The implementation behind `ConversionApi`, kept out of the worker entry.
 *
 * `conversion.worker.ts` runs `Comlink.expose()` the moment it is imported, and
 * that side effect only makes sense inside a worker. Holding the behaviour in a
 * plain factory here means it can be constructed and driven directly by a test,
 * over a `MessageChannel`, without a browser or a real `Worker`.
 */

import type { ConversionApi } from './types'

/**
 * Builds the object the worker publishes to the main thread.
 *
 * A factory rather than a module-level constant so each worker — and each test —
 * gets its own instance to hang per-worker state on. Issue #28 needs somewhere
 * to keep the running jobs' `AbortController`s, and a shared singleton would
 * leak them between tests.
 */
export function createConversionApi(): ConversionApi {
  return {
    ping() {
      return 'pong'
    },

    /**
     * Not wired up yet: the engines land in EPIC 4 onwards.
     *
     * When they do, the body is a `switch` over `request.engine` whose every
     * branch is an `await import('@/lib/engines/<id>')` — never a static import,
     * or the engine's WASM joins this chunk and breaks CLAUDE.md §2.3.
     */
    async convert(request) {
      throw new Error(
        `No runner is registered for engine "${request.engine}" yet. ` +
          'Conversion engines arrive in EPIC 4; the worker shell only answers ping() so far.',
      )
    },
  }
}
