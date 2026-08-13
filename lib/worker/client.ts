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
    worker = spawn()
    api = Comlink.wrap<ConversionApi>(worker)
  }

  return api
}

function spawn(): Worker {
  // Server Components and prerendering evaluate this module in Node, where
  // there is no `Worker`. Left alone that surfaces as "Worker is not a
  // constructor", which reads like a bundler fault; name the real cause.
  if (typeof Worker === 'undefined') {
    throw new Error(
      'The conversion worker can only be started in the browser. ' +
        'ensureWorker() was called during server rendering — move the call into ' +
        'an event handler or an effect in a client component.',
    )
  }

  // This exact literal form is what makes the worker a separate chunk.
  // Turbopack and webpack both pattern-match `new Worker(new URL(<literal>,
  // import.meta.url))` at build time; a variable in place of the literal
  // silently falls back to a runtime URL that resolves to nothing in
  // production. `type: 'module'` is what lets the entry use `import` statements
  // and, more importantly, `await import()` for the engines.
  const spawned = new Worker(new URL('./conversion.worker.ts', import.meta.url), { type: 'module' })

  // A worker that never starts — a stale chunk URL after a deploy, a CSP that
  // blocks it, a throw while the entry evaluates — leaves Comlink's request
  // promises unsettled forever, with nothing logged. These two events are the
  // only notification the platform gives, so treat them as fatal: drop the
  // worker and let the next call spawn a healthy one, rather than hand out a
  // proxy whose every method hangs.
  //
  // The `worker === spawned` guard matters because the event can arrive after
  // this worker has already been replaced; without it a late failure would kill
  // its successor.
  const discard = (event: Event) => {
    console.error('Docify: the conversion worker failed and was shut down.', event)
    if (worker === spawned) terminateWorker()
  }
  spawned.addEventListener('error', discard)
  spawned.addEventListener('messageerror', discard)

  return spawned
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
