/**
 * What codepoints a woff2 file actually maps — read from the file itself.
 *
 * ## Why this exists
 *
 * The split in `cli.mjs` cuts each family in two, and the one property that
 * makes it safe is that the two halves cover between them everything the
 * original did. The first attempt at it derived the extended half by
 * subtracting the core range from Google's *published* `latin` range, and lost
 * six codepoints — Ă and five Vietnamese combining marks, which the files carry
 * and that published range does not name. Nothing would have reported it: those
 * characters would simply have started rendering in Arial.
 *
 * So the extended half is the source font's own coverage minus the core range,
 * and `test/subset-fonts.test.ts` asserts the partition against the shipped
 * files rather than against a list somebody typed.
 *
 * ## How
 *
 * A woff2 is a table directory followed by one Brotli stream holding every
 * table concatenated, unpadded, in directory order. Only `glyf` and `loca` are
 * ever transformed; `cmap` is stored verbatim, so finding it is a matter of
 * summing the lengths in front of it. Node decompresses Brotli itself, which is
 * why this is thirty lines of arithmetic rather than a font library.
 */

import { brotliDecompressSync } from 'node:zlib'

/** The 63 table tags woff2 encodes as an index, in the order the spec fixes. */
const KNOWN_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
]

/**
 * A UIntBase128 — woff2's variable-length integer, seven bits per byte,
 * high bit set on every byte but the last.
 *
 * @param {Buffer} buffer
 * @param {number} offset
 * @returns {[value: number, next: number]}
 */
function readBase128(buffer, offset) {
  let value = 0
  let cursor = offset

  for (let i = 0; i < 5; i += 1) {
    const byte = buffer[cursor]
    cursor += 1
    value = value * 128 + (byte & 0x7f)
    if ((byte & 0x80) === 0) return [value, cursor]
  }

  throw new Error('woff2: UIntBase128 longer than five bytes')
}

/**
 * The bytes of one table inside a woff2 file.
 *
 * @param {Buffer} file
 * @param {string} wanted four-character table tag
 * @returns {Buffer}
 */
function tableOf(file, wanted) {
  if (file.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a woff2 file')

  const numTables = file.readUInt16BE(12)
  let cursor = 48
  /** @type {{ tag: string, length: number }[]} */
  const directory = []

  for (let i = 0; i < numTables; i += 1) {
    const flags = file[cursor]
    cursor += 1

    const index = flags & 0x3f
    let tag

    if (index === 0x3f) {
      tag = file.toString('latin1', cursor, cursor + 4)
      cursor += 4
    } else {
      tag = KNOWN_TAGS[index]
    }

    const [originalLength, afterOriginal] = readBase128(file, cursor)
    cursor = afterOriginal

    // Only glyf and loca are ever transformed, and only they carry a second
    // length. Transform version 0 is "transformed" for those two and "null"
    // for everything else — which is why the tag has to be checked as well.
    const transformed = (flags >> 6) & 0x3
    const hasTransformLength =
      (tag === 'glyf' || tag === 'loca') && transformed === 0 ? true : transformed !== 0

    let length = originalLength

    if (hasTransformLength) {
      const [transformLength, afterTransform] = readBase128(file, cursor)
      cursor = afterTransform
      length = transformLength
    }

    directory.push({ tag, length })
  }

  const font = brotliDecompressSync(file.subarray(cursor))
  let position = 0

  for (const entry of directory) {
    if (entry.tag === wanted) return font.subarray(position, position + entry.length)
    position += entry.length
  }

  throw new Error(`woff2: no ${wanted} table`)
}

/**
 * Every codepoint a `cmap` subtable maps, from the first format 4 or format 12
 * table it carries. Both are the only formats these fonts use, and either one
 * on its own is the whole latin coverage.
 *
 * @param {Buffer} cmap
 * @returns {Set<number>}
 */
function codepointsOfCmap(cmap) {
  const numTables = cmap.readUInt16BE(2)
  /** @type {Set<number>} */
  const codepoints = new Set()

  for (let i = 0; i < numTables; i += 1) {
    const offset = cmap.readUInt32BE(4 + i * 8 + 4)
    const format = cmap.readUInt16BE(offset)

    if (format === 4) {
      const segCountX2 = cmap.readUInt16BE(offset + 6)
      const ends = offset + 14
      const starts = ends + segCountX2 + 2
      const deltas = starts + segCountX2
      const rangeOffsets = deltas + segCountX2

      for (let seg = 0; seg < segCountX2 / 2; seg += 1) {
        const end = cmap.readUInt16BE(ends + seg * 2)
        const start = cmap.readUInt16BE(starts + seg * 2)
        const delta = cmap.readInt16BE(deltas + seg * 2)
        const rangeOffset = cmap.readUInt16BE(rangeOffsets + seg * 2)

        if (start === 0xffff) continue

        for (let code = start; code <= end; code += 1) {
          let glyph

          if (rangeOffset === 0) {
            glyph = (code + delta) & 0xffff
          } else {
            const at = rangeOffsets + seg * 2 + rangeOffset + (code - start) * 2
            glyph = cmap.readUInt16BE(at)
            if (glyph !== 0) glyph = (glyph + delta) & 0xffff
          }

          if (glyph !== 0) codepoints.add(code)
        }
      }

      return codepoints
    }

    if (format === 12) {
      const numGroups = cmap.readUInt32BE(offset + 12)

      for (let group = 0; group < numGroups; group += 1) {
        const at = offset + 16 + group * 12
        const start = cmap.readUInt32BE(at)
        const end = cmap.readUInt32BE(at + 4)

        for (let code = start; code <= end; code += 1) codepoints.add(code)
      }

      return codepoints
    }
  }

  throw new Error('woff2: no format 4 or format 12 cmap subtable')
}

/**
 * Every codepoint the woff2 in `file` maps.
 *
 * @param {Buffer} file
 * @returns {Set<number>}
 */
export function coverageOf(file) {
  return codepointsOfCmap(tableOf(file, 'cmap'))
}
