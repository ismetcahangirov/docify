// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { codecDescription } from '@/lib/engines/codec-description'
import type { Mp4TrackFormat } from '@/lib/engines/mp4-media'

/** A complete box: four bytes of length, four of type, then the payload. */
function box(type: string, payload: readonly number[]): Uint8Array {
  const size = 8 + payload.length

  return new Uint8Array([
    (size >> 24) & 0xff,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    ...[...type].map((character) => character.charCodeAt(0)),
    ...payload,
  ])
}

/** The descriptor tree an `esds` wraps around an AudioSpecificConfig. */
function esds(config: readonly number[], options: { longForm?: boolean } = {}): Uint8Array {
  // The expandable length format allows the same number written in up to four
  // bytes; a producer that pads it is still conforming, and plenty do.
  const length = (value: number) => (options.longForm ? [0x80, 0x80, 0x80, value] : [value])

  const specific = [0x05, ...length(config.length), ...config]
  const decoder = [
    0x04,
    ...length(13 + specific.length),
    0x40,
    0x15,
    ...new Array(11).fill(0),
    ...specific,
  ]
  const syncLayer = [0x06, ...length(1), 0x02]
  const elementary = [
    0x03,
    ...length(3 + decoder.length + syncLayer.length),
    0,
    0,
    0,
    ...decoder,
    ...syncLayer,
  ]

  return box('esds', [0, 0, 0, 0, ...elementary])
}

const format = (over: Partial<Mp4TrackFormat>): Mp4TrackFormat => ({
  codec: 'avc1.64001f',
  timescale: 90_000,
  ...over,
})

describe('codecDescription', () => {
  it('takes the record out of the box for a video configuration', () => {
    const record = [1, 0x64, 0, 0x1f, 0xff]

    expect(
      codecDescription(format({ description: box('avcC', record), descriptionType: 'avcC' })),
    ).toEqual(new Uint8Array(record))
  })

  it('does the same for every codec that stores its record plainly', () => {
    for (const type of ['hvcC', 'av1C', 'vpcC', 'dOps', 'dfLa']) {
      expect(
        codecDescription(format({ description: box(type, [9, 8, 7]), descriptionType: type })),
      ).toEqual(new Uint8Array([9, 8, 7]))
    }
  })

  it('digs the AudioSpecificConfig out of an esds descriptor tree', () => {
    // Three descriptors deep: elementary stream, decoder configuration, then the
    // codec's own two bytes. Copying the whole box across would configure the
    // decoder with a tree it does not understand.
    expect(
      codecDescription(format({ description: esds([0x12, 0x10]), descriptionType: 'esds' })),
    ).toEqual(new Uint8Array([0x12, 0x10]))
  })

  it('reads a length written in the padded form producers are also allowed', () => {
    expect(
      codecDescription(
        format({ description: esds([0x12, 0x10], { longForm: true }), descriptionType: 'esds' }),
      ),
    ).toEqual(new Uint8Array([0x12, 0x10]))
  })

  it('is undefined for a track that carries no configuration at all', () => {
    // Not a failure: an Annex B stream carries its parameter sets inline, and a
    // decoder configured without a description is right for it.
    expect(codecDescription(format({}))).toBeUndefined()
    expect(
      codecDescription(format({ description: box('avcC', []), descriptionType: 'avcC' })),
    ).toBeUndefined()
  })

  it('abstains rather than guessing at a box shape it does not know', () => {
    expect(
      codecDescription(format({ description: box('wxyz', [1, 2, 3]), descriptionType: 'wxyz' })),
    ).toBeUndefined()
  })

  it('abstains on an esds whose tree is truncated', () => {
    const broken = box('esds', [0, 0, 0, 0, 0x03, 0x40, 0, 0, 0])

    expect(
      codecDescription(format({ description: broken, descriptionType: 'esds' })),
    ).toBeUndefined()
  })
})
