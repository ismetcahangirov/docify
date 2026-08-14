// @vitest-environment node
//
// The HEIC engine as the router and the worker see it: a descriptor that
// decides without touching a file, and a runner whose two halves — libheif
// decode, canvas encode — are both injected.
//
// Injecting them is what makes this suite headless. The real runner reaches a
// 1.4 MB WASM bundle through `await import()` and `OffscreenCanvas` through the
// worker's global scope; neither exists here, and neither needs to, because
// what this file asserts is the glue: order, cancellation, progress, and the
// hand-off at the decode/encode seam.

import { describe, expect, it, vi } from 'vitest'

import type { BitmapEncoder, RgbaBitmap } from '@/lib/engines/bitmap'
import type { HeifDecoder, HeifImage, HeifModule } from '@/lib/engines/heif-decode'
import { createRunner, DECODE_SHARE, descriptor } from '@/lib/engines/heif'
import type { EngineInput } from '@/lib/engines/types'
import { LARGE_DOWNLOAD_BYTES } from '@/lib/router/route'
import type { Capabilities, ConversionTask, FormatId } from '@/lib/router/types'

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

const convert = (from: FormatId, to: FormatId): ConversionTask => ({ from, to, op: 'convert' })

function fakeModule(width = 3, height = 2): HeifModule {
  const image: HeifImage = {
    get_width: () => width,
    get_height: () => height,
    is_primary: () => true,
    display(target, done) {
      target.data.fill(42)
      done(target)
    },
    free() {},
  }

  return {
    HeifDecoder: class implements HeifDecoder {
      decode(): HeifImage[] {
        return [image]
      }
    },
  }
}

/** Records what the seam was handed, and answers with a recognisable blob. */
function recordingEncoder(): BitmapEncoder & {
  calls: { bitmap: RgbaBitmap; format: FormatId }[]
} {
  const calls: { bitmap: RgbaBitmap; format: FormatId }[] = []
  const encode = (bitmap: RgbaBitmap, format: FormatId): Promise<Blob> => {
    calls.push({ bitmap, format })
    return Promise.resolve(new Blob(['encoded'], { type: `image/${format}` }))
  }

  return Object.assign(encode, { calls })
}

const input = (task: ConversionTask, files: Blob[] = [new Blob([new Uint8Array([1, 2, 3])])]) =>
  ({ task, files }) satisfies EngineInput

describe('descriptor', () => {
  it('is registered under the id the router and the budget table already know', () => {
    expect(descriptor.id).toBe('heif')
  })

  it('sits at priority 35, between zip and vips', () => {
    expect(descriptor.priority).toBe(35)
  })

  it('declares a download small enough not to warn the user about it', () => {
    expect(descriptor.loadCost).toBeGreaterThan(1_000_000)
    expect(descriptor.loadCost).toBeLessThan(LARGE_DOWNLOAD_BYTES)
  })

  it('names itself in terms a user can read', () => {
    expect(descriptor.label).toMatch(/heic/i)
  })
})

describe('descriptor.supports', () => {
  it('takes the two conversions the issue asks for', () => {
    expect(descriptor.supports(convert('heic', 'jpg'), desktop)).toBe(true)
    expect(descriptor.supports(convert('heic', 'png'), desktop)).toBe(true)
  })

  it('claims no output format it has no encoder for', () => {
    for (const to of ['webp', 'avif', 'tiff', 'gif', 'pdf'] as FormatId[]) {
      expect(descriptor.supports(convert('heic', to), desktop)).toBe(false)
    }
  })

  it('claims no input other than HEIC — libheif decodes, it does not encode', () => {
    expect(descriptor.supports(convert('jpg', 'png'), desktop)).toBe(false)
    expect(descriptor.supports(convert('png', 'jpg'), desktop)).toBe(false)
    expect(descriptor.supports(convert('jpg', 'heic'), desktop)).toBe(false)
  })

  it('claims only the convert operation', () => {
    expect(descriptor.supports({ from: 'heic', to: 'jpg', op: 'resize' }, desktop)).toBe(false)
    expect(descriptor.supports({ from: 'heic', to: 'jpg', op: 'compress' }, desktop)).toBe(false)
  })

  it('stands down without OffscreenCanvas, which is how it writes its output', () => {
    expect(
      descriptor.supports(convert('heic', 'jpg'), { ...desktop, offscreenCanvas: false }),
    ).toBe(false)
  })

  it('does not need SIMD: the shipped libheif build is a baseline wasm32 module', () => {
    expect(descriptor.supports(convert('heic', 'jpg'), { ...desktop, wasmSimd: false })).toBe(true)
  })

  it('reads nothing but the task and the capabilities it is handed', () => {
    const task = convert('heic', 'jpg')
    const caps = { ...desktop }

    descriptor.supports(task, caps)

    expect(task).toEqual(convert('heic', 'jpg'))
    expect(caps).toEqual(desktop)
  })
})

