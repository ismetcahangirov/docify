/**
 * A worker that is real in every way except the thread.
 *
 * jsdom has no `Worker`, so the client's own `new Worker(...)` has to land
 * somewhere. This is not a mock of the API: it wires a real `MessageChannel` to
 * a real `createConversionApi()` through real Comlink, so a call made here is
 * serialised, posted, dispatched and answered exactly as it would be in a
 * browser — including the `MessagePort` transfer behind `Comlink.proxy()`,
 * which is the whole mechanism progress travels on.
 *
 * Test-support code, not shipped.
 */

import * as Comlink from 'comlink'
import { vi } from 'vitest'

import { createConversionApi } from '@/lib/worker/api'
import type { ConversionApi } from '@/lib/worker/types'

/** Records what `client.ts` asked for, so the construction contract is testable. */
export interface SpawnRecord {
  url: string
  options: WorkerOptions | undefined
}

const spawns: SpawnRecord[] = []
const live: FakeWorker[] = []
let createApi: () => ConversionApi = createConversionApi

/**
 * `port2` hosts the conversion API and `port1` is the main-thread end, so
 * `'message'` traffic is forwarded straight to it. A `MessagePort` only starts
 * delivering to `addEventListener` after `start()`, which a real `Worker` does
 * implicitly — hence the call in the constructor.
 *
 * `'error'` and `'messageerror'` are *not* port events: a real `Worker` fires
 * them at the worker object itself when the entry chunk fails to load or throws
 * while evaluating. They are kept in a separate registry so `fail()` can
 * reproduce that, which is the one worker failure mode Comlink cannot surface —
 * it leaves every pending call unsettled forever.
 */
export class FakeWorker implements Comlink.Endpoint {
  private readonly channel = new MessageChannel()
  private readonly failureListeners: EventListener[] = []
  terminated = false

  constructor(url: string | URL, options?: WorkerOptions) {
    spawns.push({ url: String(url), options })
    live.push(this)
    Comlink.expose(createApi(), this.channel.port2)
    this.channel.port1.start()
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.channel.port1.postMessage(message, transfer)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.channel.port1.addEventListener(type, listener)
    else this.failureListeners.push(listener as EventListener)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.channel.port1.removeEventListener(type, listener)
  }

  terminate(): void {
    this.terminated = true
    this.channel.port1.close()
    this.channel.port2.close()
  }

  /** Reproduces "the worker chunk 404s" or "the entry threw on evaluation". */
  fail(): void {
    const event = new Event('error')
    for (const listener of this.failureListeners) listener(event)
  }
}

export interface FakeWorkerHandle {
  /** Every `new Worker(...)` the client performed, in order. */
  readonly spawns: SpawnRecord[]
  /** Every fake worker constructed, so a test can terminate or fail one. */
  readonly live: FakeWorker[]
}

/**
 * Installs the fake in place of the global `Worker` and clears the records from
 * the previous test. `createApi` lets a test put a runner behind the worker;
 * left out, the worker behaves exactly as the shipped one does.
 *
 * Undone by `vi.unstubAllGlobals()`.
 */
export function installFakeWorker(
  apiFactory: () => ConversionApi = createConversionApi,
): FakeWorkerHandle {
  spawns.length = 0
  live.length = 0
  createApi = apiFactory
  vi.stubGlobal('Worker', FakeWorker)

  return { spawns, live }
}
