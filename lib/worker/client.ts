/**
 * Main-thread access to the conversion worker.
 *
 * The worker is a process-wide singleton, spawned on first use and never on
 * import. That laziness is the point: most visitors land on a marketing page and
 * never convert anything, and a worker they never use still costs a thread, a
 * module-graph fetch and a Comlink handshake.
 *
 * Only the *type* of the remote API is imported here. The worker module itself
 * is named as a URL, so the bundler emits it as a separate chunk and this file
 * carries none of its weight.
 */

import * as Comlink from 'comlink'

import type { ConversionApi } from './types'

let worker: Worker | null = null
let api: Comlink.Remote<ConversionApi> | null = null

/**
 * Returns the worker's API, starting the worker if it is not running.
 *
 * Every method on the result is async, because every call is a `postMessage`
 * round trip — `ping()` is typed `() => 'pong'` but awaited as `Promise<'pong'>`.
 *
 * Repeated calls hand back the same proxy: engines are expensive to load and a
 * second worker would have to download them all over again.
 */
export function ensureWorker(): Comlink.Remote<ConversionApi> {
  if (api === null) {
    // This exact literal form is what makes the worker a separate chunk.
    // Turbopack and webpack both pattern-match `new Worker(new URL(<literal>,
    // import.meta.url))` at build time; a variable in place of the literal
    // silently falls back to a runtime URL that resolves to nothing in
    // production. `type: 'module'` is what lets the entry use `import`
    // statements and, more importantly, `await import()` for the engines.
    worker = new Worker(new URL('./conversion.worker.ts', import.meta.url), { type: 'module' })
    api = Comlink.wrap<ConversionApi>(worker)
  }

  return api
}

/**
 * Stops the worker and drops the proxy. The next `ensureWorker()` starts a fresh
 * one.
 *
 * Termination is immediate and unconditional, so any in-flight `convert()` is
 * abandoned rather than rejected. Issue #28 adds a cooperative cancel that
 * unwinds a single job and keeps the worker — and its warm engine — alive; this
 * is the sledgehammer for teardown and for recovering from a wedged worker.
 *
 * Safe to call when nothing is running.
 */
export function terminateWorker(): void {
  worker?.terminate()
  worker = null
  api = null
}
