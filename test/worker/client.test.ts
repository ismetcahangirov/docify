/**
 * The worker shell, exercised end to end without a browser.
 *
 * jsdom has no `Worker`, so these tests install `FakeWorker` in its place. The
 * fake is not a mock of the API: it wires a real `MessageChannel` to the real
 * `createConversionApi()` through real Comlink, so a `ping()` here travels the
 * same serialise → post → dispatch → reply path it takes in a browser. Only the
 * thread boundary is simulated.
 */

import * as Comlink from 'comlink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createConversionApi } from '@/lib/worker/api'

/** Records what `client.ts` asked for, so the construction contract is testable. */
interface SpawnRecord {
  url: string
  options: WorkerOptions | undefined
}

const spawns: SpawnRecord[] = []
const live: FakeWorker[] = []

/**
 * Stands in for a real module worker.
 *
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
class FakeWorker implements Comlink.Endpoint {
  private readonly channel = new MessageChannel()
  private readonly failureListeners: EventListener[] = []
  terminated = false

  constructor(url: string | URL, options?: WorkerOptions) {
    spawns.push({ url: String(url), options })
    live.push(this)
    Comlink.expose(createConversionApi(), this.channel.port2)
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

/**
 * `client.ts` keeps the worker in module scope, so every test needs a pristine
 * copy of the module rather than the one the previous test left behind.
 */
async function loadClient() {
  vi.resetModules()
  return import('@/lib/worker/client')
}

beforeEach(() => {
  spawns.length = 0
  live.length = 0
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ensureWorker', () => {
  it('spawns nothing until it is called', async () => {
    await loadClient()

    expect(spawns).toHaveLength(0)
  })

  it('answers ping with pong', async () => {
    const { ensureWorker } = await loadClient()

    await expect(ensureWorker().ping()).resolves.toBe('pong')
  })

  it('reuses the one worker however often it is called', async () => {
    const { ensureWorker } = await loadClient()

    const first = ensureWorker()
    const second = ensureWorker()

    expect(spawns).toHaveLength(1)
    expect(second).toBe(first)
    await expect(second.ping()).resolves.toBe('pong')
  })

  it('asks for a module worker, so the entry can use import statements', async () => {
    const { ensureWorker } = await loadClient()

    ensureWorker()

    expect(spawns[0].options).toEqual({ type: 'module' })
  })

  it('points the worker at the conversion entry module', async () => {
    const { ensureWorker } = await loadClient()

    ensureWorker()

    expect(spawns[0].url).toMatch(/conversion\.worker\.[jt]s(\?.*)?$/)
  })

  it('says why it cannot start when there is no Worker constructor', async () => {
    vi.stubGlobal('Worker', undefined)
    const { ensureWorker } = await loadClient()

    expect(() => ensureWorker()).toThrow(/browser/i)
  })
})

describe('a worker that fails to start', () => {
  it('is shut down rather than left to swallow every later call', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ensureWorker } = await loadClient()

    ensureWorker()
    live[0].fail()

    expect(live[0].terminated).toBe(true)
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })

  it('is replaced on the next call instead of being handed out again', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ensureWorker } = await loadClient()

    ensureWorker()
    live[0].fail()
    const replacement = ensureWorker()

    expect(spawns).toHaveLength(2)
    await expect(replacement.ping()).resolves.toBe('pong')
    errors.mockRestore()
  })

  it('cannot take down the worker that replaced it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ensureWorker } = await loadClient()

    ensureWorker()
    const failed = live[0]
    failed.fail()
    ensureWorker()
    failed.fail()

    expect(live[1].terminated).toBe(false)
    errors.mockRestore()
  })
})

describe('terminateWorker', () => {
  it('does nothing when no worker was ever spawned', async () => {
    const { terminateWorker } = await loadClient()

    expect(() => terminateWorker()).not.toThrow()
    expect(spawns).toHaveLength(0)
  })

  it('terminates the running worker', async () => {
    const { ensureWorker, terminateWorker } = await loadClient()

    ensureWorker()
    terminateWorker()

    expect(live[0].terminated).toBe(true)
  })

  it('lets the next ensureWorker start a fresh, working worker', async () => {
    const { ensureWorker, terminateWorker } = await loadClient()

    ensureWorker()
    terminateWorker()
    const revived = ensureWorker()

    expect(spawns).toHaveLength(2)
    await expect(revived.ping()).resolves.toBe('pong')
  })

  it('is idempotent, so a second call cannot terminate a worker twice', async () => {
    const { ensureWorker, terminateWorker } = await loadClient()

    ensureWorker()
    terminateWorker()
    terminateWorker()

    expect(live).toHaveLength(1)
  })
})

describe('convert', () => {
  it('is reachable across the worker boundary but has no engine behind it yet', async () => {
    const { ensureWorker } = await loadClient()

    const request = {
      engine: 'canvas' as const,
      task: { from: 'png' as const, to: 'webp' as const, op: 'convert' as const },
      files: [new Blob(['x'])],
    }

    await expect(ensureWorker().convert(request)).rejects.toThrow(/canvas/)
  })
})
