/**
 * The worker half of the progress/cancel protocol, driven directly.
 *
 * `createConversionApi()` is called in-process here, with no Comlink and no
 * thread: `test/worker/jobs.test.ts` covers the boundary, and mixing the two
 * would make a cancellation test a test of message ordering. What matters at
 * this level is that an abort *stops work that would otherwise keep going* —
 * so the stand-in runner below produces something on every step, and the
 * assertions are about that production stopping, not about a flag flipping.
 *
 * The runner is pumped by hand rather than by a timer. Every step is a
 * microtask the test releases, which keeps the whole file deterministic and
 * leaves the fake clock free to test the 250 ms window on its own terms.
 */

import * as Comlink from 'comlink'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EngineInput, EngineRunner, ProgressCallback } from '@/lib/engines/types'
import type { EngineId } from '@/lib/router/types'
import { type RunnerLoader, createConversionApi } from '@/lib/worker/api'
import { PROGRESS_INTERVAL_MS } from '@/lib/worker/progress-relay'
import type { ConvertRequest, RemoteProgressCallback } from '@/lib/worker/types'

const TASK = { from: 'png', to: 'webp', op: 'convert' } as const

function requestFor(jobId?: string, engine: EngineId = 'canvas'): ConvertRequest {
  return { engine, jobId, task: TASK, files: [new Blob(['source'])] }
}

/** Lets microtask-driven work run to its next suspension point. */
async function settle(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
}

/**
 * A runner that never finishes on its own.
 *
 * It emits a tick and then waits for the test to release it, so "did the work
 * actually stop?" becomes an exact question: pump it a few more times after the
 * cancel and see whether `ticks` moved.
 */
class PumpedRunner implements EngineRunner {
  ticks = 0
  started = false
  input: EngineInput | null = null
  /** Set when the runner ignores its signal — used to prove the API still refuses the result. */
  constructor(private readonly obeysSignal = true) {}
  private waiting: Array<() => void> = []

