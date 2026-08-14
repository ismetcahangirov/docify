/**
 * The harness behind `MEMORY` in `lib/router/budget.ts`.
 *
 * Two commands, and both of them are meant to be re-run rather than trusted:
 *
 *   node docs/router/memory-budget.mjs corpus <dir>
 *   node docs/router/memory-budget.mjs measure <dir> [scenario]
 *
 * `corpus` writes a deterministic set of PDFs and images; `measure` runs one
 * scenario per child process and prints a table. Both live under `docs/` and not
 * under `scripts/` on purpose: this is not part of the build, it is the evidence
 * for a set of numbers, and it should be read alongside
 * `docs/router/memory-budget-measurement.md`.
 *
 * Node only. The engines that need a browser — canvas, wasm-vips, libheif — are
 * out of reach here, and the document explains what that leaves unmeasured.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { zlibSync } from 'fflate'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const MB = 1024 * 1024

// ---------------------------------------------------------------- the corpus

/** Mulberry32 — a seeded PRNG, so every run produces byte-identical inputs. */
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

// ----------------------------------------------------------- the measurement

/**
 * Peak of `heapUsed + external` and of RSS while `body` runs.
 *
 * Sampled on a 1 ms interval *and* at every point the scenario chooses, because
 * an interval alone cannot see inside a synchronous call. Every scenario yields
 * at least once per file, which is where the peaks are.
 */
async function withPeak(body) {
  globalThis.gc()
  const base = process.memoryUsage()
  let peakLive = 0
  let peakRss = 0

  const sample = () => {
    const now = process.memoryUsage()
    peakLive = Math.max(peakLive, now.heapUsed + now.external - base.heapUsed - base.external)
    peakRss = Math.max(peakRss, now.rss - base.rss)
  }

  const ticker = setInterval(sample, 1)
  sample()
  const outcome = await body(sample)
  sample()
  clearInterval(ticker)

  globalThis.gc()
  const after = process.memoryUsage()

  return {
    peakLiveBytes: peakLive,
    peakRssBytes: peakRss,
    retainedBytes: after.heapUsed + after.external - base.heapUsed - base.external,
    ...outcome,
  }
}

/** Mirrors `lib/engines/pdf-merge.ts`: one source open at a time, pages copied out. */
async function mergeScenario(paths) {
  const inputBytes = paths.reduce((sum, path) => sum + readFileSync(path).length, 0)

  const result = await withPeak(async (sample) => {
    const merged = await PDFDocument.create()

    for (const path of paths) {
      const source = await PDFDocument.load(readFileSync(path), { updateMetadata: false })
      const pages = await merged.copyPages(source, source.getPageIndices())

      for (const page of pages) merged.addPage(page)
      sample()
    }

    const out = await merged.save()
    sample()

    return { outputBytes: out.length }
  })

  return { inputBytes, fileCount: paths.length, ...result }
}

/** Mirrors `lib/engines/pdf-from-images.ts`. */
async function imagesScenario(paths) {
  const inputBytes = paths.reduce((sum, path) => sum + readFileSync(path).length, 0)

  const result = await withPeak(async (sample) => {
    const doc = await PDFDocument.create()

    for (const path of paths) {
      const bytes = readFileSync(path)
      const image = path.endsWith('.png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
      const page = doc.addPage([image.width, image.height])

      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
      sample()
    }

    const out = await doc.save()
    sample()

    return { outputBytes: out.length }
  })

  return { inputBytes, fileCount: paths.length, ...result }
}

/** Mirrors `lib/engines/pdf-organize.ts`: one document in, one reordered document out. */
async function organizeScenario(path) {
  const inputBytes = readFileSync(path).length

  const result = await withPeak(async (sample) => {
    const source = await PDFDocument.load(readFileSync(path), { updateMetadata: false })
    const out = await PDFDocument.create()
    const pages = await out.copyPages(source, source.getPageIndices().reverse())

    for (const page of pages) out.addPage(page)
    sample()

    return { outputBytes: (await out.save()).length }
  })

  return { inputBytes, fileCount: 1, ...result }
}

/** Mirrors `lib/engines/pdf-split.ts`: one document per page, then one archive. */
async function splitScenario(path) {
  const inputBytes = readFileSync(path).length

  const result = await withPeak(async (sample) => {
    const source = await PDFDocument.load(readFileSync(path), { updateMetadata: false })
    const parts = []

    for (const index of source.getPageIndices()) {
      const single = await PDFDocument.create()
      const [page] = await single.copyPages(source, [index])

      single.addPage(page)
      parts.push(await single.save())
      sample()
    }

    const { zipSync } = await import('fflate')
    const packed = zipSync(
      Object.fromEntries(parts.map((bytes, index) => [`page-${index}.pdf`, bytes])),
      { level: 0 },
    )
    sample()

    return { outputBytes: packed.length }
  })

  return { inputBytes, fileCount: 1, ...result }
}

/**
 * Everything `lib/engines/pdf-render.ts` does short of touching pixels: open the
 * document, walk every page, parse each content stream into drawing operations.
 *
 * The canvas itself cannot be allocated here, so the widest page is reported in
 * pixels instead and the RGBA cost is arithmetic in the document.
 */
async function pdfjsScenario(path) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const inputBytes = readFileSync(path).length

  const result = await withPeak(async (sample) => {
    const task = pdfjs.getDocument({
      data: new Uint8Array(readFileSync(path)),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    })
    const doc = await task.promise
    let widest = 0

    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number)
      const viewport = page.getViewport({ scale: 150 / 72 })

      widest = Math.max(widest, Math.round(viewport.width) * Math.round(viewport.height))
      await page.getOperatorList()
      page.cleanup()
      sample()
    }

    const pageCount = doc.numPages
    await task.destroy()

    return { pageCount, widestPagePixels: widest }
  })

  return { inputBytes, fileCount: 1, ...result }
}

