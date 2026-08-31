/**
 * Unwrapping a container's codec configuration into what WebCodecs asks for.
 *
 * `./mp4-demux` keeps a track's configuration as the complete box it found —
 * opaque, so that a remux can put the same bytes back without understanding
 * them. A decoder wants something narrower: `VideoDecoderConfig.description` is
 * the *record* inside an `avcC`, and `AudioDecoderConfig.description` is the
 * AudioSpecificConfig buried three descriptors deep inside an `esds`. This is
 * the one place that knows the difference.
 *
 * It is a separate module from either codec path because both need it and
 * neither owns it, and because unwrapping is pure byte arithmetic that deserves
 * to be tested without a codec in the room.
 */

import type { Mp4TrackFormat } from './mp4-media'

/** A box header is a four-byte length and a four-character type. */
const BOX_HEADER_BYTES = 8

/** `esds` is a full box: the header is followed by a version and three flag bytes. */
const FULL_BOX_HEADER_BYTES = BOX_HEADER_BYTES + 4

/**
 * Boxes whose payload *is* the decoder configuration, with nothing wrapped
 * around it.
 *
 * The common case, and the reason it is a list rather than a parse: an `av1C`
 * and an `hvcC` have completely different contents and identical handling.
 */
const PAYLOAD_IS_THE_RECORD: ReadonlySet<string> = new Set([
  'avcC',
  'hvcC',
  'vvcC',
  'av1C',
  'vpcC',
  'dOps',
  'dfLa',
])

/** ISO/IEC 14496-1 descriptor tags, the three an `esds` nests. */
const ES_DESCRIPTOR = 0x03
const DECODER_CONFIG_DESCRIPTOR = 0x04
const DECODER_SPECIFIC_INFO = 0x05

/**
 * The description a WebCodecs decoder configuration should carry, or
 * `undefined` when the track needs none.
 *
 * `undefined` is a real answer rather than a failure: an Annex B H.264 stream
 * carries its parameter sets inline and a decoder configured without a
 * description is exactly right for it. Anything this cannot make sense of also
 * answers `undefined`, which degrades to "let the decoder work it out" rather
 * than failing a conversion over a box shape nobody anticipated.
 */
export function codecDescription(format: Mp4TrackFormat): Uint8Array | undefined {
  const { description, descriptionType } = format
  if (description === undefined || descriptionType === undefined) return undefined
  if (description.length <= BOX_HEADER_BYTES) return undefined

  if (PAYLOAD_IS_THE_RECORD.has(descriptionType)) {
    return description.subarray(BOX_HEADER_BYTES)
  }

  return descriptionType === 'esds' ? audioSpecificConfig(description) : undefined
}

/**
 * The AudioSpecificConfig inside an `esds` box.
 *
 * Three nested descriptors deep: an ES descriptor holds a decoder configuration
 * descriptor, which holds the codec's own bytes. Each is a one-byte tag, a
 * length in the format ISO/IEC 14496-1 calls *expandable* — seven bits per byte,
 * top bit set to continue — and then a payload whose shape depends on the tag.
 *
 * The two skips inside are what the specification fixes: an ES descriptor opens
 * with a two-byte identifier and a flags byte, and a decoder configuration
 * descriptor opens with thirteen bytes of object type, stream type, buffer size
 * and bitrates.
 */
function audioSpecificConfig(box: Uint8Array): Uint8Array | undefined {
  const elementary = descriptor(box, FULL_BOX_HEADER_BYTES, ES_DESCRIPTOR)
  if (elementary === null) return undefined

  const flags = box[elementary.start + 2]
  // The flags byte says whether the descriptor carries a stream dependency, a
  // URL or an OCR reference before the decoder configuration; each adds bytes.
  let at = elementary.start + 3
  if ((flags & 0x80) !== 0) at += 2
  if ((flags & 0x40) !== 0) at += 1 + box[at]
  if ((flags & 0x20) !== 0) at += 2

  const configuration = descriptor(box, at, DECODER_CONFIG_DESCRIPTOR)
  if (configuration === null) return undefined

  const specific = descriptor(box, configuration.start + 13, DECODER_SPECIFIC_INFO)
  if (specific === null || specific.length === 0) return undefined

  return box.subarray(specific.start, specific.start + specific.length)
}

/** One descriptor at `at`, if it carries the tag expected there. */
function descriptor(
  bytes: Uint8Array,
  at: number,
  tag: number,
): { start: number; length: number } | null {
  if (at >= bytes.length || bytes[at] !== tag) return null

  let length = 0
  let cursor = at + 1
  // At most four length bytes, which is what the format allows.
  for (let step = 0; step < 4 && cursor < bytes.length; step += 1) {
    const byte = bytes[cursor]
    cursor += 1
    length = (length << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) break
  }

  if (cursor + length > bytes.length) return null

  return { start: cursor, length }
}
