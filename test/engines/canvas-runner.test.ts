// @vitest-environment node
//
// The runner is the half that only ever executes inside a Web Worker, where
// `OffscreenCanvas` and `createImageBitmap` exist. Neither exists in jsdom, and
// a headless test that needed them would be a browser test wearing a disguise —
// so the two APIs arrive as an injected environment and the suite drives fakes.
// What is being tested is the *choreography*: decode, draw, encode, the order
// they happen in, what gets closed, and what happens when the user cancels.

import { describe, expect, it, vi } from 'vitest'

import type { CanvasEnvironment } from '@/lib/engines/canvas-runner'
import { createCanvasRunner } from '@/lib/engines/canvas-runner'
import type { EngineInput } from '@/lib/engines/types'
import type { ConversionTask, FormatId } from '@/lib/router/types'

class FakeBitmap {
  closeCount = 0

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  close(): void {
    this.closeCount += 1
  }
}

/** Records what the runner drew, in the order it drew it. */
class FakeContext {
  readonly operations: string[] = []
  fillStyle = '#000000'

  constructor(private readonly source: Uint8ClampedArray) {}

  fillRect(x: number, y: number, width: number, height: number): void {
    this.operations.push(`fill ${this.fillStyle} ${x},${y},${width},${height}`)
  }

  drawImage(_image: unknown, x: number, y: number): void {
    this.operations.push(`draw ${x},${y}`)
  }

  getImageData(_x: number, _y: number, width: number, height: number) {
    this.operations.push(`read ${width}x${height}`)
    return { width, height, data: this.source, colorSpace: 'srgb' as const }
  }
}

class FakeCanvas {
  readonly convertCalls: { type?: string; quality?: number }[] = []
  /** When set, `convertToBlob` answers with this type instead of the requested one. */
  producedType: string | null = null

  private readonly context: FakeContext

  constructor(
    readonly width: number,
    readonly height: number,
    pixels: Uint8ClampedArray,
  ) {
    this.context = new FakeContext(pixels)
  }

  get operations(): string[] {
    return this.context.operations
  }

  getContext(id: string): FakeContext | null {
    return id === '2d' ? this.context : null
  }

  async convertToBlob(options: { type?: string; quality?: number } = {}): Promise<Blob> {
    this.convertCalls.push(options)
    return new Blob(['encoded'], { type: this.producedType ?? options.type })
  }
}

interface Harness {
  bitmap: FakeBitmap
  canvas: FakeCanvas
  decoded: Blob[]
  created: [number, number][]
  environment: CanvasEnvironment
}

/** An opaque 2×2 image, which is what the fake context hands back for BMP. */
function opaquePixels(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).fill(255)
}

function harness(options: { width?: number; height?: number } = {}): Harness {
  const width = options.width ?? 2
  const height = options.height ?? 2
  const bitmap = new FakeBitmap(width, height)
  const canvas = new FakeCanvas(width, height, opaquePixels(width, height))
  const decoded: Blob[] = []
  const created: [number, number][] = []

  const environment = {
    decode: async (source: Blob) => {
      decoded.push(source)
      return bitmap as unknown as ImageBitmap
    },
    createCanvas: (canvasWidth: number, canvasHeight: number) => {
      created.push([canvasWidth, canvasHeight])
      return canvas as unknown as OffscreenCanvas
    },
  } satisfies CanvasEnvironment

  return { bitmap, canvas, decoded, created, environment }
}

function inputFor(from: FormatId, to: FormatId): EngineInput {
  const task: ConversionTask = { from, to, op: 'convert' }
  return { task, files: [new Blob(['source'], { type: `image/${from}` })] }
}

const noProgress = () => {}

describe('the canvas runner — a straightforward conversion', () => {
  it('decodes the file, draws it and encodes it as the requested type', async () => {
    const { environment, canvas, decoded, created } = harness()

    const output = await createCanvasRunner(environment).run(
      inputFor('jpg', 'png'),
      new AbortController().signal,
      noProgress,
    )

    expect(decoded).toHaveLength(1)
    expect(created).toEqual([[2, 2]])
    expect(canvas.convertCalls[0]?.type).toBe('image/png')
    expect(output.type).toBe('image/png')
  })

  it('maps every supported target onto its MIME type', async () => {
    const types = new Map<FormatId, string>([
      ['jpg', 'image/jpeg'],
      ['png', 'image/png'],
      ['webp', 'image/webp'],
    ])

    for (const [format, type] of types) {
      const { environment, canvas } = harness()

      await createCanvasRunner(environment).run(
        inputFor('png', format),
        new AbortController().signal,
        noProgress,
      )

      expect(canvas.convertCalls[0]?.type).toBe(type)
    }
  })

  it('sizes the canvas from the decoded bitmap, not from the task', async () => {
    const { environment, created } = harness({ width: 640, height: 480 })

    await createCanvasRunner(environment).run(
      inputFor('webp', 'png'),
      new AbortController().signal,
      noProgress,
    )

    expect(created).toEqual([[640, 480]])
  })

  it('closes the bitmap exactly once, so a session of conversions cannot leak', async () => {
    const { environment, bitmap } = harness()

    await createCanvasRunner(environment).run(
      inputFor('png', 'webp'),
      new AbortController().signal,
      noProgress,
    )

    expect(bitmap.closeCount).toBe(1)
  })

  it('paints white under a target that has no alpha channel', async () => {
    const { environment, canvas } = harness()

    await createCanvasRunner(environment).run(
      inputFor('png', 'jpg'),
      new AbortController().signal,
      noProgress,
    )

    // The fill has to happen *before* the draw, or it erases the image.
    expect(canvas.operations).toEqual(['fill #ffffff 0,0,2,2', 'draw 0,0'])
  })

  it('leaves the canvas transparent for a target that keeps alpha', async () => {
    const { environment, canvas } = harness()

    await createCanvasRunner(environment).run(
      inputFor('jpg', 'png'),
      new AbortController().signal,
      noProgress,
    )

    expect(canvas.operations).toEqual(['draw 0,0'])
  })
})

