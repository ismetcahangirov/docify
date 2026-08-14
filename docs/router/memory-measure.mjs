/**
 * The measurement behind `MEMORY` in `lib/router/budget.ts`.
 *
 *   node docs/router/memory-measure.mjs <corpusDir>            every scenario
 *   node --expose-gc docs/router/memory-measure.mjs <dir> <s>  just one
 *
 * Build the corpus first with `memory-corpus.mjs`. Every scenario runs in its
 * own child process, so a leak in one cannot inflate the next, and a scenario
 * that throws is recorded as a failed row rather than aborting the sweep.
 *
 * Node only, which is the limit of what this can say. pdf-lib and fflate run
 * here unchanged; canvas, wasm-vips and libheif are browser APIs with no Node
 * equivalent, and pdf.js can be parsed but not rendered without a canvas.
 * `memory-budget-measurement.md` is where that gets spelled out.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { zipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'

const MB = 1024 * 1024

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

/**
 * Mirrors `lib/engines/pdf-from-images.ts`.
 *
 * Also counts the *decoded* pixels, which is the axis the input bytes cannot
 * predict and the one `lib/engines/raster-limits.ts` bounds. Only the PNGs are
 * counted: `embedJpg` reads SOF0 and copies the bytes into a `DCTDecode` stream
 * without ever decoding them, so a JPEG's pixels cost nothing here — which is
 * why `images-jpg-24` carries 288 Mpx and peaks at 1.7× its bytes.
 */
async function imagesScenario(paths) {
  const inputBytes = paths.reduce((sum, path) => sum + readFileSync(path).length, 0)

  const result = await withPeak(async (sample) => {
    const doc = await PDFDocument.create()
    let decodedPixels = 0

    for (const path of paths) {
      const bytes = readFileSync(path)
      const png = path.endsWith('.png')
      const image = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
      const page = doc.addPage([image.width, image.height])

      if (png) decodedPixels += image.width * image.height
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
      sample()
    }

    const out = await doc.save()
    sample()

    return { outputBytes: out.length, decodedPixels }
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

/**
 * The archive path, which every multi-output engine ends in and which the `zip`
 * engine will be made of: `fflate` builds the whole archive in memory from every
 * member at once, which is what `holds: 'all-at-once'` claims about it.
 */
async function archiveScenario(paths) {
  const inputBytes = paths.reduce((sum, path) => sum + readFileSync(path).length, 0)

  const result = await withPeak(async (sample) => {
    const entries = {}

    for (const path of paths) {
      entries[basename(path)] = new Uint8Array(readFileSync(path))
      sample()
    }

    const packed = zipSync(entries, { level: 0 })
    sample()

    return { outputBytes: packed.length }
  })

  return { inputBytes, fileCount: paths.length, ...result }
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
    // The pixel sweep behind `PDFLIB_DECODED_BYTES_PER_PIXEL` in
    // `lib/engines/raster-limits.ts`: the same image at four job sizes, so the
    // per-pixel cost can be read off the slope rather than off one point.
    'images-flat-png-1': () => imagesScenario(files('flat-', '.png').slice(0, 1)),
    'images-flat-png-3': () => imagesScenario(files('flat-', '.png').slice(0, 3)),
    'images-flat-png-6': () => imagesScenario(files('flat-', '.png').slice(0, 6)),
    'images-flat-png-24': () => imagesScenario(cycle(files('flat-', '.png'), 24)),
    'images-mixed-36': () =>
      imagesScenario([...files('photo-', '.jpg'), ...files('shot-', '.png')]),
    'organize-scan-large': () => organizeScenario(join(corpusDir, 'scan-large.pdf')),
    'organize-vector-large': () => organizeScenario(join(corpusDir, 'vector-large.pdf')),
    'split-scan-large': () => splitScenario(join(corpusDir, 'scan-large.pdf')),
    'split-vector-large': () => splitScenario(join(corpusDir, 'vector-large.pdf')),
    'pdfjs-scan-large': () => pdfjsScenario(join(corpusDir, 'scan-large.pdf')),
    'pdfjs-vector-large': () => pdfjsScenario(join(corpusDir, 'vector-large.pdf')),
    'pdfjs-vector-small': () => pdfjsScenario(join(corpusDir, 'vector-000.pdf')),
    'archive-scan-30': () => archiveScenario(files('scan-0', '.pdf')),
    'archive-vector-30': () => archiveScenario(files('vector-0', '.pdf')),
  }
}

/** Runs every scenario, each in its own process, and prints the table. */
function runAll(corpusDir) {
  const self = fileURLToPath(import.meta.url)
  const rows = []

  for (const scenario of Object.keys(scenariosFor(corpusDir))) {
    try {
      const out = execFileSync(
        process.execPath,
        ['--expose-gc', '--max-old-space-size=4096', self, corpusDir, scenario],
        { encoding: 'utf8', maxBuffer: 64 * MB },
      )

      rows.push(JSON.parse(out.trim().split('\n').at(-1)))
      console.error(`. ${scenario}`)
    } catch (error) {
      // One scenario that runs out of heap must not cost the other sixteen.
      rows.push({ scenario, failed: String(error).split('\n')[0] })
      console.error(`x ${scenario}`)
    }
  }

  print(rows)
}

/**
 * The table, with the column the factors were actually set from.
 *
 * `peak+blob` adds the output bytes back on, because `EngineRunner.run` answers
 * with a `Blob` and constructing one copies the buffer — an allocation Node
 * never makes and the browser always does. Scenarios that produce no file, like
 * the pdf.js ones, leave it blank rather than repeating `peak`.
 */
function print(rows) {
  const mb = (bytes) => (bytes / MB).toFixed(1)
  const ratio = (peak, input) => (peak / input).toFixed(2)

  console.log(
    [
      'scenario',
      'files',
      'in MB',
      'peak MB',
      'peak/in',
      'peak+blob/in',
      'Mpx',
      'peak+blob/px',
    ].join('\t'),
  )

  for (const row of rows) {
    if (row.failed !== undefined) {
      console.log([row.scenario, 'FAILED', row.failed].join('\t'))
      continue
    }

    const withBlob = row.outputBytes === undefined ? undefined : row.peakLiveBytes + row.outputBytes

    console.log(
      [
        row.scenario,
        row.fileCount,
        mb(row.inputBytes),
        mb(row.peakLiveBytes),
        ratio(row.peakLiveBytes, row.inputBytes),
        withBlob === undefined ? '' : ratio(withBlob, row.inputBytes),
        row.decodedPixels ? (row.decodedPixels / 1e6).toFixed(1) : '',
        row.decodedPixels && withBlob !== undefined ? ratio(withBlob, row.decodedPixels) : '',
      ].join('\t'),
    )
  }

  console.log(`\n${JSON.stringify(rows, null, 2)}`)
}

// --------------------------------------------------------------------- entry

const [corpusDir, scenario] = process.argv.slice(2)

if (corpusDir === undefined) {
  console.error('usage: memory-measure.mjs <corpusDir> [scenario]')
  process.exit(1)
} else if (scenario === undefined) {
  runAll(corpusDir)
} else if (typeof globalThis.gc !== 'function') {
  console.error('Run a single scenario with `node --expose-gc`, or omit it to run them all.')
  process.exit(1)
} else {
  const run = scenariosFor(corpusDir)[scenario]

  if (run === undefined) {
    console.error(`unknown scenario: ${scenario}`)
    process.exit(1)
  }

  console.log(JSON.stringify({ scenario, ...(await run()) }))
}
