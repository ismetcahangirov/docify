/**
 * A minimal BMP writer.
 *
 * ## Why this file exists at all
 *
 * `OffscreenCanvas.convertToBlob()` writes PNG, JPEG and WebP. It does not write
 * BMP, and no browser has ever shipped a BMP encoder — decoding is universal,
 * encoding is nowhere. So the choice for `→ bmp` was: drop the format, pull in a
 * WASM image library for it, or write the container by hand.
 *
 * BMP is the one raster format where writing it by hand is the *cheap* option: a
 * fixed header followed by uncompressed rows. This module is under 150 lines and
 * costs zero bytes of download, which is the whole promise of the canvas engine
 * (issue #30: "with zero additional download"). Reaching for `wasm-vips` — 5.5 MB
 * gated behind SIMD — to write a header would have broken it.
 *
 * ## The two shapes it emits
 *
 * Classic BMP has no alpha channel. Alpha needs `BI_BITFIELDS` with an explicit
 * mask, which in turn needs the 108-byte `BITMAPV4HEADER`, and a handful of old
 * decoders read that byte-for-byte as the 40-byte header and produce garbage.
 *
 * So the shape follows the image rather than a fixed choice:
 *
 * - **fully opaque** → 24-bit `BI_RGB`, `BITMAPINFOHEADER`. The most widely
 *   readable BMP there is, and the common case: everything arriving from JPEG,
 *   and most PNGs.
 * - **any transparent pixel** → 32-bit `BI_BITFIELDS`, `BITMAPV4HEADER`, alpha
 *   preserved. Compositing it onto white instead would be a silent, permanent
 *   edit to the user's image, which is worse than a slightly younger format.
 *
 * Rows are stored bottom-up (positive `height`) and padded to four bytes, which
 * is what every decoder expects; a negative height for top-down rows is legal
 * but read wrongly by enough software to be not worth it.
 *
 * Pure and synchronous — no canvas, no DOM, no globals — so it is testable in
 * `node` and safe to reach from the worker.
 */

const FILE_HEADER_BYTES = 14
const INFO_HEADER_BYTES = 40
const V4_HEADER_BYTES = 108

/** `BM`, as the little-endian `uint16` it is written as. */
const SIGNATURE = 0x4d42

const BI_RGB = 0
const BI_BITFIELDS = 3

/** `LCS_sRGB` — the header field that says "these bytes are sRGB". */
const LCS_SRGB = 0x73524742

/** 72 dpi in pixels per metre, the value a canvas image implicitly has. */
const PIXELS_PER_METRE = 2835

const OPAQUE = 255

/**
 * Non-premultiplied RGBA in row-major order, top row first.
 *
 * `ImageData` satisfies this structurally, so `getImageData()` output can be
 * passed straight in — but the encoder never mentions `ImageData` itself, which
 * is what keeps it testable without a DOM.
 */
export interface RgbaImage {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

/**
 * Encodes `image` as a BMP file.
 *
 * Throws `RangeError` rather than emitting a file no decoder can open: a
 * truncated buffer or a fractional dimension is a bug upstream, and a corrupt
 * download would surface it to the user as "this file is broken".
 */
export function encodeBmp(image: RgbaImage): Uint8Array<ArrayBuffer> {
  const { width, height, data } = image

  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new RangeError(`A BMP needs whole positive dimensions; got ${width}×${height}.`)
  }

  const needed = width * height * 4
  if (data.length < needed) {
    throw new RangeError(`A ${width}×${height} image needs ${needed} bytes; got ${data.length}.`)
  }

