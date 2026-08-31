// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  METADATA_SCAN_BYTES,
  readMetadataSegments,
  withMetadataSegments,
} from '@/lib/engines/jpeg-metadata'

const SOI = [0xff, 0xd8]
const EOI = [0xff, 0xd9]

/** One `0xFF <marker> <length> <payload>` segment, with the length filled in. */
function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2

  return [0xff, marker, length >> 8, length & 0xff, ...payload]
}

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0))

const exif = () => segment(0xe1, [...ascii('Exif'), 0, 0, 0x11, 0x22])
const xmp = () => segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, 0x33])
const icc = () => segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 0x44])
const iptc = () => segment(0xed, [...ascii('Photoshop 3.0'), 0, 0x55])
const jfif = () => segment(0xe0, [...ascii('JFIF'), 0, 1, 2, 0, 0, 1, 0, 1, 0, 0])
const comment = () => segment(0xfe, ascii('made by a camera'))
/** Start of scan, after which nothing is a segment any more. */
const scan = () => [...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0x56]

const jpeg = (...parts: number[][]) => new Uint8Array([...SOI, ...parts.flat(), ...scan(), ...EOI])

describe('readMetadataSegments', () => {
  it('finds the four segments that actually carry personal data', () => {
    const source = jpeg(jfif(), exif(), icc(), iptc(), xmp(), comment())

    const found = readMetadataSegments(source)

    // Exif, XMP, ICC and IPTC. JFIF is the encoding's own header and a COM is a
    // free-text comment, and neither is metadata anyone means by "strip EXIF".
    expect(found).toHaveLength(4)
    expect(found.map((part) => part[1])).toEqual([0xe1, 0xe2, 0xed, 0xe1])
  })

  it('keeps each segment whole, marker and length included', () => {
    const found = readMetadataSegments(jpeg(exif()))

    expect([...found[0]]).toEqual(exif())
  })

  it('stops at the start of scan, where segments end and entropy data begins', () => {
    // A byte pattern inside compressed scan data can look exactly like an APP1
    // marker. Reading past SOS would splice noise into the next file.
    const source = new Uint8Array([...SOI, ...scan(), ...exif(), ...EOI])

    expect(readMetadataSegments(source)).toEqual([])
  })

  it('is empty for a file that carries nothing', () => {
    expect(readMetadataSegments(jpeg(jfif()))).toEqual([])
  })

  it('abstains rather than guessing when the bytes are not a JPEG', () => {
    expect(readMetadataSegments(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual([])
    expect(readMetadataSegments(new Uint8Array([]))).toEqual([])
  })

  it('abstains on a truncated segment rather than reading past the end', () => {
    // The length says 400 bytes and there are four. Trusting it would read
    // whatever memory happened to follow.
    const source = new Uint8Array([...SOI, 0xff, 0xe1, 0x01, 0x90, 1, 2])

    expect(readMetadataSegments(source)).toEqual([])
  })
})

describe('withMetadataSegments', () => {
  it('puts the segments back, immediately after the start-of-image marker', () => {
    const output = withMetadataSegments(jpeg(), [new Uint8Array(exif())])

    expect([...output.slice(0, 2)]).toEqual(SOI)
    expect([...output.slice(2, 2 + exif().length)]).toEqual(exif())
  })

  it('goes after a JFIF header rather than in front of it', () => {
    // JFIF has to be the first segment when it is present at all, and the
    // browser's own JPEG encoder always writes one.
    const output = withMetadataSegments(jpeg(jfif()), [new Uint8Array(exif())])
    const jfifLength = jfif().length

    expect([...output.slice(2, 2 + jfifLength)]).toEqual(jfif())
    expect([...output.slice(2 + jfifLength, 2 + jfifLength + exif().length)]).toEqual(exif())
  })

  it('leaves everything after the insertion point byte for byte', () => {
    const original = jpeg(jfif())
    const output = withMetadataSegments(original, [new Uint8Array(exif())])

    expect(output).toHaveLength(original.length + exif().length)
    expect([...output.slice(2 + jfif().length + exif().length)]).toEqual([
      ...original.slice(2 + jfif().length),
    ])
  })

  it('changes nothing when there is nothing to carry across', () => {
    const original = jpeg(jfif())

    expect(withMetadataSegments(original, [])).toEqual(original)
  })

  it('leaves a file it does not recognise alone rather than corrupting it', () => {
    const notJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

    expect(withMetadataSegments(notJpeg, [new Uint8Array(exif())])).toEqual(notJpeg)
  })

  it('survives a round trip: what was read is what comes back out', () => {
    const source = jpeg(jfif(), exif(), icc(), iptc(), xmp())
    const bare = jpeg(jfif())

    const carried = withMetadataSegments(bare, readMetadataSegments(source))

    expect(readMetadataSegments(carried)).toEqual(readMetadataSegments(source))
  })
})

describe('the scan limit', () => {
  it('is generous enough for a camera JPEG and bounded enough not to read a whole photo', () => {
    // Each JPEG segment is capped at 64 kB by the format itself, so a megabyte
    // holds an Exif block, a thumbnail and a multi-segment ICC profile with room
    // to spare — without pulling a 50 MB photograph into memory to find them.
    expect(METADATA_SCAN_BYTES).toBe(1024 * 1024)
  })
})
