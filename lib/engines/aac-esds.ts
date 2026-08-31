/**
 * Wrapping an AudioSpecificConfig back into the `esds` box an MP4 stores it in.
 *
 * The mirror of the `esds` branch of `./codec-description`, and the audio
 * counterpart to putting an `avcC` header back on in `./video-transcode`.
 * WebCodecs reports an AAC encoder's configuration as the codec's own two or
 * three bytes; a sample entry wants those inside a descriptor tree inside a
 * box, and a file written without one has a `mp4a` entry that says `mp4a` and
 * nothing else — which no decoder can configure itself from.
 *
 * ISO/IEC 14496-1 §7.2.6 is the tree. Three descriptors, each a tag, an
 * *expandable* length and a payload:
 *
 * ```
 * ES_Descriptor            0x03  identifier, flags
 *   DecoderConfigDescriptor  0x04  object type, stream type, buffers, bitrates
 *     DecoderSpecificInfo      0x05  the AudioSpecificConfig
 *   SLConfigDescriptor       0x06  predefined = 2, "not used"
 * ```
 *
 * Only the short form of the length is written — one byte, values under 128 —
 * which every AudioSpecificConfig fits inside several times over. The reader in
 * `./codec-description` accepts the padded form too, because producers use it.
 */

/** MPEG-4 audio, from the object type indication table. */
const MPEG4_AUDIO = 0x40

/** An audio elementary stream: stream type 5, upstream 0, reserved 1. */
const AUDIO_STREAM = 0x15

/**
 * The complete `esds` box for `audioSpecificConfig`.
 *
 * The buffer size and the two bitrate fields are written as zero. They are
 * advisory — a hint for a hardware decoder's input buffer — and every
 * WebCodecs-produced stream is played by a decoder that sizes its own; writing a
 * number we would have to invent would be worse than writing none.
 */
export function esdsBox(audioSpecificConfig: Uint8Array): Uint8Array<ArrayBuffer> {
  const specific = descriptor(0x05, audioSpecificConfig)

  const decoderConfig = descriptor(
    0x04,
    concat([
      new Uint8Array([MPEG4_AUDIO, AUDIO_STREAM, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      specific,
    ]),
  )

  // Predefined 2 is "the sync layer is not used", which is what a stream stored
  // in a file rather than carried over a network means.
  const syncLayer = descriptor(0x06, new Uint8Array([0x02]))

  const elementary = descriptor(0x03, concat([new Uint8Array([0, 0, 0]), decoderConfig, syncLayer]))

  // `esds` is a full box: the four bytes after the header are a version and
  // three flag bytes, all zero.
  return box('esds', concat([new Uint8Array([0, 0, 0, 0]), elementary]))
}

function descriptor(tag: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  if (payload.length > 0x7f) {
    throw new Error(
      `An audio codec configuration of ${payload.length} bytes is larger than this writer ` +
        'supports, so the file cannot be written.',
    )
  }

  return concat([new Uint8Array([tag, payload.length]), payload])
}

function box(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(8 + payload.length)
  new DataView(bytes.buffer).setUint32(0, bytes.length)
  bytes.set(
    [...type].map((character) => character.charCodeAt(0)),
    4,
  )
  bytes.set(payload, 8)

  return bytes
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))

  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }

  return out
}
