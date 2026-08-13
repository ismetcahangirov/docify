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
 * Stands in for a real module worker. `port2` hosts the conversion API; `port1`
 * is the main-thread end, and every `Endpoint` method Comlink uses is forwarded
 * to it. A `MessagePort` only begins delivering to `addEventListener` after
 * `start()`, which a real `Worker` does implicitly — hence the call below.
 */
class FakeWorker implements Comlink.Endpoint {
  private readonly channel = new MessageChannel()
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
    this.channel.port1.addEventListener(type, listener)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.channel.port1.removeEventListener(type, listener)
  }

  terminate(): void {
    this.terminated = true
    this.channel.port1.close()
    this.channel.port2.close()
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