describe('the canvas runner — BMP output', () => {
  it('encodes BMP itself, because convertToBlob cannot write it', async () => {
    const { environment, canvas } = harness()

    const output = await createCanvasRunner(environment).run(
      inputFor('png', 'bmp'),
      new AbortController().signal,
      noProgress,
    )

    expect(canvas.convertCalls).toEqual([])
    expect(canvas.operations).toContain('read 2x2')
    expect(output.type).toBe('image/bmp')
  })

  it('produces bytes a BMP decoder recognises', async () => {
    const { environment } = harness()

    const output = await createCanvasRunner(environment).run(
      inputFor('png', 'bmp'),
      new AbortController().signal,
      noProgress,
    )
    const bytes = new Uint8Array(await output.arrayBuffer())

    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('BM')
    expect(new DataView(bytes.buffer).getUint32(2, true)).toBe(bytes.byteLength)
  })

  it('keeps alpha out of the way by drawing straight onto the transparent canvas', async () => {
    const { environment, canvas } = harness()

    await createCanvasRunner(environment).run(
      inputFor('png', 'bmp'),
      new AbortController().signal,
      noProgress,
    )

    expect(canvas.operations.filter((step) => step.startsWith('fill'))).toEqual([])
  })
})

describe('the canvas runner — progress', () => {
  it('reports a monotonic 0..1 and finishes at 1', async () => {
    const { environment } = harness()
    const ticks: number[] = []

    await createCanvasRunner(environment).run(
      inputFor('jpg', 'png'),
      new AbortController().signal,
      (progress) => ticks.push(progress),
    )

    expect(ticks[0]).toBe(0)
    expect(ticks.at(-1)).toBe(1)
    expect(ticks.length).toBeGreaterThan(2)
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks)
    for (const tick of ticks) expect(tick).toBeGreaterThanOrEqual(0)
    for (const tick of ticks) expect(tick).toBeLessThanOrEqual(1)
  })
})

describe('the canvas runner — cancellation', () => {
  it('does not even decode when the signal is already aborted', async () => {
    const { environment, decoded } = harness()
    const controller = new AbortController()
    controller.abort()

    await expect(
      createCanvasRunner(environment).run(inputFor('jpg', 'png'), controller.signal, noProgress),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(decoded).toEqual([])
  })

  it('stops after the decode and still closes the bitmap', async () => {
    const controller = new AbortController()
    const bitmap = new FakeBitmap(2, 2)
    const environment: CanvasEnvironment = {
      decode: async () => {
        controller.abort()
        return bitmap as unknown as ImageBitmap
      },
      createCanvas: () => {
        throw new Error('the runner should have stopped before creating a canvas')
      },
    }

    await expect(
      createCanvasRunner(environment).run(inputFor('jpg', 'png'), controller.signal, noProgress),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(bitmap.closeCount).toBe(1)
  })

  it('reports no further progress once it has been aborted', async () => {
    const controller = new AbortController()
    const ticks: number[] = []
    const { environment } = harness()
    controller.abort()

    await createCanvasRunner(environment)
      .run(inputFor('jpg', 'png'), controller.signal, (progress) => ticks.push(progress))
      .catch(() => {})

    expect(ticks).toEqual([])
  })
})

describe('the canvas runner — refusals', () => {
  it('names the format when asked for one it cannot write', async () => {
    const { environment } = harness()

    await expect(
      createCanvasRunner(environment).run(
        // A pair the router would never send here — `avif` is a real FormatId,
        // just not one a browser canvas can write. The runner guards it anyway.
        { task: { from: 'jpg', to: 'avif', op: 'convert' }, files: [new Blob(['x'])] },
        new AbortController().signal,
        noProgress,
      ),
    ).rejects.toThrow(/avif/i)
  })

  it('refuses a job with no file rather than encoding an empty canvas', async () => {
    const { environment } = harness()

    await expect(
      createCanvasRunner(environment).run(
        { task: { from: 'jpg', to: 'png', op: 'convert' }, files: [] },
        new AbortController().signal,
        noProgress,
      ),
    ).rejects.toThrow(/one file/i)
  })

  it('catches a browser that silently substitutes PNG for an unsupported type', async () => {
    // Safari used to answer `convertToBlob({ type: 'image/webp' })` with a PNG.
    // Handing that back as a `.webp` download is worse than failing.
    const { environment, canvas } = harness()
    canvas.producedType = 'image/png'

    await expect(
      createCanvasRunner(environment).run(
        inputFor('jpg', 'webp'),
        new AbortController().signal,
        noProgress,
      ),
    ).rejects.toThrow(/image\/webp/)
  })

  it('reports a canvas that will not give up a 2d context', async () => {
    const { environment, canvas } = harness()
    vi.spyOn(canvas, 'getContext').mockReturnValue(null)

    await expect(
      createCanvasRunner(environment).run(
        inputFor('jpg', 'png'),
        new AbortController().signal,
        noProgress,
      ),
    ).rejects.toThrow(/2d/i)
    vi.restoreAllMocks()
  })
})
