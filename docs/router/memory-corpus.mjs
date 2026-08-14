/**
 * The corpus behind the numbers in `docs/router/memory-budget-measurement.md`.
 *
 *   node docs/router/memory-corpus.mjs <dir>
 *
 * Writes 110 PDFs and images built from a seeded PRNG, so two people on two
 * machines get the same sizes down to the byte. Nothing is committed: 700 MB of
 * synthetic documents in git would be worse than a script that rebuilds them.
 *
 * Lives under `docs/` and not under `scripts/` on purpose — this is not part of
 * the build, it is the evidence for a table of constants. `memory-measure.mjs`
 * next to it is what reads the result.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { zlibSync } from 'fflate'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/** Mulberry32 — a seeded PRNG, so every run produces the same corpus. */
function rng(seed) {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, body) {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)

  view.setUint32(0, body.length)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))

  return out
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0

  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }

  return out
}

/**
 * A real 8-bit truecolour PNG.
 *
 * `noise: 1` is incompressible grain — what a photograph re-saved as PNG behaves
 * like. `noise: 0` is a smooth ramp that compresses a hundred to one, which is
 * what a screenshot or an export from a design tool behaves like. The pair is
 * the point: both decode to exactly `width × height × 4` bytes.
 */
function pngBytes(width, height, seed, noise = 1) {
  const random = rng(seed)
  const stride = 1 + width * 3
  const raw = new Uint8Array(height * stride)

  for (let row = 0; row < height; row += 1) {
    raw[row * stride] = 0 // filter byte: none
    for (let x = 1; x < stride; x += 1) {
      const smooth = ((row * 7 + x) >> 4) & 0xff
      raw[row * stride + x] = (smooth * (1 - noise) + random() * 256 * noise) | 0
    }
  }

  const header = new Uint8Array(13)
  const fields = new DataView(header.buffer)

  fields.setUint32(0, width)
  fields.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour

  return concat(
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  )
}

/**
 * A JPEG with a valid frame header, padded to `targetBytes` with seeded filler.
 *
 * pdf-lib never runs a Huffman decoder: it scans to SOF0 for the dimensions and
 * the colour space, then copies the bytes verbatim into a `DCTDecode` stream. Its
 * memory behaviour depends on the byte length and on nothing else, which is what
 * the padding reproduces. Do not point pdf.js at these — it decodes for real.
 */
function jpegBytes(width, height, targetBytes, seed) {
  const random = rng(seed)
  const frame = new Uint8Array(15)

  frame[0] = 8 // sample precision
  frame[1] = height >> 8
  frame[2] = height & 0xff
  frame[3] = width >> 8
  frame[4] = width & 0xff
  frame[5] = 3 // three components: DeviceRGB

  for (let component = 0; component < 3; component += 1) {
    frame[6 + component * 3] = component + 1
    frame[7 + component * 3] = 0x11
    frame[8 + component * 3] = 0
  }

  const head = concat(
    Uint8Array.of(0xff, 0xd8),
    Uint8Array.of(0xff, 0xc0, 0x00, 0x11),
    frame,
    Uint8Array.of(0xff, 0xdd, 0x00, 0x04, 0x00, 0x00),
  )
  const padding = new Uint8Array(Math.max(0, targetBytes - head.length - 2))

  // 0xFF would read as a marker; keep the filler below it.
  for (let i = 0; i < padding.length; i += 1) padding[i] = (random() * 240) | 0

  return concat(head, padding, Uint8Array.of(0xff, 0xd9))
}

/** A text-only PDF: `pages` pages of Helvetica, no images at all. */
async function vectorPdf(pages, seed) {
  const random = rng(seed)
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)

  for (let page = 0; page < pages; page += 1) {
    const sheet = doc.addPage([612, 792])

    for (let line = 0; line < 45; line += 1) {
      sheet.drawText(
        `page ${page + 1} line ${line + 1} ${Math.floor(random() * 1e12).toString(36)}`,
        { x: 54, y: 738 - line * 16, size: 11, font },
      )
    }
  }

  return doc.save()
}

/**
 * A scan: one full-page 150 dpi bitmap per page.
 *
 * The image is a real PNG rather than a padded JPEG so that pdf.js can decode
 * it. A padded JPEG parses and then fails to decode, which silently removes the
 * largest allocation a renderer makes on a scanned page.
 */
async function scannedPdf(pages, seed) {
  const doc = await PDFDocument.create()

  for (let page = 0; page < pages; page += 1) {
    const image = await doc.embedPng(pngBytes(1224, 1584, seed + page, 0.02))
    const sheet = doc.addPage([612, 792])

    sheet.drawImage(image, { x: 0, y: 0, width: 612, height: 792 })
  }

  return doc.save()
}

async function buildCorpus(outDir) {
  mkdirSync(outDir, { recursive: true })
  const manifest = []

  const emit = (name, bytes) => {
    writeFileSync(join(outDir, name), bytes)
    manifest.push({ name, bytes: bytes.length })
  }

  // Reports and invoices: small files, large object graphs.
  for (let i = 0; i < 30; i += 1) {
    emit(`vector-${String(i).padStart(3, '0')}.pdf`, await vectorPdf(8, 1000 + i))
  }

  // Photographed paperwork: what a hundred-file merge is actually made of.
  for (let i = 0; i < 30; i += 1) {
    emit(`scan-${String(i).padStart(3, '0')}.pdf`, await scannedPdf(4, 5000 + i * 10))
  }

  // One large document of each kind, for the single-document operations.
  emit('scan-large.pdf', await scannedPdf(20, 90_000))
  emit('vector-large.pdf', await vectorPdf(200, 91_000))

  // Loose images, for the images-to-PDF direction.
  for (let i = 0; i < 24; i += 1) {
    emit(`photo-${String(i).padStart(3, '0')}.jpg`, jpegBytes(4000, 3000, 2_400_000, 7000 + i))
  }
  for (let i = 0; i < 12; i += 1) {
    emit(`shot-${String(i).padStart(3, '0')}.png`, pngBytes(1500, 2000, 8000 + i))
  }
  for (let i = 0; i < 12; i += 1) {
    emit(`flat-${String(i).padStart(3, '0')}.png`, pngBytes(1500, 2000, 8500 + i, 0))
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`${manifest.length} files, ${manifest.reduce((sum, f) => sum + f.bytes, 0)} bytes`)
}

const outDir = process.argv[2]

if (outDir === undefined) {
  console.error('usage: memory-corpus.mjs <dir>')
  process.exit(1)
}

await buildCorpus(outDir)