describe('createRunner', () => {
  it('loads libheif once, when the runner is built rather than per job', async () => {
    // The worker checks the abort signal immediately after building the runner,
    // so loading here is what makes "cancelled while the engine downloads" a
    // case the worker can catch.
    const load = vi.fn(async () => fakeModule())
    const runner = await createRunner({ load, encode: recordingEncoder() })

    await runner.run(input(convert('heic', 'jpg')), new AbortController().signal, () => {})
    await runner.run(input(convert('heic', 'png')), new AbortController().signal, () => {})

    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('run', () => {
  it('hands the decoded bitmap to the encoder, in the format the task asks for', async () => {
    const encode = recordingEncoder()
    const runner = await createRunner({ load: async () => fakeModule(3, 2), encode })

    const blob = await runner.run(
      input(convert('heic', 'png')),
      new AbortController().signal,
      () => {},
    )

    expect(encode.calls).toHaveLength(1)
    expect(encode.calls[0].format).toBe('png')
    expect(encode.calls[0].bitmap.width).toBe(3)
    expect(encode.calls[0].bitmap.height).toBe(2)
    expect(encode.calls[0].bitmap.data).toHaveLength(3 * 2 * 4)
    expect(blob.type).toBe('image/png')
  })

  it('returns whatever the encoder produced, unwrapped', async () => {
    const expected = new Blob(['jpeg bytes'], { type: 'image/jpeg' })
    const runner = await createRunner({
      load: async () => fakeModule(),
      encode: async () => expected,
    })

    expect(
      await runner.run(input(convert('heic', 'jpg')), new AbortController().signal, () => {}),
    ).toBe(expected)
  })

  it('reports decode and encode as two determinate steps, ending at 1', async () => {
    const ticks: number[] = []
    const runner = await createRunner({
      load: async () => fakeModule(),
      encode: recordingEncoder(),
    })

    await runner.run(input(convert('heic', 'jpg')), new AbortController().signal, (progress) =>
      ticks.push(progress),
    )

    expect(ticks).toEqual([DECODE_SHARE, 1])
    expect(DECODE_SHARE).toBeGreaterThan(0)
    expect(DECODE_SHARE).toBeLessThan(1)
  })

  it('refuses a signal that is already aborted, without reading the file', async () => {
    const encode = recordingEncoder()
    const runner = await createRunner({ load: async () => fakeModule(), encode })
    const controller = new AbortController()
    controller.abort()

    await expect(
      runner.run(input(convert('heic', 'jpg')), controller.signal, () => {}),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(encode.calls).toEqual([])
  })

  it('does not encode a file the user cancelled while it was decoding', async () => {
    const controller = new AbortController()
    const encode = recordingEncoder()
    const load = async (): Promise<HeifModule> => {
      const libheif = fakeModule()
      return {
        HeifDecoder: class implements HeifDecoder {
          decode(data: Uint8Array): HeifImage[] {
            controller.abort()
            return new libheif.HeifDecoder().decode(data)
          }
        },
      }
    }
    const runner = await createRunner({ load, encode })

    await expect(
      runner.run(input(convert('heic', 'jpg')), controller.signal, () => {}),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(encode.calls).toEqual([])
  })

  it('refuses a job with no file', async () => {
    const runner = await createRunner({
      load: async () => fakeModule(),
      encode: recordingEncoder(),
    })

    await expect(
      runner.run(input(convert('heic', 'jpg'), []), new AbortController().signal, () => {}),
    ).rejects.toThrow(/exactly one file/i)
  })

  it('quotes the file name when the pixel ceiling refuses the image', async () => {
    // The name is what makes the rejection actionable: "unsupported image" would
    // leave someone re-checking a camera roll to find which photo it meant.
    const runner = await createRunner({
      load: async () => fakeModule(20_000, 20_000),
      encode: recordingEncoder(),
    })
    const files = [new File([new Uint8Array([1, 2, 3])], 'sunset.heic')]

    await expect(
      runner.run(input(convert('heic', 'jpg'), files), new AbortController().signal, () => {}),
    ).rejects.toThrow(/"sunset\.heic" is 20000 × 20000 pixels/)
  })

  it('refuses a job with several files rather than silently dropping the rest', async () => {
    const runner = await createRunner({
      load: async () => fakeModule(),
      encode: recordingEncoder(),
    })
    const files = [new Blob(['a']), new Blob(['b'])]

    await expect(
      runner.run(input(convert('heic', 'jpg'), files), new AbortController().signal, () => {}),
    ).rejects.toThrow(/exactly one file/i)
  })
})
