/**
 * The protocol as a caller sees it: start a job, watch it tick, cancel it.
 *
 * Everything here runs across a real Comlink boundary over a real
 * `MessageChannel` (see `./fake-worker`), because the two things most likely to
 * break are exactly the two things a direct call cannot show. A progress
 * callback that is not `Comlink.proxy()`-wrapped throws `DataCloneError` at
 * `postMessage` — invisible without the boundary. And a `cancel()` is a second
 * message racing a job that is already running, which is only a race once the
 * calls actually queue.
 *
 * Real timers, not fake ones: message delivery here is a macrotask, and the
 * 250 ms window has its own tests in `./progress-relay.test.ts` and
 * `./api.test.ts` where the clock can be controlled without also stalling the
 * port.
 *
 * One jsdom limitation shapes the assertions below: its structured clone does
 * not preserve a `Blob`, which arrives on the far side as `{}`. Blob fidelity
 * across `postMessage` is the platform's guarantee, and `./api.test.ts` pins
 * the payload on the direct path — so what these tests assert about a result is
 * that it comes back at all, which is the part the protocol is responsible for.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EngineInput, EngineRunner, ProgressCallback } from '@/lib/engines/types'
import type { EngineId } from '@/lib/router/types'
import { createConversionApi } from '@/lib/worker/api'
import type { ConvertRequest } from '@/lib/worker/types'

import { type FakeWorkerHandle, installFakeWorker } from './fake-worker'

const TASK = { from: 'png', to: 'webp', op: 'convert' } as const

function requestFor(engine: EngineId = 'canvas'): ConvertRequest {
  return { engine, task: TASK, files: [new Blob(['source'])] }
}

/** Lets queued port messages be delivered. */
async function flush(times = 4): Promise<void> {
  for (let time = 0; time < times; time += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/**
 * A well-behaved engine: it reports once, tears itself down the instant its
 * signal fires, and otherwise waits for the test to end it.
 *
 * Every run it is given is tracked, so one instance can back several concurrent
 * jobs without the second silently orphaning the first.
 */
class ControlledRunner implements EngineRunner {
  started = 0
  tornDown = 0
  input: EngineInput | null = null
  private waiting: Array<{ resolve: (blob: Blob) => void; reject: (reason: unknown) => void }> = []

  async run(input: EngineInput, signal: AbortSignal, onProgress: ProgressCallback): Promise<Blob> {
    this.started += 1
    this.input = input
    onProgress(0.5)

    return new Promise<Blob>((resolve, reject) => {
      this.waiting.push({ resolve, reject })
      signal.addEventListener('abort', () => {
        this.tornDown += 1
        reject(new DOMException('Aborted', 'AbortError'))
      })
    })
  }

  /** Ends every run currently in progress successfully. */
  complete(): void {
    for (const run of this.take()) run.resolve(new Blob(['converted']))
  }

  /** Ends every run currently in progress with an engine failure. */
  break(): void {
    for (const run of this.take()) run.reject(new Error('the engine exploded'))
  }

  private take() {
    const waiting = this.waiting
    this.waiting = []
    return waiting
  }
}

let handle: FakeWorkerHandle

/**
 * `client.ts` and `pending.ts` both keep module-scope state, so every test gets
 * a fresh copy of the whole set rather than whatever the previous test left.
 */
async function loadWorker(runners: Partial<Record<EngineId, EngineRunner>>) {
  vi.resetModules()
  handle = installFakeWorker(() =>
    createConversionApi(async (engine) => {
      const runner = runners[engine]
      if (runner === undefined) throw new Error(`no test runner for "${engine}"`)
      return runner
    }),
  )

  const jobs = await import('@/lib/worker/jobs')
  const client = await import('@/lib/worker/client')
  return { ...jobs, ...client }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startConversion', () => {
  it('resolves with the file the engine produced', async () => {
    const runner = new ControlledRunner()
    const { startConversion } = await loadWorker({ canvas: runner })

    const { result } = startConversion(requestFor())
    await flush()
    runner.complete()

    await expect(result).resolves.toBeDefined()
  })

  it('carries progress back across the boundary', async () => {
    const runner = new ControlledRunner()
    const { startConversion } = await loadWorker({ canvas: runner })
    const seen: number[] = []

    const { result } = startConversion(requestFor(), (progress) => void seen.push(progress))
    await flush()
    runner.complete()
    await result

    expect(seen).toEqual([0.5])
  })

  it('is unmoved by a progress handler that throws on the main thread', async () => {
    const runner = new ControlledRunner()
    const { startConversion } = await loadWorker({ canvas: runner })

    const { result } = startConversion(requestFor(), () => {
      throw new Error('the UI blew up rendering a progress bar')
    })
    await flush()
    runner.complete()

    // The rejection travels back over the callback's own port. Unhandled it is
    // swallowed noise at best, and an `error` event that costs the whole worker
    // at worst.
    await expect(result).resolves.toBeDefined()
  })

  it('reports a call made during server rendering on the promise, not as a throw', async () => {
    const { startConversion } = await loadWorker({})
    vi.stubGlobal('Worker', undefined)

    let result: Promise<Blob> | undefined
    const start = () => {
      result = startConversion(requestFor()).result
    }

    expect(start).not.toThrow()
    await expect(result).rejects.toThrow(/browser/i)
  })

  it('mints a job id, so every job can be cancelled', async () => {
    const runner = new ControlledRunner()
    const { startConversion } = await loadWorker({ canvas: runner })

    const first = startConversion(requestFor())
    const second = startConversion(requestFor())
    await flush()
    runner.complete()
    await Promise.all([first.result, second.result])

    expect(first.jobId).toBeTruthy()
    expect(second.jobId).not.toBe(first.jobId)
  })

  it('keeps an id the caller chose', async () => {
    const runner = new ControlledRunner()
    const { startConversion } = await loadWorker({ canvas: runner })

    const { jobId, result } = startConversion({ ...requestFor(), jobId: 'chosen' })
    await flush()
    runner.complete()
    await result

    expect(jobId).toBe('chosen')
  })

  it('gives the engine the input and not the routing metadata', async () => {
    const runner = new ControlledRunner()
    const { startConversion } = await loadWorker({ canvas: runner })

    const { result } = startConversion(requestFor())
    await flush()
    runner.complete()
    await result

    expect(Object.keys(runner.input ?? {}).sort()).toEqual(['files', 'task'])
  })

  it('surfaces an engine failure to the caller', async () => {
    const runner = new ControlledRunner()
    const { startConversion } = await loadWorker({ canvas: runner })

    const { result } = startConversion(requestFor())
    await flush()
    runner.break()

    await expect(result).rejects.toThrow(/exploded/)
  })

  it('refuses a second job under an id that is still in flight', async () => {
    const runner = new ControlledRunner()
    const { startConversion } = await loadWorker({ canvas: runner })

    const first = startConversion({ ...requestFor(), jobId: 'shared' })
    const second = startConversion({ ...requestFor(), jobId: 'shared' })

    await expect(second.result).rejects.toThrow(/shared/)
    await flush()
    runner.complete()
    await expect(first.result).resolves.toBeDefined()
  })

  it('lets an id be reused once the job that held it has finished', async () => {
    const runner = new ControlledRunner()
    const { startConversion } = await loadWorker({ canvas: runner })

    const first = startConversion({ ...requestFor(), jobId: 'reused' })
    await flush()
    runner.complete()
    await first.result

    const second = startConversion({ ...requestFor(), jobId: 'reused' })
    await flush()
    runner.complete()

    await expect(second.result).resolves.toBeDefined()
    expect(runner.started).toBe(2)
  })

  it('runs two jobs side by side, each with its own progress', async () => {
    const canvas = new ControlledRunner()
    const ffmpeg = new ControlledRunner()
    const { startConversion } = await loadWorker({ canvas, ffmpeg })
    const seenA: number[] = []
    const seenB: number[] = []

    const a = startConversion(requestFor('canvas'), (p) => void seenA.push(p))
    const b = startConversion(requestFor('ffmpeg'), (p) => void seenB.push(p))
    await flush()
    canvas.complete()
    ffmpeg.complete()
    await Promise.all([a.result, b.result])

    expect(seenA).toEqual([0.5])
    expect(seenB).toEqual([0.5])
  })
})

describe('cancelConversion', () => {
  it('tears down the running engine and rejects its job', async () => {
    const runner = new ControlledRunner()
    const { startConversion, cancelConversion } = await loadWorker({ canvas: runner })

    const { jobId, result } = startConversion(requestFor())
    await flush()

    await expect(cancelConversion(jobId)).resolves.toBe(true)

    expect(runner.tornDown).toBe(1)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('leaves a job that was not named alone', async () => {
    const canvas = new ControlledRunner()
    const ffmpeg = new ControlledRunner()
    const { startConversion, cancelConversion } = await loadWorker({ canvas, ffmpeg })

    const doomed = startConversion(requestFor('canvas'))
    const survivor = startConversion(requestFor('ffmpeg'))
    await flush()
    await cancelConversion(doomed.jobId)
    ffmpeg.complete()

    await expect(doomed.result).rejects.toMatchObject({ name: 'AbortError' })
    await expect(survivor.result).resolves.toBeDefined()
    expect(ffmpeg.tornDown).toBe(0)
  })

  it('answers false for a job that has already finished', async () => {
    const runner = new ControlledRunner()
    const { startConversion, cancelConversion } = await loadWorker({ canvas: runner })

    const { jobId, result } = startConversion(requestFor())
    await flush()
    runner.complete()
    await result

    await expect(cancelConversion(jobId)).resolves.toBe(false)
  })

  it('does not start a worker just to cancel a job that never ran', async () => {
    const { cancelConversion } = await loadWorker({})

    await expect(cancelConversion('never-started')).resolves.toBe(false)
    expect(handle.spawns).toHaveLength(0)
  })
})

describe('terminateWorker, with jobs in flight', () => {
  it('rejects them instead of leaving their promises unsettled forever', async () => {
    const runner = new ControlledRunner()
    const { startConversion, terminateWorker } = await loadWorker({ canvas: runner })

    const { result } = startConversion(requestFor())
    await flush()
    terminateWorker()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await expect(result).rejects.toThrow(/shut down/i)
  })

  it('rejects every one of them', async () => {
    const canvas = new ControlledRunner()
    const ffmpeg = new ControlledRunner()
    const { startConversion, terminateWorker } = await loadWorker({ canvas, ffmpeg })

    const a = startConversion(requestFor('canvas'))
    const b = startConversion(requestFor('ffmpeg'))
    await flush()
    terminateWorker()

    await expect(a.result).rejects.toThrow(/shut down/i)
    await expect(b.result).rejects.toThrow(/shut down/i)
  })

  it('cannot un-resolve a job that already finished', async () => {
    const runner = new ControlledRunner()
    const { startConversion, terminateWorker } = await loadWorker({ canvas: runner })

    const { result } = startConversion(requestFor())
    await flush()
    runner.complete()
    await result
    terminateWorker()

    await expect(result).resolves.toBeDefined()
  })

  it('is still safe when nothing is running', async () => {
    const { terminateWorker } = await loadWorker({})

    expect(() => terminateWorker()).not.toThrow()
  })

  it('lets the next job start a fresh worker', async () => {
    const runner = new ControlledRunner()
    const { startConversion, terminateWorker } = await loadWorker({ canvas: runner })

    const first = startConversion(requestFor())
    await flush()
    terminateWorker()
    await expect(first.result).rejects.toThrow()

    const second = startConversion(requestFor())
    await flush()
    runner.complete()

    await expect(second.result).resolves.toBeDefined()
    expect(handle.spawns).toHaveLength(2)
  })
})

describe('a worker that dies on its own', () => {
  it('rejects the jobs it took down with it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runner = new ControlledRunner()
    const { startConversion } = await loadWorker({ canvas: runner })

    const { result } = startConversion(requestFor())
    await flush()
    handle.live[0].fail()

    await expect(result).rejects.toThrow(/worker/i)
    errors.mockRestore()
  })
})
