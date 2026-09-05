import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Converter } from '@/components/converter/converter'
import { pairBySlug } from '@/lib/registry/pairs'
import { startConversion } from '@/lib/worker/jobs'

/*
 * The converter island, composed (issue #66).
 *
 * The pieces were built and tested one at a time across EPIC 7. What is
 * asserted here is the wiring between them — that the task comes from the page
 * rather than from a picker, that dropping a file starts a job, and that a
 * refusal reaches the card that explains it.
 *
 * The worker is stubbed. A real one needs a browser and a WASM engine, and the
 * question here is what this component does with what comes back, not whether
 * an engine works.
 */

const pair = pairBySlug('heic-to-jpg')!

const converted = new Blob(['jpg'], { type: 'image/jpeg' })

let resolveResult: ((blob: Blob) => void) | undefined
let rejectResult: ((reason: unknown) => void) | undefined

vi.mock('@/lib/worker/jobs', () => ({
  startConversion: vi.fn(() => ({
    jobId: 'worker-1',
    result: new Promise<Blob>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    }),
  })),
  cancelConversion: vi.fn(async () => true),
}))

/*
 * A capable desktop. jsdom has neither `createImageBitmap` nor
 * `OffscreenCanvas`, so the real probe makes the router refuse every image
 * conversion — which would turn every assertion below into a test of the
 * rejection path. That path has its own tests in `./rejection.test.tsx`.
 */
vi.mock('@/lib/router/capabilities', () => ({
  probeCapabilities: () => ({
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
  }),
}))

const file = (name: string) => new File(['x'.repeat(64)], name, { type: 'image/heic' })

const drop = (names: readonly string[]) => {
  const input = screen.getByLabelText(/drop your heic files here/i)

  fireEvent.change(input, { target: { files: names.map(file) } })
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:docify/0',
    revokeObjectURL: () => {},
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  // Otherwise a `waitFor(() => expect(rejectResult).toBeDefined())` in the
  // next test would be satisfied by this test's leftover resolver.
  resolveResult = undefined
  rejectResult = undefined
})

/** The running job's own settle functions, which the worker stub set on its last call. */
const settle = () => {
  if (resolveResult === undefined || rejectResult === undefined) {
    throw new Error('no conversion has been started')
  }

  return { resolve: resolveResult, reject: rejectResult }
}

describe('the converter offers no choice the URL already made', () => {
  it('names the source format in the dropzone', () => {
    render(<Converter pair={pair} />)

    expect(screen.getByText(/drop your heic files here/i)).toBeInTheDocument()
  })

  it('says what it converts to, and that nothing leaves the device', () => {
    render(<Converter pair={pair} />)

    expect(screen.getByText(/converted to JPG on this device/i)).toBeInTheDocument()
    expect(screen.getByText(/No HEIC file is sent anywhere/i)).toBeInTheDocument()
  })

  it('offers no format picker, because the page is the choice', () => {
    render(<Converter pair={pair} />)

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('accepts only the source format', () => {
    render(<Converter pair={pair} />)

    expect(screen.getByLabelText(/drop your heic files here/i)).toHaveAttribute(
      'accept',
      'image/heic,.heic',
    )
  })
})

describe('dropping files', () => {
  it('puts every file in the queue, in the order they arrived', async () => {
    render(<Converter pair={pair} />)
    drop(['one.heic', 'two.heic'])

    const queue = await screen.findByRole('list', { name: /HEIC to JPG queue/i })
    const names = within(queue)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)

    expect(names).toEqual(['one.heic', 'two.heic'])
  })

  it('announces the queue changing through a single live region', async () => {
    render(<Converter pair={pair} />)
    drop(['one.heic'])

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/one\.heic/)
    })
  })

  it('shows a result to download once a job finishes', async () => {
    render(<Converter pair={pair} />)
    drop(['holiday.heic'])

    await waitFor(() => expect(resolveResult).toBeDefined())
    settle().resolve(converted)

    const link = await screen.findByRole('link', { name: 'holiday.jpg' })
    expect(link).toHaveAttribute('download', 'holiday.jpg')
  })

  it('explains a failure on the card it belongs to', async () => {
    render(<Converter pair={pair} />)
    drop(['broken.heic'])

    await waitFor(() => expect(rejectResult).toBeDefined())
    settle().reject(new Error('The decoder gave up.'))

    expect(await screen.findByText('The decoder gave up.')).toBeInTheDocument()
  })

  it('offers nothing to download while nothing has finished', () => {
    render(<Converter pair={pair} />)

    expect(screen.queryByRole('region', { name: /results/i })).not.toBeInTheDocument()
  })
})

describe('trying again', () => {
  it('waits its turn behind the job that is running (issue #263)', async () => {
    render(<Converter pair={pair} />)
    drop(['broken.heic', 'slow.heic'])

    // The first job fails; the scheduler then starts the second.
    await waitFor(() => expect(rejectResult).toBeDefined())
    settle().reject(new Error('The decoder gave up.'))
    await screen.findByText('The decoder gave up.')
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: /try converting broken\.heic again/i }))

    // Every engine is budgeted for a tab of its own, so the retry queues up
    // rather than running alongside the job already in flight.
    await waitFor(() => expect(screen.queryByText('The decoder gave up.')).not.toBeInTheDocument())
    expect(startConversion).toHaveBeenCalledTimes(2)

    settle().resolve(converted)
    await screen.findByRole('link', { name: 'slow.jpg' })

    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(3))
  })

  it('is still taken in turn when the job ahead of it is cancelled instead', async () => {
    render(<Converter pair={pair} />)
    drop(['broken.heic', 'slow.heic'])

    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(1))
    settle().reject(new Error('The decoder gave up.'))
    await screen.findByText('The decoder gave up.')
    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: /try converting broken\.heic again/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel converting slow\.heic/i }))

    // A cancel ends the running job without a new state for the list to show
    // — it is already back in `queued` — so this is the one way a run can
    // finish without a render. The retry must not be left waiting for one.
    const abort = new Error('The conversion was cancelled.')
    abort.name = 'AbortError'
    settle().reject(abort)

    await waitFor(() => expect(startConversion).toHaveBeenCalledTimes(3))
    expect((startConversion as ReturnType<typeof vi.fn>).mock.calls[2][0].files[0].name).toBe(
      'broken.heic',
    )
  })
})
