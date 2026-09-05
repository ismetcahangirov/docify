import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFileQueue } from '@/components/converter/use-file-queue'
import type { ProgressCallback } from '@/lib/engines/types'
import type { Capabilities, ConversionTask } from '@/lib/router/types'
import type { ConvertRequest } from '@/lib/worker/types'

/*
 * The impure half of the queue (issue #57): routing a job, handing it to the
 * worker, and putting every answer back through the state table.
 *
 * The worker is mocked and the router is not. Mocking `route()` would leave the
 * most interesting assertion — that a refusal becomes a `failed` job carrying
 * the router's own message and suggestion — testing a stub's opinion of itself.
 * `probeCapabilities` is mocked because jsdom has no WebCodecs, no
 * `OffscreenCanvas` and no `deviceMemory`, so the real probe would answer for a
 * device nobody has.
 */

const startConversion = vi.hoisted(() => vi.fn())
// Resolving, like the real one: the hook attaches a `catch` to it so that a
// worker dying mid-cancel is not an unhandled rejection.
const cancelConversion = vi.hoisted(() => vi.fn(async () => true))
const probeCapabilities = vi.hoisted(() => vi.fn())
const reportConversion = vi.hoisted(() => vi.fn())

vi.mock('@/lib/worker/jobs', () => ({ startConversion, cancelConversion }))
vi.mock('@/lib/router/capabilities', () => ({ probeCapabilities }))
vi.mock('@/lib/stats/report', () => ({ reportConversion }))

const desktop: Capabilities = {
  crossOriginIsolated: true,
  wasmSimd: true,
  deviceMemoryGb: 8,
  cores: 8,
  webCodecsVideo: true,
  webCodecsAudio: true,
  offscreenCanvas: true,
  createImageBitmap: true,
  platform: 'desktop',
  browser: 'chromium',
}

const jpgToPng: ConversionTask = { from: 'jpg', to: 'png', op: 'convert' }
const impossible: ConversionTask = { from: 'rar', to: 'flac', op: 'convert' }

const file = (name = 'photo.jpg') => new File(['x'], name, { type: 'image/jpeg' })

/** A worker whose one job is settled by hand, tick by tick. */
function controllable() {
  let settle!: (blob: Blob) => void
  let reject!: (reason: unknown) => void
  let report: ProgressCallback = () => {}

  startConversion.mockImplementation((_request: ConvertRequest, onProgress?: ProgressCallback) => {
    if (onProgress !== undefined) report = onProgress

    return {
      jobId: 'worker-1',
      result: new Promise<Blob>((resolve, rejectResult) => {
        settle = resolve
        reject = rejectResult
      }),
    }
  })

  return {
    tick: (progress: number) => act(() => report(progress)),
    finish: (blob = new Blob(['out'])) => act(async () => settle(blob)),
    fail: (reason: unknown) => act(async () => reject(reason)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  probeCapabilities.mockReturnValue(desktop)
})

describe('useFileQueue — the list', () => {
  it('adds files in the order they were offered', () => {
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file('a.jpg'), file('b.jpg')])
    })

    expect(result.current.jobs.map((job) => job.file.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(result.current.jobs.every((job) => job.state === 'queued')).toBe(true)
  })

  it('gives every file its own id, even for two files with the same name', () => {
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file(), file()])
    })

    const [first, second] = result.current.jobs
    expect(first.id).not.toBe(second.id)
  })

  it('removes one file without touching the rest', () => {
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file('a.jpg'), file('b.jpg')])
    })
    act(() => {
      result.current.remove(result.current.jobs[0].id)
    })

    expect(result.current.jobs.map((job) => job.file.name)).toEqual(['b.jpg'])
  })

  it('stops the worker when the file taken out was still being converted', async () => {
    // Otherwise the engine keeps working on a file the user discarded, and the
    // scheduler waits for it before starting the next one (issue #278).
    controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalled())

    act(() => {
      result.current.remove(id)
    })

    expect(cancelConversion).toHaveBeenCalledWith('worker-1')
    expect(result.current.jobs).toHaveLength(0)
  })

  it('asks the worker for nothing when the file taken out was not running', () => {
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    act(() => {
      result.current.remove(result.current.jobs[0].id)
    })

    expect(cancelConversion).not.toHaveBeenCalled()
  })
})

