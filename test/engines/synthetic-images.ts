/**
 * PNG and JPEG bytes of an exact pixel size, built at run time.
 *
 * Committing a fixture image would be the obvious alternative and is the wrong
 * one here: the tests that use these assert on the *dimensions*, so the number
 * in the assertion and the number in the file have to agree, and a binary is
 * the one kind of file a reviewer cannot check that in. Generating the image
 * from the same literal the assertion reads removes the question.
 */

import { zlibSync } from 'fflate'

/** The eight bytes every PNG starts with (PNG spec, 5.2). */
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

/**
 * A real, decodable 8-bit truecolour PNG filled with mid-grey.
 *
 * It has to be genuinely valid, unlike the JPEG below: pdf-lib decodes PNG in
 * order to split the colour and alpha channels into two PDF streams, so a
 * header-only PNG would never reach the page.
 */
export function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const stride = 1 + width * 3
  const raw = new Uint8Array(height * stride)

  for (let row = 0; row < height; row += 1) {
    // Filter byte 0 — "none". Every other filter would need the encoder to
    // subtract neighbouring pixels, which buys the test nothing.
    raw[row * stride] = 0
    raw.fill(0x80, row * stride + 1, (row + 1) * stride)
  }

  const header = new Uint8Array(13)
  const fields = new DataView(header.buffer)
  fields.setUint32(0, width)
  fields.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour, no palette

  return concat(
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  )
}

/**
 * A JPEG carrying nothing but its frame header — SOI, SOF0, EOI.
 *
 * That is exactly as much of a JPEG as this engine ever looks at. pdf-lib scans
 * forward to the first start-of-frame marker for the dimensions and colour
 * space, then hands the bytes through to a `DCTDecode` stream untouched; it
 * never runs a Huffman decoder. Synthesising entropy-coded scan data to satisfy
 * a reader that does not read it would be a page of code testing nothing.
 */
export function jpegBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(15)
  frame[0] = 8 // sample precision, bits
  frame[1] = height >> 8
  frame[2] = height & 0xff
  frame[3] = width >> 8
  frame[4] = width & 0xff
  frame[5] = 3 // three components, so pdf-lib reads it as DeviceRGB

  for (let component = 0; component < 3; component += 1) {
    frame[6 + component * 3] = component + 1 // identifier
    frame[7 + component * 3] = 0x11 // 1×1 sampling factors
    frame[8 + component * 3] = 0 // quantisation table selector
  }

  return concat(
    Uint8Array.of(0xff, 0xd8), // SOI
    // SOF0, then the segment length, which counts its own two bytes.
    Uint8Array.of(0xff, 0xc0, 0x00, frame.length + 2),
    frame,
    Uint8Array.of(0xff, 0xd9), // EOI
  )
}

/** Length, type, payload, CRC — the PNG chunk layout (PNG spec, 5.3). */
function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length)
  const fields = new DataView(out.buffer)

  fields.setUint32(0, data.length)
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index)
  out.set(data, 8)
  // The CRC covers the type and the payload, but not the length.
  fields.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))

  return out
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0

  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }

  return out
}
