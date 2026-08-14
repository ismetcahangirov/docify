/**
 * How large an image is, read out of its header and nothing else.
 *
 * Pixel dimensions are the one fact an engine needs *before* it hands a file to
 * a decoder, because a decoded bitmap costs `width × height × bytes-per-pixel`
 * however well the file compressed. `./raster-limits` turns that into a budget
 * decision; this module is only the reading, and it is separate so the parsers
 * can be exercised against malformed bytes without a budget in scope.
 *
 * Three rules hold throughout:
 *
 * 1. **Every reader abstains rather than guesses.** `null` means "no dimensions
 *    I would stand behind", and a caller must treat that as "unknown", never as
 *    "empty" or "fine". A wrong size read *small* silently switches off the
 *    ceiling that depends on it.
 * 2. **The bytes are untrusted.** These headers come from files strangers made.
 *    Every offset is bounds-checked against the buffer, every declared length is
 *    checked against what the field actually needs, and the JPEG walk cannot
 *    stand still — so no input loops forever or reads out of range.
 * 3. **Nothing here dispatches on a file name.** `descriptor.supports()` gates
 *    on `task.from`, which comes from the extension, so a JPEG called `.png`
 *    reaches an engine claiming to be a PNG.
 */

/** Pixel dimensions read from a header, before any decoder sees the file. */
export interface ImageSize {
  readonly width: number
  readonly height: number
}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const JPEG_SIGNATURE = Uint8Array.of(0xff, 0xd8, 0xff)
const RIFF_SIGNATURE = Uint8Array.of(0x52, 0x49, 0x46, 0x46)

/** IHDR is the first chunk, so its fields sit at fixed offsets. */
const IHDR_TYPE_OFFSET = 12
const IHDR_WIDTH_OFFSET = 16
const IHDR_DECLARED_LENGTH = 13
const PNG_MIN_LENGTH = IHDR_WIDTH_OFFSET + 8

/**
 * The smallest a start-of-frame segment can legally be: two bytes of length,
 * one of sample precision, two of height, two of width, one component count.
 * A segment shorter than this cannot hold the fields the reader is about to
 * take, and reading them anyway lifts four bytes out of whatever follows.
 */
const SOF_MIN_LENGTH = 8

/** `RIFF` + size + `WEBP` + a four-byte chunk tag + that chunk's size. */
const WEBP_CHUNK_OFFSET = 12
const WEBP_MIN_LENGTH = WEBP_CHUNK_OFFSET + 8

/**
 * The dimensions of whichever format these bytes actually are, or `null`.
 *
 * PNG, JPEG and WebP have readers here because those are the formats an engine
 * both accepts and can be handed at a size its bytes do not predict. BMP, TIFF,
 * AVIF and the HEIC that Apple hardware decodes reach the canvas engine too and
 * answer `null`, which is a deliberate abstention — see the module header.
 */
export function rasterSize(bytes: Uint8Array): ImageSize | null {
  return pngSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes)
}

/**
 * The dimensions in a PNG's IHDR.
 *
 * The spec requires IHDR to be the *first* chunk and fixes its length at 13, so
 * no chunk walk is needed — but both facts are checked rather than assumed,
 * because a file that merely spells `IHDR` at the right offset would otherwise
 * be trusted for the eight bytes after it.
 */
export function pngSize(bytes: Uint8Array): ImageSize | null {
  if (!startsWith(bytes, PNG_SIGNATURE) || bytes.length < PNG_MIN_LENGTH) return null
  if (!isChunkType(bytes, IHDR_TYPE_OFFSET, 'IHDR')) return null

  const fields = viewOf(bytes)
  if (fields.getUint32(8) !== IHDR_DECLARED_LENGTH) return null

  return sizeOf(fields.getUint32(IHDR_WIDTH_OFFSET), fields.getUint32(IHDR_WIDTH_OFFSET + 4))
}

/**
 * The dimensions in a JPEG's start-of-frame segment.
 *
 * Walks the marker chain rather than assuming an offset: a camera file opens
 * with APP0/APP1 for JFIF and Exif, can carry a colour profile split across a
 * dozen APP2 segments, and always has its Huffman tables before the frame. The
 * walk stops at SOS, after which the bytes are entropy-coded and a `0xFF` no
 * longer introduces a marker.
 */
