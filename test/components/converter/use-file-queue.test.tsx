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
const cancelConversion = vi.hoisted(() => vi.fn())
const probeCapabilities = vi.hoisted(() => vi.fn())

vi.mock('@/lib/worker/jobs', () => ({ startConversion, cancelConversion }))
vi.mock('@/lib/router/capabilities', () => ({ probeCapabilities }))

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