describe('useFileQueue — running a job', () => {
  it('walks the four states in order and ends with the converted file', async () => {
    const worker = controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })

    // Routing has already happened by the time the worker was called: the
    // engine is chosen before anything is handed across.
    await waitFor(() => expect(startConversion).toHaveBeenCalled())
    expect(result.current.jobs[0].state).toBe('loading-engine')
    expect(result.current.jobs[0].engine).toBe('canvas')
    // The engine's own label, straight off the route result, so the badge in
    // #59 has something to say without deciding anything itself.
    expect(result.current.jobs[0].reason).toBe('Built into your browser')

    worker.tick(0.5)
    expect(result.current.jobs[0].state).toBe('processing')
    expect(result.current.jobs[0].progress).toBe(0.5)

    await worker.finish()
    await waitFor(() => expect(result.current.jobs[0].state).toBe('done'))
    expect(result.current.jobs[0].result).toBeInstanceOf(Blob)
  })

  it('hands the worker the engine the router chose, and the budget it computed', async () => {
    controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalled())

    const request = startConversion.mock.calls[0][0] as ConvertRequest
    expect(request.engine).toBe('canvas')
    expect(request.files).toHaveLength(1)
    expect(request.budgetBytes).toBeGreaterThan(0)
  })

  it('carries the job settings through untouched', async () => {
    controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng, { image: { quality: 62 } })
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalled())

    expect((startConversion.mock.calls[0][0] as ConvertRequest).image).toEqual({ quality: 62 })
  })

  it('never starts a job that is already running', async () => {
    controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(1))

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })

    // Two workers on one file is two results, and a list showing whichever
    // arrived last.
    expect(startConversion).toHaveBeenCalledTimes(1)
  })
})

describe('useFileQueue — when it does not work', () => {
  it('turns a router refusal into a failure the user can act on', async () => {
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file('archive.rar')])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      await result.current.run(id, impossible)
    })

    const failed = result.current.jobs[0]
    expect(failed.state).toBe('failed')
    expect(failed.failure?.code).toBe('UNSUPPORTED_PAIR')
    // CLAUDE.md section 2.5: a rejection always says what to do next.
    expect(failed.failure?.message.length).toBeGreaterThan(0)
    expect(failed.failure?.suggestion?.length).toBeGreaterThan(0)
    expect(startConversion).not.toHaveBeenCalled()
  })

  it('quotes what the engine said when one throws', async () => {
    const worker = controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalled())

    await worker.fail(new Error('This image is larger than a canvas can hold.'))

    await waitFor(() => expect(result.current.jobs[0].state).toBe('failed'))
    expect(result.current.jobs[0].failure?.message).toMatch(/larger than a canvas/)
  })

  it('says something rather than nothing when an engine throws a bare value', async () => {
    const worker = controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalled())

    await worker.fail(undefined)

    await waitFor(() => expect(result.current.jobs[0].state).toBe('failed'))
    expect(result.current.jobs[0].failure?.message.length).toBeGreaterThan(0)
  })
})

describe('useFileQueue — cancelling', () => {
  it('reaches the worker and returns the file to the queue', async () => {
    controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalled())

    act(() => {
      result.current.cancel(id)
    })

    expect(cancelConversion).toHaveBeenCalledWith('worker-1')
    // Back in the list, ready to go again, rather than a dead end that makes
    // the user drop the file a second time.
    expect(result.current.jobs[0].state).toBe('queued')
    expect(result.current.jobs[0].file.name).toBe('photo.jpg')
  })

  it('does not mark a cancelled job failed when the abort finally arrives', async () => {
    const worker = controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalled())

    act(() => {
      result.current.cancel(id)
    })

    const abort = new Error('The conversion was cancelled.')
    abort.name = 'AbortError'
    await worker.fail(abort)

    expect(result.current.jobs[0].state).toBe('queued')
  })

  it('can be run again after a cancel', async () => {
    controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.cancel(id)
    })

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })

    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(2))
  })
})