function scenariosFor(corpusDir) {
  const files = (prefix, extension) =>
    readdirSync(corpusDir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(extension))
      .sort()
      .map((name) => join(corpusDir, name))

  const cycle = (paths, count) =>
    Array.from({ length: count }, (_, index) => paths[index % paths.length])

  return {
    'merge-vector-30': () => mergeScenario(files('vector-0', '.pdf')),
    'merge-scan-30': () => mergeScenario(files('scan-0', '.pdf')),
    'merge-mixed-60': () =>
      mergeScenario([...files('vector-0', '.pdf'), ...files('scan-0', '.pdf')]),
    'merge-vector-100': () => mergeScenario(cycle(files('vector-0', '.pdf'), 100)),
    'images-jpg-24': () => imagesScenario(files('photo-', '.jpg')),
    'images-png-12': () => imagesScenario(files('shot-', '.png')),
    'images-flat-png-12': () => imagesScenario(files('flat-', '.png')),
    'images-mixed-36': () =>
      imagesScenario([...files('photo-', '.jpg'), ...files('shot-', '.png')]),
    'organize-scan-large': () => organizeScenario(join(corpusDir, 'scan-large.pdf')),
    'organize-vector-large': () => organizeScenario(join(corpusDir, 'vector-large.pdf')),
    'split-scan-large': () => splitScenario(join(corpusDir, 'scan-large.pdf')),
    'split-vector-large': () => splitScenario(join(corpusDir, 'vector-large.pdf')),
    'pdfjs-scan-large': () => pdfjsScenario(join(corpusDir, 'scan-large.pdf')),
    'pdfjs-vector-large': () => pdfjsScenario(join(corpusDir, 'vector-large.pdf')),
    'pdfjs-vector-small': () => pdfjsScenario(join(corpusDir, 'vector-000.pdf')),
  }
}

/** Runs every scenario, each in its own process, and prints the table. */
function runAll(corpusDir) {
  const self = fileURLToPath(import.meta.url)
  const rows = []

  for (const scenario of Object.keys(scenariosFor(corpusDir))) {
    const out = execFileSync(
      process.execPath,
      ['--expose-gc', '--max-old-space-size=4096', self, 'measure', corpusDir, scenario],
      { encoding: 'utf8', maxBuffer: 64 * MB },
    )

    rows.push(JSON.parse(out.trim().split('\n').at(-1)))
    console.error(`. ${scenario}`)
  }

  const mb = (bytes) => (bytes / MB).toFixed(1)

  console.log(['scenario', 'files', 'in MB', 'peak MB', 'peak/in'].join('\t'))
  for (const row of rows) {
    console.log(
      [
        row.scenario,
        row.fileCount,
        mb(row.inputBytes),
        mb(row.peakLiveBytes),
        (row.peakLiveBytes / row.inputBytes).toFixed(2),
      ].join('\t'),
    )
  }

  console.log(`\n${JSON.stringify(rows, null, 2)}`)
}

// --------------------------------------------------------------------- entry

const [command, corpusDir, scenario] = process.argv.slice(2)

if (command === 'corpus') {
  await buildCorpus(corpusDir)
} else if (command === 'measure' && scenario === undefined) {
  runAll(corpusDir)
} else if (command === 'measure') {
  if (typeof globalThis.gc !== 'function') {
    console.error('Run a single scenario with `node --expose-gc`, or omit it to run them all.')
    process.exit(1)
  }

  const run = scenariosFor(corpusDir)[scenario]

  if (run === undefined) {
    console.error(`unknown scenario: ${scenario}`)
    process.exit(1)
  }

  console.log(JSON.stringify({ scenario, ...(await run()) }))
} else {
  console.error('usage: memory-budget.mjs corpus <dir> | measure <dir> [scenario]')
  process.exit(1)
}
