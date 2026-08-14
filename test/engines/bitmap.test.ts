/**
 * The encode seam: raw RGBA in, an encoded image `Blob` out.
 *
 * `OffscreenCanvas` does not exist in jsdom, so the canvas is stubbed here. That
 * is not a compromise — the interesting behaviour is *which* calls the encoder
 * makes (the MIME type it asks for, the matte it paints behind a lossy target),
 * and a stub is the only way to assert those. That real browsers implement
 * `convertToBlob` is not this suite's claim to make.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { encodeBitmap, JPEG_QUALITY, MATTE_COLOUR, type RgbaBitmap } from '@/lib/engines/bitmap'

interface ConvertOptions {
  type?: string
  quality?: number
}

/** Every mutation the encoder performs, in order, so ordering can be asserted. */
let calls: string[] = []
let convertOptions: ConvertOptions | undefined
let imageDataArgs: [Uint8ClampedArray, number, number] | undefined
let canvasSize: [number, number] | undefined
let contextFor: string | null = '2d'

class FakeContext {
  globalCompositeOperation = 'source-over'
  fillStyle = ''

  putImageData(): void {
    calls.push('putImageData')
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    calls.push(
      `fillRect:${this.globalCompositeOperation}:${this.fillStyle}:${x},${y},${width},${height}`,
    )
  }
}

class FakeOffscreenCanvas {
  private readonly context = new FakeContext()

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    canvasSize = [width, height]
  }

  getContext(id: string): FakeContext | null {
    return id === contextFor ? this.context : null
  }

  convertToBlob(options: ConvertOptions): Promise<Blob> {
    convertOptions = options
    calls.push(`convertToBlob:${options.type}`)
    return Promise.resolve(new Blob(['encoded'], { type: options.type }))
  }
}

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {
    imageDataArgs = [data, width, height]
  }
}

const bitmap = (width = 2, height = 2): RgbaBitmap => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4).fill(120),
})

beforeEach(() => {
  calls = []
  convertOptions = undefined
  imageDataArgs = undefined
  canvasSize = undefined
  contextFor = '2d'
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  vi.stubGlobal('ImageData', FakeImageData)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('encodeBitmap', () => {
  it('asks the canvas for the JPEG MIME type, with an explicit quality', async () => {
    const blob = await encodeBitmap(bitmap(), 'jpg')

    expect(convertOptions).toEqual({ type: 'image/jpeg', quality: JPEG_QUALITY })
    expect(blob.type).toBe('image/jpeg')
  })

  it('asks for PNG without a quality, which the format has no use for', async () => {
    const blob = await encodeBitmap(bitmap(), 'png')

    expect(convertOptions).toEqual({ type: 'image/png' })
    expect(blob.type).toBe('image/png')
  })

  it('sizes the canvas to the bitmap and hands the pixels over untouched', async () => {
    const source = bitmap(7, 3)

    await encodeBitmap(source, 'png')

    expect(canvasSize).toEqual([7, 3])
    expect(imageDataArgs?.[0]).toBe(source.data)
    expect(imageDataArgs?.slice(1)).toEqual([7, 3])
  })

  it('paints a white matte behind the pixels for JPEG, which has no alpha channel', async () => {
    // Without this, a HEIC with transparency arrives as a photo on a black
    // background — JPEG cannot store alpha, so the canvas composites onto
    // whatever is underneath, and an untouched canvas is transparent black.
    await encodeBitmap(bitmap(4, 5), 'jpg')

    expect(calls).toEqual([
      'putImageData',
      `fillRect:destination-over:${MATTE_COLOUR}:0,0,4,5`,
      'convertToBlob:image/jpeg',
    ])
  })

  it('leaves PNG alone, because PNG keeps the alpha channel', async () => {
    await encodeBitmap(bitmap(), 'png')

    expect(calls).toEqual(['putImageData', 'convertToBlob:image/png'])
  })

  it('refuses a format it cannot write, and names it', async () => {
    await expect(encodeBitmap(bitmap(), 'avif')).rejects.toThrow(/avif/i)
  })

  it('reports a missing 2D context rather than throwing on null', async () => {
    contextFor = null

    await expect(encodeBitmap(bitmap(), 'png')).rejects.toThrow(/2d/i)
  })
})
