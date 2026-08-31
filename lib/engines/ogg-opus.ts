/**
 * Writing Opus packets into an Ogg stream — a `.ogg` or `.opus` file.
 *
 * ## Why this is hand-written and mp4box is not reused
 *
 * Opus's home container is Ogg, and Ogg has nothing to do with the ISO base
 * media file format mp4box speaks. It is also a much smaller thing: a stream is
 * a sequence of pages, a page is a 27-byte header plus a table saying how its
 * payload divides into packets, and the whole specification of what this needs
 * is RFC 3533 for the framing and RFC 7845 for the two Opus headers. That is a
 * hundred lines, against a dependency for a format with one producer.
 *
 * ## The three things Ogg gets wrong if you are careless
 *
 * - **Lacing.** A page's payload is described by up to 255 length bytes, each
 *   0..255, where a byte of exactly 255 means "this packet continues". A packet
 *   whose length is a multiple of 255 therefore needs a trailing zero, or the
 *   next packet is swallowed into it.
 * - **The checksum.** Ogg's CRC-32 is not the common one: the polynomial is the
 *   same, but there is no input or output reflection and no final XOR, and it is
 *   computed over the page *including* a zeroed checksum field.
 * - **Granule position.** For Opus it counts output samples at 48 kHz whatever
 *   the input rate was, and it is the position at the *end* of the page. A
 *   player seeks with it, so a stream with plausible-looking but wrong values
 *   plays and cannot be scrubbed.
 */

/** Ogg's own CRC-32: polynomial 0x04c11db7, no reflection, no final XOR. */
const CRC_TABLE = buildCrcTable()

const PAGE_HEADER_BYTES = 27
const MAX_SEGMENTS = 255
const CONTINUATION = 255

/** RFC 7845: Opus decoders always output at 48 kHz, whatever they were fed. */
export const OPUS_OUTPUT_RATE = 48_000

/**
 * Samples the decoder throws away at the start of a stream.
 *
 * 312 at 48 kHz is what an Opus encoder at its default 20 ms frame size needs to
 * converge, and it is the value every encoder reports. Getting it wrong shifts
 * the whole track by a few milliseconds against a video it was muxed beside.
 */
export const OPUS_PRE_SKIP = 312

/** One Opus packet and the total samples it brings the stream to. */
export interface OpusPacket {
  data: Uint8Array
  /** Output samples at 48 kHz, counted from the start of the stream. */
  granulePosition: number
}

/**
 * A complete Ogg stream: the two Opus headers, then the packets.
 *
 * `serial` identifies the logical stream inside the physical one. A file with a
 * single stream can use any number; it is a parameter so a test can pin the
 * bytes and so a future multiplexed file has somewhere to put a second one.
 */
export function writeOggOpus(
  packets: readonly OpusPacket[],
  channels: number,
  inputSampleRate: number,
  serial = 1,
): Uint8Array<ArrayBuffer> {
  const pages: Uint8Array[] = []
  let sequence = 0

  // RFC 7845 requires each of the two headers to occupy a page of its own, and
  // the first page to carry the beginning-of-stream flag.
  pages.push(page([opusHead(channels, inputSampleRate)], 0, serial, sequence, 0x02))
  sequence += 1
  pages.push(page([opusTags()], 0, serial, sequence, 0x00))
  sequence += 1

  for (const [index, packet] of packets.entries()) {
    const last = index === packets.length - 1

    pages.push(page([packet.data], packet.granulePosition, serial, sequence, last ? 0x04 : 0x00))
    sequence += 1
  }

  // A stream has to end somewhere, even one with no audio in it: without the
  // end-of-stream flag a reader treats the file as truncated. Rewriting the
  // comment header's page is cheaper than special-casing the loop above, and it
  // only ever happens for a source that produced no packets at all.
  if (packets.length === 0) {
    pages[1] = page([opusTags()], 0, serial, 1, 0x04)
  }

  return concat(pages)
}

/**
 * The identification header: channels, the delay to discard, and the rate the
 * audio arrived at.
 *
 * `inputSampleRate` is informational — a decoder always outputs 48 kHz — but it
 * is what lets a player tell someone what the file was made from, so it is
 * carried rather than invented.
 */
