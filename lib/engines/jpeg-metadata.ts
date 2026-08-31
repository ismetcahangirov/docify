/**
 * Carrying a JPEG's metadata across a re-encode, or leaving it behind.
 *
 * A canvas decodes to RGBA and encodes from scratch, so everything that was not
 * a pixel is gone: Exif, the ICC profile, XMP, IPTC. That is the right default —
 * `ImageOptions.keepMetadata` is `false` because holiday photos carry GPS
 * coordinates and a converted file usually leaves the device it was made on —
 * but it is only a *default* if the other answer is available too, and until
 * this module the canvas engine could not give it.
 *
 * ## What counts as metadata
 *
 * The four `APPn` segments that carry something about the photographer or the
 * scene, and nothing else:
 *
 * | Segment | Marker | Signature |
 * |---|---|---|
 * | Exif | `APP1` | `Exif\0\0` — camera, lens, timestamp, and the GPS block |
 * | XMP | `APP1` | `http://ns.adobe.com/xap/1.0/\0` — editing history, captions |
 * | ICC | `APP2` | `ICC_PROFILE\0` — the colour space the file was written in |
 * | IPTC | `APP13` | `Photoshop 3.0\0` — captions, credit, copyright |
 *
 * `JFIF` (`APP0`) is deliberately not on the list: it is the encoding's own
 * density header, every browser encoder writes one, and nobody asking to strip
 * EXIF means it. Nor is a `COM` comment, which no camera writes.
 *
 * ## Why bytes and not a library
 *
 * Splicing segments is a byte operation on a structure the JPEG spec fixes: a
 * two-byte marker, a two-byte big-endian length that counts itself, then the
 * payload. Nothing here decodes an Exif tag or re-orders an IFD, so a metadata
 * library would be a megabyte of parser to move a hundred bytes verbatim. The
 * cost of that decision is that this cannot *edit* metadata, only move it, which
 * is exactly what the keep/strip toggle asks for.
 */

/**
 * How much of a source is read looking for its metadata.
 *
 * JPEG caps every segment at 64 kB, so a megabyte comfortably holds an Exif
 * block, its embedded thumbnail and a multi-segment ICC profile — while keeping
 * a 50 MB photograph out of memory for a question answered in its first few
 * kilobytes. A file whose start-of-scan is beyond this simply reports no
 * metadata, which is the same answer as a file that has none.
 */
export const METADATA_SCAN_BYTES = 1024 * 1024

const MARKER = 0xff
const SOI = 0xd8
/** Start of scan: after this marker the bytes are entropy-coded data, not segments. */
const SOS = 0xda
const APP0 = 0xe0

/** Segments that carry data about the picture rather than about the encoding. */
const METADATA_SIGNATURES: readonly { marker: number; signature: string }[] = [
  { marker: 0xe1, signature: 'Exif\0\0' },
  { marker: 0xe1, signature: 'http://ns.adobe.com/xap/1.0/\0' },
  { marker: 0xe2, signature: 'ICC_PROFILE\0' },
  { marker: 0xed, signature: 'Photoshop 3.0\0' },
]

/**
 * Every metadata segment in `bytes`, whole and in file order.
 *
 * Abstains — an empty list — for anything it cannot read with certainty: a file
 * that is not a JPEG, a segment whose declared length runs past the end of what
 * was given, or a start-of-scan that arrives first. Abstaining is always safe
 * here, because the consequence is metadata that is not carried across, which is
 * the privacy-safe direction and the default anyway.
 *
 * Never reads past the start of scan. Compressed scan data contains byte pairs
 * that look exactly like an `APP1` marker, and splicing one of those into
 * another file would corrupt it.
 */
export function readMetadataSegments(bytes: Uint8Array): Uint8Array[] {
  const found: Uint8Array[] = []

  for (const segment of segments(bytes)) {
    if (isMetadata(bytes, segment)) found.push(bytes.slice(segment.start, segment.end))
  }

  return found
}

/**
 * `bytes` with `segments` spliced in, or `bytes` unchanged when there is nothing
 * to add or it is not a JPEG.
 *
 * The segments go immediately after the start-of-image marker, except that a
 * `JFIF` header keeps its place at the front: the spec requires `APP0` to be the
 * first segment when it is present, and every browser JPEG encoder writes one.
 */
export function withMetadataSegments(
  bytes: Uint8Array<ArrayBuffer>,
  segments: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  if (segments.length === 0 || !isJpeg(bytes)) return bytes

  const at = insertionPoint(bytes)
  const carried = segments.reduce((total, segment) => total + segment.length, 0)
  const output = new Uint8Array(bytes.length + carried)

  output.set(bytes.subarray(0, at), 0)

  let offset = at
  for (const segment of segments) {
    output.set(segment, offset)
    offset += segment.length
  }
  output.set(bytes.subarray(at), offset)

  return output
}

/** One segment's span in the file: `[start, end)`, marker and length included. */
interface Segment {
  marker: number
  start: number
  /** Where the payload begins — after the marker and the two length bytes. */
  payload: number
  end: number
}

/**
 * Walks the segment chain from the start-of-image to the start-of-scan.
 *
 * A generator rather than an array because both callers want different things
 * out of the same walk — one collects, the other stops at the first segment that
 * is not a `JFIF` header — and neither should pay for the other's needs.
 */
function* segments(bytes: Uint8Array): Generator<Segment> {
  if (!isJpeg(bytes)) return

  let at = 2

  while (at + 4 <= bytes.length) {
    // Fill bytes: any number of 0xFF may pad the gap before a marker.
    if (bytes[at] !== MARKER) return
    let marker = bytes[at + 1]
    let markerAt = at
    while (marker === MARKER && markerAt + 2 < bytes.length) {
      markerAt += 1
      marker = bytes[markerAt + 1]
    }

    if (marker === SOS) return

    const start = markerAt
    const length = (bytes[start + 2] << 8) | bytes[start + 3]
    // A length below 2 does not even cover its own two bytes, and one that runs
    // past the buffer means the file is truncated or this is not a segment.
    if (length < 2 || start + 2 + length > bytes.length) return

    const end = start + 2 + length
    yield { marker, start, payload: start + 4, end }
    at = end
  }
}

function isMetadata(bytes: Uint8Array, segment: Segment): boolean {
  return METADATA_SIGNATURES.some(
    ({ marker, signature }) =>
      marker === segment.marker && startsWith(bytes, segment.payload, segment.end, signature),
  )
}

function startsWith(bytes: Uint8Array, from: number, to: number, signature: string): boolean {
  if (to - from < signature.length) return false

  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[from + index] !== signature.charCodeAt(index)) return false
  }

  return true
}

/** Just past the start-of-image, or just past a `JFIF` header where there is one. */
function insertionPoint(bytes: Uint8Array): number {
  for (const segment of segments(bytes)) {
    return segment.marker === APP0 ? segment.end : segment.start
  }

  return 2
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === MARKER && bytes[1] === SOI
}