  return hasTransparency(data, needed) ? encodeBgra(image) : encodeBgr(image)
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function hasTransparency(data: Uint8ClampedArray, length: number): boolean {
  for (let index = 3; index < length; index += 4) {
    if (data[index] !== OPAQUE) return true
  }

  return false
}

/** 24-bit `BI_RGB`: three bytes per pixel, each row padded out to a multiple of four. */
function encodeBgr(image: RgbaImage): Uint8Array<ArrayBuffer> {
  const { width, height, data } = image
  const stride = (width * 3 + 3) & ~3
  const pixelOffset = FILE_HEADER_BYTES + INFO_HEADER_BYTES

  const { bytes, view } = allocate(pixelOffset, stride * height)
  writeHeaders(view, { image, headerBytes: INFO_HEADER_BYTES, bitCount: 24, stride })

  for (let y = 0; y < height; y += 1) {
    // BMP stores the bottom row first, so the last source row is written first.
    let target = pixelOffset + (height - 1 - y) * stride
    let source = y * width * 4

    for (let x = 0; x < width; x += 1) {
      bytes[target] = data[source + 2]
      bytes[target + 1] = data[source + 1]
      bytes[target + 2] = data[source]
      target += 3
      source += 4
    }
    // The padding bytes are already zero: the buffer starts zeroed.
  }

  return bytes
}

/** 32-bit `BI_BITFIELDS`: four bytes per pixel, so rows are aligned already. */
function encodeBgra(image: RgbaImage): Uint8Array<ArrayBuffer> {
  const { width, height, data } = image
  const stride = width * 4
  const pixelOffset = FILE_HEADER_BYTES + V4_HEADER_BYTES

  const { bytes, view } = allocate(pixelOffset, stride * height)
  writeHeaders(view, { image, headerBytes: V4_HEADER_BYTES, bitCount: 32, stride })

  // The masks below say where each channel sits inside a little-endian uint32,
  // which for these values is exactly the byte order B, G, R, A.
  view.setUint32(54, 0x00ff0000, true)
  view.setUint32(58, 0x0000ff00, true)
  view.setUint32(62, 0x000000ff, true)
  view.setUint32(66, 0xff000000, true)
  view.setUint32(70, LCS_SRGB, true)
  // The colour endpoints and gamma that follow stay zero: `LCS_sRGB` means a
  // decoder ignores them.

  for (let y = 0; y < height; y += 1) {
    let target = pixelOffset + (height - 1 - y) * stride
    let source = y * stride

    for (let x = 0; x < width; x += 1) {
      bytes[target] = data[source + 2]
      bytes[target + 1] = data[source + 1]
      bytes[target + 2] = data[source]
      bytes[target + 3] = data[source + 3]
      target += 4
      source += 4
    }
  }

  return bytes
}

function allocate(pixelOffset: number, pixelBytes: number) {
  const buffer = new ArrayBuffer(pixelOffset + pixelBytes)
  return { bytes: new Uint8Array(buffer), view: new DataView(buffer) }
}

interface HeaderFields {
  image: RgbaImage
  headerBytes: number
  bitCount: number
  stride: number
}

/** Writes the `BITMAPFILEHEADER` and the first 40 bytes of the info header. */
function writeHeaders(view: DataView, fields: HeaderFields): void {
  const { image, headerBytes, bitCount, stride } = fields
  const pixelOffset = FILE_HEADER_BYTES + headerBytes
  const pixelBytes = stride * image.height

  view.setUint16(0, SIGNATURE, true)
  view.setUint32(2, pixelOffset + pixelBytes, true)
  // Bytes 6..9 are two reserved uint16s, left zero.
  view.setUint32(10, pixelOffset, true)

  view.setUint32(14, headerBytes, true)
  view.setInt32(18, image.width, true)
  // Positive height: rows run bottom-up, the orientation every decoder handles.
  view.setInt32(22, image.height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, bitCount, true)
  view.setUint32(30, bitCount === 32 ? BI_BITFIELDS : BI_RGB, true)
  view.setUint32(34, pixelBytes, true)
  view.setInt32(38, PIXELS_PER_METRE, true)
  view.setInt32(42, PIXELS_PER_METRE, true)
  // `biClrUsed` and `biClrImportant` stay zero: there is no palette.
}