function opusHead(channels: number, inputSampleRate: number): Uint8Array<ArrayBuffer> {
  const head = new Uint8Array(19)
  head.set(ascii('OpusHead'))
  head[8] = 1 // version
  head[9] = channels
  const view = new DataView(head.buffer)
  view.setUint16(10, OPUS_PRE_SKIP, true)
  view.setUint32(12, inputSampleRate, true)
  view.setInt16(16, 0, true) // output gain, in Q7.8 decibels
  head[18] = 0 // mapping family 0: one or two channels, no channel map

  return head
}

/** The comment header. Required to exist; nothing here has anything to say in it. */
function opusTags(): Uint8Array<ArrayBuffer> {
  const vendor = ascii('docify')
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  tags.set(ascii('OpusTags'))

  const view = new DataView(tags.buffer)
  view.setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  view.setUint32(12 + vendor.length, 0, true) // no user comments

  return tags
}

/**
 * One page carrying `packets`.
 *
 * Deliberately one packet per page for the audio, which costs 27 bytes a packet
 * and buys something worth more: every page ends on a packet boundary and
 * carries its own granule position, so seeking is exact and a truncated file
 * loses one frame rather than a page's worth. Both header packets have to be
 * alone on their pages anyway.
 */
function page(
  packets: readonly Uint8Array[],
  granulePosition: number,
  serial: number,
  sequence: number,
  flags: number,
): Uint8Array<ArrayBuffer> {
  const lacing = lacingFor(packets)
  const payload = concat(packets)
  const bytes = new Uint8Array(PAGE_HEADER_BYTES + lacing.length + payload.length)
  const view = new DataView(bytes.buffer)

  bytes.set(ascii('OggS'))
  bytes[4] = 0 // stream structure version
  bytes[5] = flags
  // A granule position is 64-bit; `setBigUint64` would need the value as a
  // BigInt, and audio never reaches 2^53 samples — that is 570 years at 48 kHz.
  view.setUint32(6, granulePosition % 0x1_0000_0000, true)
  view.setUint32(10, Math.floor(granulePosition / 0x1_0000_0000), true)
  view.setUint32(14, serial, true)
  view.setUint32(18, sequence, true)
  view.setUint32(22, 0, true) // checksum, filled in below
  bytes[26] = lacing.length
  bytes.set(lacing, PAGE_HEADER_BYTES)
  bytes.set(payload, PAGE_HEADER_BYTES + lacing.length)

  view.setUint32(22, crc32(bytes), true)

  return bytes
}

/**
 * The segment table for a page's packets.
 *
 * A packet is written as as many 255s as it has whole multiples of 255, then its
 * remainder — and a packet whose length is an exact multiple needs the trailing
 * zero, or a reader takes the next packet as its continuation.
 */
export function lacingFor(packets: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const segments: number[] = []

  for (const packet of packets) {
    let remaining = packet.length
    while (remaining >= CONTINUATION) {
      segments.push(CONTINUATION)
      remaining -= CONTINUATION
    }
    segments.push(remaining)
  }

  if (segments.length > MAX_SEGMENTS) {
    throw new Error('An Opus packet is too large for one Ogg page, which this writer cannot split.')
  }

  return new Uint8Array(segments)
}

/**
 * Ogg's CRC-32, over a page whose checksum field is zero.
 *
 * Not the CRC-32 of zlib or of PNG: the polynomial is the same and everything
 * around it is different — no reflection either way, no initial value, no final
 * XOR. Feeding a page through the usual implementation produces a file every
 * player rejects, with no clue as to why.
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0

  for (const byte of bytes) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) & 0xff) ^ byte]) >>> 0
  }

  return crc >>> 0
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)

  for (let index = 0; index < 256; index += 1) {
    let value = index << 24

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 0x8000_0000) !== 0 ? ((value << 1) ^ 0x04c1_1db7) >>> 0 : (value << 1) >>> 0
    }

    table[index] = value >>> 0
  }

  return table
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...text].map((character) => character.charCodeAt(0)))
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
