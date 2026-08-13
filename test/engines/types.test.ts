import { describe, expect, expectTypeOf, it } from 'vitest'

import type {
  EngineDescriptor,
  EngineInput,
  EngineOptions,
  EngineRunner,
  ProgressCallback,
} from '@/lib/engines/types'
import type { Capabilities, ConversionTask } from '@/lib/router/types'

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

const vips: EngineDescriptor = {
  id: 'vips',
  label: 'High-quality image processing',
  loadCost: 5_500_000,
  priority: 40,
  supports: (task, caps) => task.from === 'tiff' && task.to === 'png' && caps.wasmSimd,
}

describe('EngineDescriptor', () => {
  it('is the cheap, statically importable half of an engine', () => {
    expect(vips.id).toBe('vips')
    expect(vips.loadCost).toBe(5_500_000)
    expect(vips.priority).toBe(40)
  })

  it('decides support from the task and capabilities alone', () => {
    const task: ConversionTask = { from: 'tiff', to: 'png', op: 'convert' }

    expect(vips.supports(task, desktop)).toBe(true)
    expect(vips.supports(task, { ...desktop, wasmSimd: false })).toBe(false)
  })

  it('types supports() as a synchronous predicate — the router never awaits', () => {
    expectTypeOf<EngineDescriptor['supports']>().toEqualTypeOf<
      (task: ConversionTask, caps: Capabilities) => boolean
    >()
  })

  it('constrains id to the EngineId union', () => {
    // @ts-expect-error 'imagemagick' is not an EngineId
    const bogus: EngineDescriptor = { ...vips, id: 'imagemagick' }

    expect(bogus.id).toBe('imagemagick')
  })

  it('requires a label, a load cost and a priority', () => {
    // @ts-expect-error loadCost and priority are mandatory
    const incomplete: EngineDescriptor = { id: 'canvas', label: 'Canvas', supports: () => true }

    expect(incomplete.id).toBe('canvas')
  })
})

describe('EngineRunner', () => {
  it('runs a job with a cancel signal and a progress callback', async () => {
    const seen: number[] = []
    const runner: EngineRunner = {
      async run(input, signal, onProgress) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        onProgress(0.5)
        onProgress(1)
        return new Blob([`${input.task.from}->${input.task.to}`])
      },
    }

    const input: EngineInput = {
      task: { from: 'png', to: 'webp', op: 'convert' },
      files: [new Blob(['x'])],
      options: { quality: 82 },
    }
    const out = await runner.run(input, new AbortController().signal, (p) => seen.push(p))

    expect(seen).toEqual([0.5, 1])
    expect(await out.text()).toBe('png->webp')
  })

  it('honours an already-aborted signal', async () => {
    const runner: EngineRunner = {
      async run(_input, signal) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        return new Blob()
      },
    }
    const controller = new AbortController()
    controller.abort()

    await expect(
      runner.run(
        { task: { from: 'mp4', to: 'webm', op: 'convert' }, files: [new Blob()] },
        controller.signal,
        () => {},
      ),
    ).rejects.toThrow('Aborted')
  })

  it('takes the signal and the progress callback as positional arguments', () => {
    expectTypeOf<EngineRunner['run']>().parameters.toEqualTypeOf<
      [input: EngineInput, signal: AbortSignal, onProgress: ProgressCallback]
    >()
    expectTypeOf<EngineRunner['run']>().returns.toEqualTypeOf<Promise<Blob>>()
  })

  it('reports indeterminate progress as -1', () => {
    const onProgress: ProgressCallback = (p) => expect(p).toBe(-1)

    onProgress(-1)
    expectTypeOf<ProgressCallback>().toEqualTypeOf<(progress: number) => void>()
  })

  it('makes options optional and serialisable', () => {
    const bare: EngineInput = { task: { from: 'jpg', to: 'png', op: 'convert' }, files: [] }
    const opts: EngineOptions = { quality: 90, lossless: false, fit: 'cover' }

    expect(bare.options).toBeUndefined()
    expect(opts.fit).toBe('cover')
  })
})
