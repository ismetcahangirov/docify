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
import { BACKDROP, createCanvasRunner } from '@/lib/engines/canvas-runner'
import { DEFAULT_QUALITY } from '@/lib/engines/image-options'
import type { EngineInput } from '@/lib/engines/types'
import type { ConversionTask, FormatId } from '@/lib/router/types'

import { readMetadataSegments } from '@/lib/engines/jpeg-metadata'

import { pngBytes } from './synthetic-images'

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
  /** When set, `convertToBlob` answers with these exact bytes. */
  encoded: Blob | null = null

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
    if (this.encoded !== null) return this.encoded

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

  it('encodes at the shared default quality, and at whatever the job asked for', async () => {
    const { environment, canvas } = harness()
    const runner = createCanvasRunner(environment)
    const signal = new AbortController().signal

    await runner.run(inputFor('png', 'jpg'), signal, noProgress)
    await runner.run({ ...inputFor('png', 'jpg'), image: { quality: 40 } }, signal, noProgress)
    await runner.run({ ...inputFor('png', 'jpg'), image: { quality: 5000 } }, signal, noProgress)

    // The default is `image-options`' and not a number of this engine's own:
    // two engines handed the same job have to produce comparable output, and
    // Canvas and libvips are routinely alternatives for the same pair. The
    // browsers' own `toBlob` default of 0.92 is a different, higher number, and
    // using it here made a Canvas-routed JPEG visibly larger than a vips one.
    expect(canvas.convertCalls.map((call) => call.quality)).toEqual([DEFAULT_QUALITY / 100, 0.4, 1])
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

  describe('the metadata toggle', () => {
    const exifSegment = [
      0xff,
      0xe1,
      0x00,
      0x0c,
      ...[...'Exif'].map((c) => c.charCodeAt(0)),
      0,
      0,
      1,
      2,
      3,
      4,
    ]
    const scan = [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0, 0x9a, 0xbc, 0xff, 0xd9]

    /** A JPEG carrying GPS-shaped metadata, as a phone camera would write it. */
    const photo = () => new Blob([new Uint8Array([0xff, 0xd8, ...exifSegment, ...scan])])

    /** What a browser JPEG encoder produces: pixels, and nothing else. */
    const reEncoded = () =>
      new Blob([new Uint8Array([0xff, 0xd8, ...scan])], { type: 'image/jpeg' })

    function jpegHarness() {
      const built = harness()
      built.canvas.encoded = reEncoded()

      return built
    }

    const jpegJob = (image?: EngineInput['image']): EngineInput => ({
      task: { from: 'jpg', to: 'jpg', op: 'convert' },
      files: [photo()],
      image,
    })

    it('strips metadata by default, which is what a canvas does anyway', async () => {
      const { environment } = jpegHarness()

      const output = await createCanvasRunner(environment).run(
        jpegJob(),
        new AbortController().signal,
        noProgress,
      )

      // The privacy-safe direction, and the one that needs no code: a canvas
      // decodes to RGBA and re-encodes, so the GPS block never survives.
      expect(readMetadataSegments(new Uint8Array(await output.arrayBuffer()))).toEqual([])
    })

    it('carries it across when the job asks to keep it', async () => {
      const { environment } = jpegHarness()

      const output = await createCanvasRunner(environment).run(
        jpegJob({ keepMetadata: true }),
        new AbortController().signal,
        noProgress,
      )

      const carried = readMetadataSegments(new Uint8Array(await output.arrayBuffer()))
      expect(carried).toHaveLength(1)
      expect([...carried[0]]).toEqual(exifSegment)
    })

    it('leaves the output alone for a pair it cannot put metadata back into', async () => {
      const { environment, canvas } = harness()
      canvas.encoded = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

      const output = await createCanvasRunner(environment).run(
        { ...jpegJob({ keepMetadata: true }), task: { from: 'jpg', to: 'png', op: 'convert' } },
        new AbortController().signal,
        noProgress,
      )

      // A browser's PNG encoder has no hook for an Exif chunk. Producing a file
      // with a JPEG segment glued to the front of it would be far worse than
      // producing one without the metadata.
      expect(new Uint8Array(await output.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    })

    it('is a no-op for a source that carries nothing', async () => {
      const { environment } = jpegHarness()

      const output = await createCanvasRunner(environment).run(
        {
          ...jpegJob({ keepMetadata: true }),
          files: [new Blob([new Uint8Array([0xff, 0xd8, ...scan])])],
        },
        new AbortController().signal,
        noProgress,
      )

      expect(new Uint8Array(await output.arrayBuffer())).toEqual(
        new Uint8Array(await reEncoded().arrayBuffer()),
      )
    })
  })

  it('rasterises an SVG at the resolution the job asked for', async () => {
    const { environment, decoded } = harness()

    await createCanvasRunner(environment).run(
      {
        task: { from: 'svg', to: 'png', op: 'convert' },
        files: [new Blob(['<svg width="100" height="50" viewBox="0 0 100 50"/>'])],
        image: { width: 800 },
      },
      new AbortController().signal,
      noProgress,
    )

    // The decoder is handed a rewritten drawing, not the original: there is no
    // width argument on `createImageBitmap`, so the only way to ask for a
    // resolution is to put it in the file.
    const sent = await decoded[0].text()
    expect(sent).toContain('width="800"')
    expect(sent).toContain('height="400"')
    expect(decoded[0].type).toBe('image/svg+xml')
  })

  it('renders an SVG at its own declared size when the job names none', async () => {
    const { environment, decoded } = harness()

    await createCanvasRunner(environment).run(
      {
        task: { from: 'svg', to: 'jpg', op: 'convert' },
        files: [new Blob(['<svg width="72pt" height="36pt"/>'])],
      },
      new AbortController().signal,
      noProgress,
    )

    // 72pt is 96 pixels. Matching the browser's own sizing rules is what makes
    // the file look like the preview the user dragged in.
    const sent = await decoded[0].text()
    expect(sent).toContain('width="96"')
    expect(sent).toContain('height="48"')
  })

  it('enlarges a drawing without being asked, because scaling a vector invents nothing', async () => {
    const { environment, decoded } = harness()

    await createCanvasRunner(environment).run(
      {
        task: { from: 'svg', to: 'png', op: 'convert' },
        files: [new Blob(['<svg width="24" height="24"/>'])],
        image: { width: 1024 },
      },
      new AbortController().signal,
      noProgress,
    )

    // `enlarge` defaults to false for a photograph, where upscaling invents
    // detail. A 1024 px render of a 24 px icon is the commonest thing anyone
    // wants from an SVG converter.
    expect(await decoded[0].text()).toContain('width="1024"')
  })

  it('refuses a requested resolution no browser canvas could hold', async () => {
    const { environment, decoded } = harness()

    await expect(
      createCanvasRunner(environment).run(
        {
          task: { from: 'svg', to: 'png', op: 'convert' },
          files: [new Blob(['<svg width="24" height="24"/>'])],
          image: { width: 60_000, height: 60_000 },
        },
        new AbortController().signal,
        noProgress,
      ),
    ).rejects.toThrow(/larger than a browser canvas can hold/)

    // Refused before the decoder was handed anything: past the canvas limit the
    // surface comes back blank rather than throwing, so the user would otherwise
    // have downloaded an empty image called a success.
    expect(decoded).toEqual([])
  })

  it('says so plainly when a .svg turns out not to be a drawing', async () => {
    const { environment } = harness()

    await expect(
      createCanvasRunner(environment).run(
        {
          task: { from: 'svg', to: 'png', op: 'convert' },
          files: [new Blob(['<html><body>404 Not Found</body></html>'])],
        },
        new AbortController().signal,
        noProgress,
      ),
    ).rejects.toThrow(/not an SVG/)
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
    // Read from the constant rather than repeated: a literal here drifts the
    // moment the matte colour is spelled differently.
    expect(canvas.operations).toEqual([`fill ${BACKDROP} 0,0,2,2`, 'draw 0,0'])
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

  it('refuses a PNG that is too many pixels without decoding it at all', async () => {
    // The header says 20000 × 20000 and the pixels say ten by ten. Only a guard
    // that read the IHDR and stopped can quote the first number, which is what
    // "before any bitmap is allocated" has to mean.
    const { environment, decoded } = harness()
    const bytes = pngBytes(10, 10)
    const fields = new DataView(bytes.buffer)
    fields.setUint32(16, 20_000)
    fields.setUint32(20, 20_000)

    await expect(
      createCanvasRunner(environment).run(
        { task: { from: 'png', to: 'jpg', op: 'convert' }, files: [new File([bytes], 'wall.png')] },
        new AbortController().signal,
        noProgress,
      ),
    ).rejects.toThrow(
      /"wall\.png" is 20000 × 20000 pixels[\s\S]*larger than a browser canvas can hold/,
    )
    expect(decoded).toEqual([])
  })

  it('refuses an unsniffable format on the decoded size, before allocating a canvas', async () => {
    // A browser reads WebP, BMP, AVIF and — on Apple hardware — HEIC, and none
    // of those headers is parsed here. The decoded bitmap still names its own
    // size, and the canvas drawn from it is another `width × height × 4`.
    const created: [number, number][] = []
    const environment: CanvasEnvironment = {
      decode: async () => new FakeBitmap(20_000, 20_000) as unknown as ImageBitmap,
      createCanvas: (width, height) => {
        created.push([width, height])
        throw new Error('the runner should have stopped before creating a canvas')
      },
    }

    await expect(
      createCanvasRunner(environment).run(
        {
          task: { from: 'webp', to: 'png', op: 'convert' },
          files: [new File([new Uint8Array(16)], 'mural.webp')],
        },
        new AbortController().signal,
        noProgress,
      ),
    ).rejects.toThrow(/"mural\.webp" is 20000 × 20000 pixels/)
    expect(created).toEqual([])
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