describe('useFileQueue — trying again', () => {
  /** A job the router has refused, so it sits in `failed` with no worker involved. */
  async function failed() {
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      await result.current.run(id, impossible)
    })
    expect(result.current.jobs[0].state).toBe('failed')
    vi.clearAllMocks()
    probeCapabilities.mockReturnValue(desktop)

    return { result, id }
  }

  it('runs a failed job again, all the way to done (issue #263)', async () => {
    const worker = controllable()
    const { result, id } = await failed()

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })

    // The state table has no `start` out of `failed`; the run has to go back
    // through `queued` first, or the reducer drops every event that follows and
    // the worker converts a file the list never shows moving.
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(1))
    expect(result.current.jobs[0].state).toBe('loading-engine')
    expect(result.current.jobs[0].failure).toBeUndefined()

    await worker.finish()
    await waitFor(() => expect(result.current.jobs[0].state).toBe('done'))
  })

  it('reports the retried conversion exactly once', async () => {
    const worker = controllable()
    const { result, id } = await failed()

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(1))
    await worker.finish()
    await waitFor(() => expect(result.current.jobs[0].state).toBe('done'))

    expect(reportConversion).toHaveBeenCalledTimes(1)
    expect(reportConversion).toHaveBeenCalledWith(jpgToPng, expect.any(Number), 'success')
  })

  it('retry() returns a finished job to the queue without starting it', async () => {
    const { result, id } = await failed()

    act(() => {
      result.current.retry(id)
    })

    expect(result.current.jobs[0].state).toBe('queued')
    expect(result.current.jobs[0].file.name).toBe('photo.jpg')
    expect(startConversion).not.toHaveBeenCalled()
  })

  it('retry() leaves a running job alone', async () => {
    controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalled())

    act(() => {
      result.current.retry(id)
    })

    expect(result.current.jobs[0].state).toBe('loading-engine')
  })
})

