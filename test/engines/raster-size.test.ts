// @vitest-environment node
//
// The header readers, on bytes nobody validated. Every one of these is parsing
// a file a stranger produced, so the cases that matter are the malformed ones:
// a size read too small silently disables the ceiling that depends on it, and a
// size read too large refuses a good file with invented dimensions.

import { describe, expect, it } from 'vitest'

import { jpegSize, pngSize, rasterSize, webpSize } from '@/lib/engines/raster-size'

import { jpegBytes, pngBytes } from './synthetic-images'

/** SOI, the segments given, then EOI. */
function jpegStream(...segments: readonly (readonly number[])[]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat(), 0xff, 0xd9])
}

/** A well-formed SOF segment of the given marker code, 1 × 1 pixels. */
function frame(code: number, width = 1, height = 1): number[] {
  return [
    0xff,
    code,
    0x00,
    0x11, // length: 17
    0x08, // sample precision
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03, // three components
    ...[1, 2, 3].flatMap((id) => [id, 0x11, 0x00]),
  ]
}

describe('pngSize', () => {
  it('reads width and height from the IHDR', () => {
    expect(pngSize(pngBytes(1500, 2000))).toEqual({ width: 1500, height: 2000 })
  })

  it('reads through a subarray that does not start at byte zero', () => {
    // Every caller today hands over a fresh `Uint8Array`, but a `DataView` built
    // on `bytes.buffer` without the offset would read the wrong four bytes the
    // day one does not.
    const padded = new Uint8Array(64 + pngBytes(300, 400).length)
    padded.set(pngBytes(300, 400), 64)

    expect(pngSize(padded.subarray(64))).toEqual({ width: 300, height: 400 })
  })

  it('refuses a file that is not a PNG', () => {
    expect(pngSize(Uint8Array.of(0x49, 0x49, 0x2a, 0x00))).toBeNull()
  })

  it('refuses a PNG truncated before its IHDR', () => {
    expect(pngSize(pngBytes(10, 10).subarray(0, 20))).toBeNull()
  })

  it('refuses a first chunk that is not an IHDR', () => {
    const broken = pngBytes(10, 10)
    broken[13] = 0x00 // the 'H' of "IHDR"

    expect(pngSize(broken)).toBeNull()
  })

  it('refuses an IHDR whose declared length is not the specified 13', () => {
    const broken = pngBytes(10, 10)
    new DataView(broken.buffer).setUint32(8, 9)

    expect(pngSize(broken)).toBeNull()
  })

  it('refuses a zero dimension', () => {
    const broken = pngBytes(10, 10)
    new DataView(broken.buffer).setUint32(16, 0)

    expect(pngSize(broken)).toBeNull()
  })
})

describe('jpegSize', () => {
  it('reads width and height from a baseline SOF0', () => {
    expect(jpegSize(jpegBytes(4000, 3000))).toEqual({ width: 4000, height: 3000 })
  })

  it('walks past the APP and DHT segments a real camera file opens with', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]
    const dht = [0xff, 0xc4, 0x00, 0x05, 0x00, 0x01, 0x02]

    expect(jpegSize(jpegStream(app0, dht, frame(0xc0, 640, 480)))).toEqual({
      width: 640,
      height: 480,
    })
  })

  it('accepts every start-of-frame marker, not only the baseline one', () => {
    // 0xC1 extended sequential, 0xC2 progressive, 0xC3 lossless, and the
    // arithmetic-coded 0xC9..0xCB and 0xCD..0xCF. A progressive JPEG is what
    // half the web serves, and reading it as "no frame here" would silently
    // switch the ceiling off for those files.
    const codes = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]

    for (const code of codes) {
      expect(jpegSize(jpegStream(frame(code, 32, 16)))).toEqual({ width: 32, height: 16 })
    }
  })

  it('does not mistake DHT, DAC or JPG for a frame header', () => {
    // All three share the 0xC0..0xCF range and none of them is a frame. Reading
    // one as a frame yields a size taken from a Huffman table.
    for (const code of [0xc4, 0xc8, 0xcc]) {
      const notAFrame = [0xff, code, 0x00, 0x0b, ...new Array<number>(9).fill(0x11)]

      expect(jpegSize(jpegStream(notAFrame, frame(0xc0, 77, 88)))).toEqual({
        width: 77,
        height: 88,
      })
    }
  })

  it('steps over the fill bytes a marker may be padded with', () => {
    expect(jpegSize(jpegStream([0xff, 0xff, 0xff], frame(0xc0, 12, 34)))).toEqual({
      width: 12,
      height: 34,
    })
  })

  it('steps over standalone markers, which carry no length', () => {
    expect(jpegSize(jpegStream([0xff, 0x01], [0xff, 0xd3], frame(0xc0, 9, 9)))).toEqual({
      width: 9,
      height: 9,
    })
  })

  it('refuses a frame segment too short to hold the fields it claims', () => {
    // `FF C0 00 02` declares a two-byte segment, which is the length field and
    // nothing else. Reading the size anyway takes four bytes belonging to
    // whatever follows and reports them as the image dimensions.
    const stunted = [0xff, 0xc0, 0x00, 0x02]

    expect(jpegSize(jpegStream(stunted, frame(0xc0, 50, 50)))).toBeNull()
  })

  it('steps over a second SOI rather than reading its neighbours as a length', () => {
    // 0xD8 is standalone. Treating it as length-bearing lets the next two bytes
    // steer the walk anywhere in the file.
    expect(jpegSize(jpegStream([0xff, 0xd8], frame(0xc0, 50, 50)))).toEqual({
      width: 50,
      height: 50,
    })
  })

  it('refuses a stuffed 0xFF00, which is data and not a marker', () => {
    expect(jpegSize(jpegStream([0xff, 0x00], frame(0xc0, 50, 50)))).toBeNull()
  })

  it('stops at the start of scan rather than parsing entropy-coded bytes', () => {
    // Past SOS a 0xFF no longer introduces a marker, so anything found after it
    // is a coincidence rather than a frame header.
    const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]

    expect(jpegSize(jpegStream(sos, frame(0xc0, 50, 50)))).toBeNull()
  })

  it('refuses a stream with no frame header at all', () => {
    expect(jpegSize(jpegStream())).toBeNull()
  })

  it('refuses a file that is not a JPEG', () => {
    expect(jpegSize(pngBytes(4, 4))).toBeNull()
  })
})