  async run(input: EngineInput, signal: AbortSignal, onProgress: ProgressCallback): Promise<Blob> {
    this.started = true
    this.input = input

    while (this.ticks < 500) {
      if (this.obeysSignal && signal.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      this.ticks += 1
      onProgress(this.ticks / 500)
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }

    return new Blob(['converted'])
  }

  /** Releases every step currently waiting, then lets the loop run on. */
  async pump(times = 1): Promise<void> {
    for (let time = 0; time < times; time += 1) {
      const waiting = this.waiting
      this.waiting = []
      for (const resume of waiting) resume()
      await settle()
    }
  }
}

function loaderFor(runner: EngineRunner): RunnerLoader {
  return async () => runner
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('convert', () => {
  it('hands the runner the engine input and nothing else', async () => {
    const runner = new PumpedRunner()
    const api = createConversionApi(loaderFor(runner))
    const request = requestFor('a')

    void api.convert(request)
    await settle()

    expect(runner.input).toEqual({ task: TASK, files: request.files })
  })

  it('asks the loader for the engine the router chose', async () => {
    const asked: EngineId[] = []
    const api = createConversionApi(async (engine) => {
      asked.push(engine)
      return new PumpedRunner()
    })

    void api.convert(requestFor('a', 'ffmpeg'))
    await settle()

    expect(asked).toEqual(['ffmpeg'])
  })

  it('resolves with the blob the runner produced', async () => {
    const runner: EngineRunner = { run: async () => new Blob(['out']) }
    const api = createConversionApi(loaderFor(runner))

    await expect(api.convert(requestFor('a'))).resolves.toBeInstanceOf(Blob)
  })

  it('still has no engine behind it when no loader is supplied', async () => {
    const api = createConversionApi()

    await expect(api.convert(requestFor('a'))).rejects.toThrow(/canvas/)
  })

  it('refuses a job id that another running job already holds', async () => {
    const api = createConversionApi(loaderFor(new PumpedRunner()))

    void api.convert(requestFor('duplicate'))
    await settle()

    await expect(api.convert(requestFor('duplicate'))).rejects.toThrow(/duplicate/)
  })

  it('leaves the first job running when a duplicate id is refused', async () => {
    const runner = new PumpedRunner()
    const api = createConversionApi(loaderFor(runner))

    void api.convert(requestFor('duplicate'))
    await settle()
    await expect(api.convert(requestFor('duplicate'))).rejects.toThrow()
    await runner.pump()

    expect(runner.ticks).toBe(2)
    expect(api.cancel('duplicate')).toBe(true)
  })

  it('runs a job without an id, which simply cannot be cancelled', async () => {
    const runner = new PumpedRunner()
    const api = createConversionApi(loaderFor(runner))

    void api.convert(requestFor(undefined))
    await settle()

    expect(runner.started).toBe(true)
    expect(api.cancel('anything')).toBe(false)
  })
})

describe('cancel', () => {
  it('stops a job that would otherwise keep producing', async () => {
    const runner = new PumpedRunner()
    const api = createConversionApi(loaderFor(runner))
    const result = api.convert(requestFor('a'))
    await settle()
    await runner.pump(2)

    const before = runner.ticks
    expect(api.cancel('a')).toBe(true)
    await runner.pump(5)

    expect(runner.ticks).toBe(before)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('settles only once the runner has unwound, so "cancelled" means "stopped"', async () => {
    const runner = new PumpedRunner()
    const api = createConversionApi(loaderFor(runner))
    const result = api.convert(requestFor('a'))
    const outcome = vi.fn()
    void result.then(outcome, outcome)
    await settle()

    api.cancel('a')
    await settle()

    // The runner is still suspended mid-step. Resolving here would report a job
    // as stopped while its engine was demonstrably still holding the thread.
    expect(outcome).not.toHaveBeenCalled()

    await runner.pump(1)

    expect(outcome).toHaveBeenCalledTimes(1)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('leaves every other job alone', async () => {
    const doomed = new PumpedRunner()
    const survivor = new PumpedRunner()
    const api = createConversionApi(async (engine) => (engine === 'canvas' ? doomed : survivor))

    const doomedResult = api.convert(requestFor('doomed', 'canvas'))
    void api.convert(requestFor('survivor', 'ffmpeg'))
    await settle()

    api.cancel('doomed')
    await doomed.pump(3)
    await survivor.pump(3)

    await expect(doomedResult).rejects.toMatchObject({ name: 'AbortError' })
    expect(survivor.ticks).toBe(4)
  })

  it('answers false for a job that was never started', () => {
    const api = createConversionApi(loaderFor(new PumpedRunner()))

    expect(api.cancel('never-started')).toBe(false)
  })

  it('answers false once the job has finished, rather than throwing at a late click', async () => {
    const api = createConversionApi(loaderFor({ run: async () => new Blob(['out']) }))

    await api.convert(requestFor('a'))

    expect(api.cancel('a')).toBe(false)
  })

  it('frees the id when the job settles, so the same id can be used again', async () => {
    const api = createConversionApi(loaderFor({ run: async () => new Blob(['out']) }))

    await api.convert(requestFor('a'))

    await expect(api.convert(requestFor('a'))).resolves.toBeInstanceOf(Blob)
  })

  it('frees the id after a job that failed', async () => {
    const api = createConversionApi(
      loaderFor({
        run: async () => {
          throw new Error('engine exploded')
        },
      }),
    )

    await expect(api.convert(requestFor('a'))).rejects.toThrow(/exploded/)

    expect(api.cancel('a')).toBe(false)
  })

  it('stops a job that was cancelled while its engine was still downloading', async () => {
    const runner = new PumpedRunner()
    let arrive: () => void = () => {}
    const api = createConversionApi(async () => {
      await new Promise<void>((resolve) => {
        arrive = resolve
      })
      return runner
    })

    const result = api.convert(requestFor('a'))
    await settle()
    expect(api.cancel('a')).toBe(true)
    arrive()
    await settle()

    expect(runner.started).toBe(false)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses to deliver the output of a runner that ignored its signal', async () => {
    const stubborn = new PumpedRunner(false)
    const api = createConversionApi(loaderFor(stubborn))
    const result = api.convert(requestFor('a'))
    await settle()

    api.cancel('a')
    await stubborn.pump(1)
    // The runner never checks the signal, so let it run to its natural end.
    stubborn.ticks = 499
    await stubborn.pump(2)

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('progress', () => {
  it('reaches the caller as soon as the engine reports', async () => {
    const seen: number[] = []
    const runner = new PumpedRunner()
    const api = createConversionApi(loaderFor(runner))

    void api.convert(
      requestFor('a'),
      progressCallback((p) => void seen.push(p)),
    )
    await settle()

    expect(seen).toEqual([1 / 500])
  })

  it('coalesces a burst into one message per window', async () => {
    const seen: number[] = []
    const runner = new PumpedRunner()
    const api = createConversionApi(loaderFor(runner))

    void api.convert(
      requestFor('a'),
      progressCallback((p) => void seen.push(p)),
    )
    await settle()
    await runner.pump(30)

    expect(seen).toEqual([1 / 500])

    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS)

    expect(seen).toEqual([1 / 500, 31 / 500])
  })

  it('keeps the window open no longer than the engine contract allows', async () => {
    const seen: number[] = []
    const runner = new PumpedRunner()
    const api = createConversionApi(loaderFor(runner))

    void api.convert(
      requestFor('a'),
      progressCallback((p) => void seen.push(p)),
    )
    await settle()
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS * 3)

    expect(seen).toHaveLength(4)
  })

  it('stops the moment the job does, and leaves no timer running', async () => {
    const seen: number[] = []
    const api = createConversionApi(loaderFor({ run: async () => new Blob(['out']) }))

    await api.convert(
      requestFor('a'),
      progressCallback((p) => void seen.push(p)),
    )
    const after = seen.length
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS * 4)

    expect(seen).toHaveLength(after)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops after a cancelled job too', async () => {
    const seen: number[] = []
    const runner = new PumpedRunner()
    const api = createConversionApi(loaderFor(runner))
    const result = api.convert(
      requestFor('a'),
      progressCallback((p) => void seen.push(p)),
    )
    await settle()

    api.cancel('a')
    await runner.pump(1)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })

    const after = seen.length
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS * 4)

    expect(seen).toHaveLength(after)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('is optional — a caller that does not want ticks pays for none', async () => {
    const runner = new PumpedRunner()
    const api = createConversionApi(loaderFor(runner))

    void api.convert(requestFor('a'))
    await settle()
    await runner.pump(3)

    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases the callback proxy when the job settles, so its port is not leaked', async () => {
    const released = vi.fn()
    const callback = progressCallback(() => {}, released)
    const api = createConversionApi(loaderFor({ run: async () => new Blob(['out']) }))

    await api.convert(requestFor('a'), callback)

    expect(released).toHaveBeenCalledTimes(1)
  })

  it('releases the callback proxy after a cancelled job as well', async () => {
    const released = vi.fn()
    const runner = new PumpedRunner()
    const api = createConversionApi(loaderFor(runner))
    const result = api.convert(
      requestFor('a'),
      progressCallback(() => {}, released),
    )
    await settle()

    api.cancel('a')
    await runner.pump(1)
    await expect(result).rejects.toThrow()

    expect(released).toHaveBeenCalledTimes(1)
  })
})

describe('ping', () => {
  it('still answers, loader or no loader', () => {
    expect(createConversionApi().ping()).toBe('pong')
  })
})

/**
 * Builds what Comlink actually delivers to the worker: a proxy-marked function
 * that also answers to `releaseProxy`. `Comlink.proxy()` supplies the mark; the
 * release hook is what a real remote proxy adds on this side of the boundary.
 */
function progressCallback(fn: ProgressCallback, release?: () => void): RemoteProgressCallback {
  const marked = Comlink.proxy(fn) as RemoteProgressCallback & {
    [Comlink.releaseProxy]?: () => void
  }
  if (release !== undefined) marked[Comlink.releaseProxy] = release
  return marked
}
