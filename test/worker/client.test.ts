/**
 * The worker shell, exercised end to end without a browser.
 *
 * jsdom has no `Worker`, so these tests install the `FakeWorker` from
 * `./fake-worker` in its place: a real `MessageChannel` wired to a real
 * `createConversionApi()` through real Comlink, so a `ping()` here travels the
 * same serialise → post → dispatch → reply path it takes in a browser. Only the
 * thread boundary is simulated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type FakeWorkerHandle, installFakeWorker } from './fake-worker'

let spawns: FakeWorkerHandle['spawns']
let live: FakeWorkerHandle['live']

/**
 * `client.ts` keeps the worker in module scope, so every test needs a pristine
 * copy of the module rather than the one the previous test left behind.
 */
async function loadClient() {
  vi.resetModules()
  return import('@/lib/worker/client')
}

beforeEach(() => {
  ;({ spawns, live } = installFakeWorker())
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