describe('webpSize', () => {
  /** RIFF container around one chunk. */
  function riff(chunk: readonly number[]): Uint8Array {
    const body = [0x57, 0x45, 0x42, 0x50, ...chunk] // "WEBP"
    const out = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, ...body])
    new DataView(out.buffer).setUint32(4, body.length, true)

    return out
  }

  /** A simple lossy WebP: `VP8 ` with a keyframe header. */
  function lossy(width: number, height: number): Uint8Array {
    return riff([
      0x56,
      0x50,
      0x38,
      0x20,
      0x10,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x9d,
      0x01,
      0x2a,
      width & 0xff,
      width >> 8,
      height & 0xff,
      height >> 8,
      0x00,
      0x00,
      0x00,
      0x00,
    ])
  }

  /** An extended WebP: `VP8X` with 24-bit canvas dimensions minus one. */
  function extended(width: number, height: number): Uint8Array {
    const w = width - 1
    const h = height - 1

    return riff([
      // "VP8X", a 10-byte chunk, four bytes of flags, then the two dimensions.
      0x56,
      0x50,
      0x38,
      0x58,
      0x0a,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      w & 0xff,
      (w >> 8) & 0xff,
      (w >> 16) & 0xff,
      h & 0xff,
      (h >> 8) & 0xff,
      (h >> 16) & 0xff,
    ])
  }

  it('reads a lossy VP8 keyframe header', () => {
    expect(webpSize(lossy(640, 480))).toEqual({ width: 640, height: 480 })
  })

  it('reads a VP8X canvas, which is where an animation states its size', () => {
    expect(webpSize(extended(4000, 3000))).toEqual({ width: 4000, height: 3000 })
  })

  it('refuses a RIFF file that is not a WebP', () => {
    const wave = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])

    expect(webpSize(wave)).toBeNull()
  })

  it('refuses a truncated container', () => {
    expect(webpSize(lossy(640, 480).subarray(0, 18))).toBeNull()
  })

  it('refuses a lossy chunk whose sync code is wrong', () => {
    const broken = lossy(640, 480)
    broken[23] = 0x00 // the 0x9d of the keyframe sync code

    expect(webpSize(broken)).toBeNull()
  })
})

describe('rasterSize', () => {
  it('dispatches on the magic bytes rather than on a claimed format', () => {
    expect(rasterSize(pngBytes(12, 34))).toEqual({ width: 12, height: 34 })
    expect(rasterSize(jpegBytes(56, 78))).toEqual({ width: 56, height: 78 })
    expect(rasterSize(Uint8Array.of(0x49, 0x49, 0x2a, 0x00))).toBeNull()
  })

  it('answers null for a format it has no reader for, rather than guessing', () => {
    // BMP, TIFF, AVIF and HEIC all reach here from the canvas engine. Abstaining
    // is the contract: the caller falls back to checking the decoded bitmap.
    expect(rasterSize(Uint8Array.of(0x42, 0x4d, 0x36, 0x00))).toBeNull()
  })
})