export function jpegSize(bytes: Uint8Array): ImageSize | null {
  if (!startsWith(bytes, JPEG_SIGNATURE)) return null

  const fields = viewOf(bytes)
  let at = 2

  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null

    const code = bytes[at + 1]

    // Any number of 0xFF bytes may pad the gap before a marker code (JPEG,
    // B.1.1.3), so step one byte and look again.
    if (code === 0xff) {
      at += 1
      continue
    }

    // 0xFF00 is a stuffed data byte, not a marker. Reaching one outside the
    // entropy-coded stream means the walk has lost the chain.
    if (code === 0x00) return null

    if (isStandalone(code)) {
      at += 2
      continue
    }

    // SOS starts the entropy-coded data and EOI ends the image; either way
    // there is no frame header left to find.
    if (code === 0xda || code === 0xd9) return null

    const length = fields.getUint16(at + 2)
    // The length counts its own two bytes, so anything below that is nonsense
    // and anything that runs past the buffer is a truncated file.
    if (length < 2 || at + 2 + length > bytes.length) return null

    if (isStartOfFrame(code)) {
      if (length < SOF_MIN_LENGTH) return null

      // Sample precision first, then height before width.
      return sizeOf(fields.getUint16(at + 7), fields.getUint16(at + 5))
    }

    at += 2 + length
  }

  return null
}

/**
 * The dimensions of a WebP, from either shape the format takes.
 *
 * Worth reading rather than leaving to the decoder: WebP is the format most
 * likely to state an enormous canvas in a file of a few hundred bytes, and it
 * is one the canvas engine accepts. `VP8X` carries the canvas size of an
 * extended or animated file; a plain `VP8 ` keyframe carries its own. The
 * lossless `VP8L` shape is not read here — it packs its dimensions into a
 * bit-field, and the decoded-bitmap check covers what this abstains on.
 */
export function webpSize(bytes: Uint8Array): ImageSize | null {
  if (!startsWith(bytes, RIFF_SIGNATURE) || bytes.length < WEBP_MIN_LENGTH) return null
  if (!isChunkType(bytes, 8, 'WEBP')) return null

  const fields = viewOf(bytes)

  if (isChunkType(bytes, WEBP_CHUNK_OFFSET, 'VP8X')) {
    // Three bytes each, little-endian, stored as the dimension minus one.
    if (bytes.length < 30) return null

    return sizeOf(uint24(bytes, 24) + 1, uint24(bytes, 27) + 1)
  }

  if (isChunkType(bytes, WEBP_CHUNK_OFFSET, 'VP8 ')) {
    if (bytes.length < 30) return null
    // The keyframe start code, which is what says this is a keyframe header and
    // not a fragment that happens to sit here.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null

    // Fourteen bits of dimension and two of scale, little-endian.
    return sizeOf(fields.getUint16(26, true) & 0x3fff, fields.getUint16(28, true) & 0x3fff)
  }

  return null
}

/**
 * A `DataView` over exactly this array's bytes.
 *
 * `bytes.buffer` alone is wrong for a subarray — it is the whole underlying
 * buffer — and every offset in this module is relative to the array it was
 * handed.
 */
function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function uint24(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
}

/** Positive integers only — a zero or absurd dimension is a header we cannot use. */
function sizeOf(width: number, height: number): ImageSize | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width <= 0 || height <= 0) return null

  return { width, height }
}

/**
 * Markers that carry no length field: TEM, and the eight restart markers. SOI
 * is here too — a second one mid-stream is malformed, but treating it as
 * length-bearing would read the next two bytes as a step and send the walk
 * anywhere in the file.
 */
function isStandalone(code: number): boolean {
  return code === 0x01 || code === 0xd8 || (code >= 0xd0 && code <= 0xd7)
}

/**
 * SOF0..SOF15, minus the three markers that share the range and are not frame
 * headers: DHT (0xC4), JPG (0xC8) and DAC (0xCC). Baseline, extended,
 * progressive and lossless frames all qualify, and all state their size the same
 * way — reading only SOF0 would switch the ceiling off for every progressive
 * JPEG, which is half the web.
 */
function isStartOfFrame(code: number): boolean {
  return code >= 0xc0 && code <= 0xcf && code !== 0xc4 && code !== 0xc8 && code !== 0xcc
}

function isChunkType(bytes: Uint8Array, at: number, type: string): boolean {
  if (at + type.length > bytes.length) return false

  return [...type].every((character, index) => bytes[at + index] === character.charCodeAt(0))
}

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)
}
