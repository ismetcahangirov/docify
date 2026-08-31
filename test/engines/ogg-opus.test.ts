// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  crc32,
  lacingFor,
  OPUS_OUTPUT_RATE,
  OPUS_PRE_SKIP,
  writeOggOpus,
} from '@/lib/engines/ogg-opus'

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length))

/** Walks a stream into its pages, checking the capture pattern as it goes. */
function pages(stream: Uint8Array) {
  const found: {
    flags: number
    granulePosition: number
    sequence: number
    checksum: number
    payload: Uint8Array
    whole: Uint8Array
  }[] = []
  let at = 0

  while (at < stream.length) {
    expect(ascii(stream, at, 4)).toBe('OggS')

    const view = new DataView(stream.buffer, stream.byteOffset + at)
    const segments = stream[at + 26]
    const lacing = stream.subarray(at + 27, at + 27 + segments)
    const payloadLength = lacing.reduce((total, byte) => total + byte, 0)
    const end = at + 27 + segments + payloadLength

    found.push({
      flags: stream[at + 5],
      granulePosition: view.getUint32(6, true) + view.getUint32(10, true) * 0x1_0000_0000,
      sequence: view.getUint32(18, true),
      checksum: view.getUint32(22, true),
      payload: stream.subarray(at + 27 + segments, end),
      whole: stream.subarray(at, end),
    })

    at = end
  }

  return found
}

const packet = (length: number, fill: number) => new Uint8Array(length).fill(fill)

describe('crc32', () => {
  it('is Ogg’s variant, not the common one', () => {
    // Ogg uses the same polynomial as zlib and none of its reflection, initial
    // value or final XOR. `crc32("123456789")` is 0xCBF43926 in the common
    // variant and 0x89A1897F in this one; getting it wrong writes a file every
    // player rejects with no clue as to why.
    const message = new Uint8Array([...'123456789'].map((c) => c.charCodeAt(0)))

    expect(crc32(message)).toBe(0x89a1_897f)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('lacingFor', () => {
  it('writes a short packet as one byte', () => {
    expect([...lacingFor([packet(100, 1)])]).toEqual([100])
  })

  it('splits a long packet into 255s and a remainder', () => {
    expect([...lacingFor([packet(600, 1)])]).toEqual([255, 255, 90])
  })

  it('adds the trailing zero a multiple of 255 needs', () => {
    // Without it a reader takes the next packet as a continuation of this one,
    // which is the classic way an Ogg writer corrupts every file it makes.
    expect([...lacingFor([packet(255, 1)])]).toEqual([255, 0])
    expect([...lacingFor([packet(510, 1)])]).toEqual([255, 255, 0])
  })

  it('refuses a packet no single page could hold', () => {
    expect(() => lacingFor([packet(255 * 256, 1)])).toThrow(/too large for one Ogg page/)
  })
})

describe('writeOggOpus', () => {
  const stream = () =>
    writeOggOpus(
      [
        { data: packet(40, 0xaa), granulePosition: 960 },
        { data: packet(40, 0xbb), granulePosition: 1920 },
      ],
      2,
      48_000,
    )

  it('opens with the two headers RFC 7845 requires, each on its own page', () => {
    const found = pages(stream())

    expect(ascii(found[0].payload, 0, 8)).toBe('OpusHead')
    expect(ascii(found[1].payload, 0, 8)).toBe('OpusTags')
  })

  it('marks the first page as the start of the stream and the last as the end', () => {
    const found = pages(stream())

    expect(found[0].flags).toBe(0x02)
    expect(found.at(-1)?.flags).toBe(0x04)
    expect(found.slice(1, -1).every((page) => page.flags === 0x00)).toBe(true)
  })

  it('numbers its pages from zero, without a gap', () => {
    expect(pages(stream()).map((page) => page.sequence)).toEqual([0, 1, 2, 3])
  })

  it('states the channel count and the pre-skip in the identification header', () => {
    const [head] = pages(stream())
    const view = new DataView(head.payload.buffer, head.payload.byteOffset)

    expect(head.payload[8]).toBe(1) // version
    expect(head.payload[9]).toBe(2) // channels
    expect(view.getUint16(10, true)).toBe(OPUS_PRE_SKIP)
    expect(view.getUint32(12, true)).toBe(48_000)
  })

  it('records the source rate for a player to report, though decoding is always 48 kHz', () => {
    const found = pages(writeOggOpus([{ data: packet(10, 1), granulePosition: 960 }], 1, 44_100))
    const view = new DataView(found[0].payload.buffer, found[0].payload.byteOffset)

    expect(view.getUint32(12, true)).toBe(44_100)
    expect(OPUS_OUTPUT_RATE).toBe(48_000)
  })

  it('carries each packet’s granule position, which is what a player seeks with', () => {
    const found = pages(stream())

    // The headers carry none; each audio page ends at the sample count it
    // brings the stream to.
    expect(found.map((page) => page.granulePosition)).toEqual([0, 0, 960, 1920])
  })

  it('checksums every page over itself with the field zeroed', () => {
    for (const page of pages(stream())) {
      const zeroed = Uint8Array.from(page.whole)
      new DataView(zeroed.buffer).setUint32(22, 0, true)

      expect(crc32(zeroed)).toBe(page.checksum)
    }
  })

  it('puts each audio packet on a page of its own, so a seek lands exactly', () => {
    const found = pages(stream())

    expect(found[2].payload).toEqual(packet(40, 0xaa))
    expect(found[3].payload).toEqual(packet(40, 0xbb))
  })

  it('still ends the stream when a source produced no packets at all', () => {
    // Without the end-of-stream flag a reader treats the file as truncated, so
    // the comment header's page carries it instead.
    const found = pages(writeOggOpus([], 2, 48_000))

    expect(found).toHaveLength(2)
    expect(found[1].flags).toBe(0x04)
  })
})