describe('useFileQueue — a run that is no longer current (issue #264)', () => {
  /** A file whose header read is settled by hand, so a cancel can land inside it. */
  function slowFile() {
    let release!: () => void
    const header = new Promise<ArrayBuffer>((resolve) => {
      release = () => resolve(new ArrayBuffer(8))
    })
    const slow = file()
    Object.defineProperty(slow, 'slice', { value: () => ({ arrayBuffer: () => header }) })

    return { file: slow, release: () => act(async () => release()) }
  }

  /** A worker whose every job is settled separately, in the order it was started. */
  function multiWorker() {
    const jobs: { settle: (blob: Blob) => void; reject: (reason: unknown) => void }[] = []

    startConversion.mockImplementation(() => {
      let settle!: (blob: Blob) => void
      let reject!: (reason: unknown) => void
      const result = new Promise<Blob>((resolve, rejectResult) => {
        settle = resolve
        reject = rejectResult
      })
      jobs.push({ settle, reject })

      return { jobId: `worker-${jobs.length}`, result }
    })

    return {
      finish: (index: number, blob: Blob) => act(async () => jobs[index].settle(blob)),
      abort: (index: number) =>
        act(async () => {
          const abort = new Error('The conversion was cancelled.')
          abort.name = 'AbortError'
          jobs[index].reject(abort)
        }),
    }
  }

  it('never reaches the worker when the file is taken out while the engine is being chosen', async () => {
    // No worker id exists yet, so there is nothing to cancel — and the run must
    // still stop, rather than handing a discarded file to an engine and leaving
    // the scheduler waiting for it (issue #278).
    controllable()
    const slow = slowFile()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([slow.file])
    })
    const id = result.current.jobs[0].id

    let finished = false
    await act(async () => {
      void result.current.run(id, jpgToPng).then(() => {
        finished = true
      })
    })
    expect(result.current.jobs[0].state).toBe('routing')

    act(() => {
      result.current.remove(id)
    })
    await slow.release()

    expect(cancelConversion).not.toHaveBeenCalled()
    expect(startConversion).not.toHaveBeenCalled()
    expect(result.current.jobs).toHaveLength(0)
    // The run still settles, which is what frees the scheduler for the next
    // file.
    await waitFor(() => expect(finished).toBe(true))
  })

  it('never reaches the worker when the cancel lands while the engine is being chosen', async () => {
    controllable()
    const slow = slowFile()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([slow.file])
    })
    const id = result.current.jobs[0].id

    let finished = false
    await act(async () => {
      void result.current.run(id, jpgToPng).then(() => {
        finished = true
      })
    })
    expect(result.current.jobs[0].state).toBe('routing')

    act(() => {
      result.current.cancel(id)
    })
    expect(result.current.jobs[0].state).toBe('queued')

    await slow.release()

    // The header came back to a run nobody wants any more: no engine is
    // chosen, nothing is downloaded, and the scheduler is not held for it.
    // `run` has to have resolved first, or the negative assertion is only
    // about how far the microtasks happened to get.
    await waitFor(() => expect(finished).toBe(true))
    expect(startConversion).not.toHaveBeenCalled()
    expect(result.current.jobs[0].state).toBe('queued')
    expect(result.current.jobs[0].engine).toBeUndefined()
  })

  it('still lets a cancel reach the newer worker after the older run has settled', async () => {
    const worker = multiWorker()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(1))
    act(() => {
      result.current.cancel(id)
    })
    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(2))

    // The first worker job settles late. Its clean-up must not take the
    // second run's worker id with it, or this next cancel reaches nothing.
    await worker.finish(0, new Blob(['stale']))
    act(() => {
      result.current.cancel(id)
    })

    expect(cancelConversion).toHaveBeenLastCalledWith('worker-2')
  })

  it('does not let an old worker abort send the restarted job back to waiting', async () => {
    const worker = multiWorker()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(1))
    act(() => {
      result.current.cancel(id)
    })
    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(2))

    // `loading-engine` answers `cancel`, so by state alone the old worker's
    // abort would be applied to the new run — and the card would show
    // "Waiting" over a worker that is still converting.
    await worker.abort(0)

    expect(result.current.jobs[0].state).toBe('loading-engine')

    const fresh = new Blob(['fresh'])
    await worker.finish(1, fresh)
    await waitFor(() => expect(result.current.jobs[0].state).toBe('done'))
    expect(result.current.jobs[0].result).toBe(fresh)
  })

  it('still returns the job to the queue when the worker dies under the current run', async () => {
    const worker = controllable()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalled())

    // Nobody cancelled: the abort is the worker going down. That is the one
    // abort that still has to reach the list.
    const abort = new Error('The worker stopped.')
    abort.name = 'AbortError'
    await worker.fail(abort)

    expect(result.current.jobs[0].state).toBe('queued')
    // Marked like a job the user stopped, because the card owes it the same
    // thing: the scheduler will not pick it up again on its own (issue #278).
    expect(result.current.jobs[0].cancelled).toBe(true)
    expect(reportConversion).not.toHaveBeenCalled()
  })

  it('drops the result of a cancelled run rather than landing it on the next one', async () => {
    const worker = multiWorker()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.cancel(id)
    })

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(2))
    expect(result.current.jobs[0].state).toBe('loading-engine')

    // The first worker job settles late, with the old file. By state alone the
    // reducer would accept it — the job is running again — which is why the
    // run has to be identified, not just the job.
    const stale = new Blob(['stale'])
    await worker.finish(0, stale)

    expect(result.current.jobs[0].state).toBe('loading-engine')
    expect(result.current.jobs[0].result).toBeUndefined()

    const fresh = new Blob(['fresh'])
    await worker.finish(1, fresh)

    await waitFor(() => expect(result.current.jobs[0].state).toBe('done'))
    expect(result.current.jobs[0].result).toBe(fresh)
  })

  it('does not count a cancelled run that finishes anyway', async () => {
    const worker = multiWorker()
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.cancel(id)
    })
    await worker.finish(0, new Blob(['stale']))

    expect(reportConversion).not.toHaveBeenCalled()
    expect(result.current.jobs[0].state).toBe('queued')
  })

  it('ignores a progress tick from a cancelled run once the job is running again', async () => {
    const reports: ProgressCallback[] = []
    startConversion.mockImplementation(
      (_request: ConvertRequest, onProgress?: ProgressCallback) => {
        if (onProgress !== undefined) reports.push(onProgress)

        return { jobId: `worker-${reports.length}`, result: new Promise<Blob>(() => {}) }
      },
    )
    const { result } = renderHook(() => useFileQueue())

    act(() => {
      result.current.add([file()])
    })
    const id = result.current.jobs[0].id

    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(1))
    act(() => {
      result.current.cancel(id)
    })
    await act(async () => {
      void result.current.run(id, jpgToPng)
    })
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(2))

    // The old worker job is still unwinding and reports once more.
    act(() => reports[0](0.9))

    expect(result.current.jobs[0].state).toBe('loading-engine')
    expect(result.current.jobs[0].progress).toBeNull()
  })
})
