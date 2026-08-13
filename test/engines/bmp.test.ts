// @vitest-environment node
//
// The BMP writer is pure byte arithmetic: no canvas, no DOM, no browser. Running
// it under `node` keeps that honest — a stray `document` read would throw here.

import { describe, expect, it } from 'vitest'

import { encodeBmp, type RgbaImage } from '@/lib/engines/bmp'

const FILE_HEADER_BYTES = 14
const INFO_HEADER_BYTES = 40
const V4_HEADER_BYTES = 108

/** Builds an image from `[r, g, b, a]` tuples given in top-to-bottom row order. */
function image(width: number, height: number, pixels: readonly number[][]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  pixels.forEach((pixel, index) => data.set(pixel, index * 4))
  return { width, height, data }
}

/** The fields the tests assert on, read back out of the encoded bytes. */
function header(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  return {
    magic: String.fromCharCode(bytes[0], bytes[1]),
    fileSize: view.getUint32(2, true),
    pixelOffset: view.getUint32(10, true),
    headerSize: view.getUint32(14, true),
    width: view.getInt32(18, true),
    height: view.getInt32(22, true),
    planes: view.getUint16(26, true),
    bitCount: view.getUint16(28, true),
    compression: view.getUint32(30, true),
    imageSize: view.getUint32(34, true),
  }
}

/** The masks a `BITMAPV4HEADER` carries, which a 40-byte header does not have. */
function masks(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  return {
    red: view.getUint32(54, true),
    green: view.getUint32(58, true),
    blue: view.getUint32(62, true),
    alpha: view.getUint32(66, true),
    colourSpace: view.getUint32(70, true),
  }
}

/** The pixel rows, top row first — undoing the bottom-up order BMP stores. */
function rows(bytes: Uint8Array): number[][] {
  const { width, height, bitCount, pixelOffset } = header(bytes)
  const bytesPerPixel = bitCount / 8
  const stride = Math.ceil((width * bytesPerPixel) / 4) * 4
  const result: number[][] = []

  for (let y = height - 1; y >= 0; y -= 1) {
    const start = pixelOffset + y * stride
    result.push([...bytes.slice(start, start + width * bytesPerPixel)])
  }

  return result
}

const RED: number[] = [255, 0, 0, 255]
const GREEN: number[] = [0, 255, 0, 255]
const BLUE: number[] = [0, 0, 255, 255]
const WHITE: number[] = [255, 255, 255, 255]
const TRANSLUCENT: number[] = [10, 20, 30, 128]

describe('encodeBmp — the file header', () => {
  it('starts with the BM signature', () => {
    expect(header(encodeBmp(image(1, 1, [RED]))).magic).toBe('BM')
  })

  it('reports its own length as the file size', () => {
    const bytes = encodeBmp(image(3, 2, [RED, GREEN, BLUE, WHITE, RED, GREEN]))

    expect(header(bytes).fileSize).toBe(bytes.byteLength)
  })

  it('points past the headers to the first pixel byte', () => {
    const opaque = encodeBmp(image(1, 1, [RED]))
    const translucent = encodeBmp(image(1, 1, [TRANSLUCENT]))

    expect(header(opaque).pixelOffset).toBe(FILE_HEADER_BYTES + INFO_HEADER_BYTES)
    expect(header(translucent).pixelOffset).toBe(FILE_HEADER_BYTES + V4_HEADER_BYTES)
  })
})

describe('encodeBmp — an opaque image', () => {
  it('writes 24-bit BI_RGB with the classic 40-byte header', () => {
    const fields = header(encodeBmp(image(2, 2, [RED, GREEN, BLUE, WHITE])))

    expect(fields.headerSize).toBe(INFO_HEADER_BYTES)
    expect(fields.bitCount).toBe(24)
    // BI_RGB — no compression and no bitfield masks, the most widely readable
    // BMP any decoder accepts.
    expect(fields.compression).toBe(0)
    expect(fields.planes).toBe(1)
  })

  it('records the image dimensions, height positive for bottom-up rows', () => {
    const fields = header(encodeBmp(image(3, 2, [RED, GREEN, BLUE, WHITE, RED, GREEN])))

    expect(fields.width).toBe(3)
    expect(fields.height).toBe(2)
  })

  it('stores pixels as BGR, bottom row first', () => {
    // Two rows: red/green on top, blue/white underneath.
    const bytes = encodeBmp(image(2, 2, [RED, GREEN, BLUE, WHITE]))

    expect(rows(bytes)).toEqual([
      [0, 0, 255, 0, 255, 0],
      [255, 0, 0, 255, 255, 255],
    ])
  })

  it('pads every row to a four-byte boundary', () => {
    // 1 pixel × 3 bytes = 3, padded to 4. Two rows, so 8 bytes of pixel data.
    const bytes = encodeBmp(image(1, 2, [RED, BLUE]))
    const fields = header(bytes)

    expect(fields.imageSize).toBe(8)
    expect(bytes.byteLength).toBe(FILE_HEADER_BYTES + INFO_HEADER_BYTES + 8)
    // The pad byte is zero, not whatever was left in the buffer.
    expect(bytes[fields.pixelOffset + 3]).toBe(0)
  })
})

describe('encodeBmp — an image with transparency', () => {
  it('switches to 32-bit BI_BITFIELDS with a BITMAPV4HEADER', () => {
    const fields = header(encodeBmp(image(2, 1, [RED, TRANSLUCENT])))

    expect(fields.headerSize).toBe(V4_HEADER_BYTES)
    expect(fields.bitCount).toBe(32)
    // BI_BITFIELDS — the only way a BMP can declare an alpha channel.
    expect(fields.compression).toBe(3)
  })

  it('declares the channel masks so a decoder can find the alpha byte', () => {
    const found = masks(encodeBmp(image(1, 1, [TRANSLUCENT])))

    expect(found.red).toBe(0x00ff0000)
    expect(found.green).toBe(0x0000ff00)
    expect(found.blue).toBe(0x000000ff)
    expect(found.alpha).toBe(0xff000000)
    // LCS_sRGB, so a decoder does not have to guess the colour space.
    expect(found.colourSpace).toBe(0x73524742)
  })

  it('stores pixels as BGRA, bottom row first, with no padding needed', () => {
    const bytes = encodeBmp(image(1, 2, [TRANSLUCENT, RED]))

    expect(rows(bytes)).toEqual([
      [30, 20, 10, 128],
      [0, 0, 255, 255],
    ])
    expect(header(bytes).imageSize).toBe(8)
  })

  it('keeps the alpha channel rather than compositing it away', () => {
    const bytes = encodeBmp(image(1, 1, [[0, 0, 0, 0]]))

    expect(rows(bytes)).toEqual([[0, 0, 0, 0]])
  })
})

describe('encodeBmp — refusals', () => {
  it('refuses a zero or fractional size rather than emitting a corrupt file', () => {
    expect(() => encodeBmp(image(0, 1, []))).toThrow(RangeError)
    expect(() => encodeBmp(image(1, 0, []))).toThrow(RangeError)
    expect(() => encodeBmp({ width: 1.5, height: 1, data: new Uint8ClampedArray(8) })).toThrow(
      RangeError,
    )
  })

  it('refuses a buffer too short for the dimensions it claims', () => {
    expect(() => encodeBmp({ width: 4, height: 4, data: new Uint8ClampedArray(8) })).toThrow(
      RangeError,
    )
  })
})
