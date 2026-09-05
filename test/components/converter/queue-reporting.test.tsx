import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFileQueue } from '@/components/converter/use-file-queue'
import type { ProgressCallback } from '@/lib/engines/types'
import type { Capabilities, ConversionTask } from '@/lib/router/types'
import type { ConvertRequest } from '@/lib/worker/types'

/*
 * What the queue tells the counter, and — much more importantly — what it does
 * not (issue #84).
 *
 * `lib/stats/report.ts` is asserted in its own suite for what it puts on the
 * wire. This one is about the join: that a finished job reports, that a refused
 * job reports, that a *cancelled* job does not, and that the call is never
 * awaited. The last is the acceptance criterion — a failure of the counter must
 * never block or slow a conversion — and the way it is checked here is by
 * making the report hang forever and watching the job finish anyway.
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

const file = () => new File(['x'], 'photo.jpg', { type: 'image/jpeg' })

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

describe('what a finished job reports', () => {
  it('reports a success once the worker returns a file', async () => {
    const worker = controllable()
    const { result } = renderHook(() => useFileQueue())

    let id = ''
    act(() => {
      id = result.current.add([file()])[0].id
    })
    act(() => void result.current.run(id, jpgToPng))

    await waitFor(() => expect(startConversion).toHaveBeenCalled())
    await worker.finish()

    await waitFor(() => expect(reportConversion).toHaveBeenCalledTimes(1))
    expect(reportConversion).toHaveBeenCalledWith(jpgToPng, 1, 'success')
  })

  it('reports a failure when the engine throws', async () => {
    const worker = controllable()
    const { result } = renderHook(() => useFileQueue())

    let id = ''
    act(() => {
      id = result.current.add([file()])[0].id
    })
    act(() => void result.current.run(id, jpgToPng))

    await waitFor(() => expect(startConversion).toHaveBeenCalled())
    await worker.fail(new Error('the engine gave up'))

    await waitFor(() => expect(reportConversion).toHaveBeenCalledWith(jpgToPng, 1, 'failure'))
  })

  it('reports a failure when the router refuses the job outright', async () => {
    const { result } = renderHook(() => useFileQueue())

    let id = ''
    act(() => {
      id = result.current.add([file()])[0].id
    })
    await act(async () => {
      await result.current.run(id, impossible)
    })

    // A refusal is a conversion that did not happen, which is exactly what the
    // figures should be able to show.
    expect(reportConversion).toHaveBeenCalledWith(impossible, 1, 'failure')
    expect(startConversion).not.toHaveBeenCalled()
  })

  it('reports nothing for a job the user cancelled', async () => {
    const worker = controllable()
    const { result } = renderHook(() => useFileQueue())

    let id = ''
    act(() => {
      id = result.current.add([file()])[0].id
    })
    act(() => void result.current.run(id, jpgToPng))

    await waitFor(() => expect(startConversion).toHaveBeenCalled())
    act(() => result.current.cancel(id))
    await worker.fail(Object.assign(new Error('cancelled'), { name: 'AbortError' }))

    // Neither a success nor a failure: the user asked for it, and a cancelled
    // job is back in the list waiting to be run again.
    expect(reportConversion).not.toHaveBeenCalled()
  })

  it('never hands the file, its name or its exact size to the report', async () => {
    const worker = controllable()
    const { result } = renderHook(() => useFileQueue())

    let id = ''
    act(() => {
      id = result.current.add([new File(['x'.repeat(4096)], 'tax-return-2025.jpg')])[0].id
    })
    act(() => void result.current.run(id, jpgToPng))

    await waitFor(() => expect(startConversion).toHaveBeenCalled())
    await worker.finish()
    await waitFor(() => expect(reportConversion).toHaveBeenCalled())

    // The task, a byte count and an outcome. `reportConversion` turns the byte
    // count into one of five buckets before anything leaves the tab; what
    // matters here is that the `File` itself never reaches it.
    const [task, bytes, outcome] = reportConversion.mock.calls[0]

    expect(task).toEqual(jpgToPng)
    expect(typeof bytes).toBe('number')
    expect(outcome).toBe('success')
    expect(reportConversion.mock.calls[0]).toHaveLength(3)
    expect(JSON.stringify(reportConversion.mock.calls[0])).not.toContain('tax-return')
  })

  it('finishes the job even if the report never returns', async () => {
    // `reportConversion` is typed as returning nothing, but a caller that
    // awaited it anyway would hang here — which is the failure this guards.
    reportConversion.mockImplementation(() => new Promise(() => {}))

    const worker = controllable()
    const { result } = renderHook(() => useFileQueue())

    let id = ''
    act(() => {
      id = result.current.add([file()])[0].id
    })
    act(() => void result.current.run(id, jpgToPng))

    await waitFor(() => expect(startConversion).toHaveBeenCalled())
    await worker.finish()

    await waitFor(() => expect(result.current.jobs[0].state).toBe('done'))
  })
})
