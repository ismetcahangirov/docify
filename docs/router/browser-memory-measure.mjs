/**
 * The browser half of the measurement behind `MEMORY` in `lib/router/budget.ts`.
 *
 *   node docs/router/browser-memory-measure.mjs           every scenario
 *   node docs/router/browser-memory-measure.mjs canvas-*  a subset, by prefix
 *
 * `memory-measure.mjs` next to this file covers everything that runs in Node —
 * pdf-lib, fflate, pdf.js's parser. It cannot touch the three engines that are
 * browser APIs: `createImageBitmap`, `OffscreenCanvas` and libheif's WASM build
 * have no Node equivalent, which is why `MEMORY.canvas` and `MEMORY.heif` were
 * the only unmeasured entries left. This runs those in a real Chromium.
 *
 * ## How the number is obtained
 *
 * `performance.measureUserAgentSpecificMemory()` — the only API that reports
 * what a *renderer* is holding rather than what the JS heap is holding, which
 * matters here because a decoded `ImageBitmap` and a canvas backing store are
 * not on the JS heap at all. It performs a garbage collection before it
 * resolves, so a reading is of live memory rather than of garbage waiting to be
 * collected.
 *
 * Two launch conditions are not optional and are the reason this file starts a
 * server rather than opening a `file://` page:
 *
 * 1. **Cross-origin isolation.** The API is gated on it, so the page is served
 *    with `Cross-Origin-Opener-Policy: same-origin` and
 *    `Cross-Origin-Embedder-Policy: require-corp` — the same pair
 *    `next.config.ts` sets on `/convert/*`.
 * 2. **A process-isolated origin.** Chromium's old headless mode does not lock
 *    a renderer to a site, and the call fails with `SecurityError` there even
 *    when `crossOriginIsolated` is `true`. `channel: 'chromium'` selects the
 *    new headless, which does. Verified both ways: the old mode throws.
 *
 * ## Peak by construction, not by sampling
 *
 * The API is asynchronous and coarse in time, so it cannot chase a peak the way
 * `memory-measure.mjs`'s 1 ms sampler does. Instead each scenario is written to
 * *hold* every allocation of its worst moment — source bytes, decoded bitmap,
 * canvas, encoded output — and measures there. That is the same moment the
 * engine actually occupies, and it is reproducible, which a sampled peak in a
 * browser is not.
 *
 * Every scenario runs in its own page, in its own browser, so one scenario's
 * retention cannot inflate the next.
 *
 * ## What the images are
 *
 * Built here with the generator `memory-corpus.mjs` exports, not read off disk,
 * because the point being measured is that **decoded cost follows pixels and
 * not bytes**. The sweep therefore pairs images of identical dimensions whose
 * encoded sizes differ by two orders of magnitude: `noise` is incompressible,
 * `flat` compresses to almost nothing, and the whole question is which of the
 * two the memory follows.
 */

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { pngBytes } from './memory-corpus.mjs'

const MB = 1024 * 1024
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

/**
 * The libheif build the engine loads, served to the page verbatim.
 *
 * `lib/engines/heif-decode.ts` reaches for this exact file through
 * `await import()`, so measuring anything else would be measuring a different
 * decoder.
 */
const LIBHEIF = 'node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs'

/** The one HEIC in the repository. See the note in `report()`. */
const HEIC_FIXTURE = 'test/fixtures/colors-64.heic'

/**
 * The images each scenario decodes, and what they are for.
 *
 * `flat` and `noise` at 6.0 Mpx are the pair the whole exercise turns on: same
 * pixels, ~100x apart in bytes. The rest is a sweep in pixel count, so a
 * per-pixel cost can be read off the slope rather than off one point.
 */
const IMAGES = {
  'flat-1mpx': () => pngBytes(1000, 1000, 11, 0),
  'flat-2mpx': () => pngBytes(1500, 1333, 12, 0),
  'flat-6mpx': () => pngBytes(3000, 2000, 13, 0),
  'flat-12mpx': () => pngBytes(4000, 3000, 14, 0),
  'flat-24mpx': () => pngBytes(6000, 4000, 15, 0),
  'noise-6mpx': () => pngBytes(3000, 2000, 16, 1),
}

/**
 * What the page does, mirroring `lib/engines/canvas-runner.ts` step for step:
 * decode to a bitmap, draw it onto an `OffscreenCanvas`, re-encode.
 *
 * Runs in the browser. Written as a string rather than a function so that what
 * is measured is exactly what is read here — no bundler, no transpiler, no
 * closure over Node values.
 */
const CANVAS_SCENARIO = `async (name, format) => {
  const source = await (await fetch('/image/' + name)).blob()
  const bytes = { byteLength: source.size }
  const bitmap = await createImageBitmap(source)
  const width = bitmap.width
  const height = bitmap.height
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')

  context.drawImage(bitmap, 0, 0)
  const out = await canvas.convertToBlob({ type: format })

  // The peak: the source bytes, the decoded bitmap, the canvas behind it and
  // the encoded result are all live at once, which is the moment the engine
  // occupies too.
  const held = { source, bitmap, canvas, context, out }
  const measured = await measure()

  bitmap.close()
  void held

  return { measured, pixels: width * height, inputBytes: bytes.byteLength, outputBytes: out.size }
}`

/**
 * The libheif path, mirroring `lib/engines/heif-decode.ts`: instantiate the
 * module, decode, fill an RGBA buffer.
 */
const HEIF_SCENARIO = `async (name) => {
  const bytes = new Uint8Array(await (await fetch('/image/' + name)).arrayBuffer())
  const { default: createLibheif } = await import('/libheif-bundle.mjs')
  const module = await createLibheif()
  const images = new module.HeifDecoder().decode(bytes)
  const image = images[0]
  const width = image.get_width()
  const height = image.get_height()
  const rgba = new ImageData(width, height)

  await new Promise((resolve, reject) => {
    image.display({ data: rgba.data, width, height }, (out) =>
      out === null ? reject(new Error('libheif returned no bitmap')) : resolve(out),
    )
  })

  const held = { module, images, image, rgba }
  const measured = await measure()
  void held

  return { measured, pixels: width * height, inputBytes: bytes.byteLength, outputBytes: 0 }
}`

/**
 * libheif instantiated and nothing decoded.
 *
 * The one number the byte-multiple model cannot express at all: a WASM heap is
 * allocated before the first pixel is looked at, and it is the same size for a
 * 500-byte thumbnail as for a 48 megapixel photograph.
 */
const HEIF_MODULE_SCENARIO = `async () => {
  const { default: createLibheif } = await import('/libheif-bundle.mjs')
  const module = await createLibheif()

  const held = { module }
  const measured = await measure()
  void held

  return { measured, pixels: 0, inputBytes: 0, outputBytes: 0 }
}`

/**
 * The measurement helper installed on every page.
 *
 * The baseline is taken *after* the page has settled, and the scenario's number
 * is the difference — so what is reported is the job's cost rather than
 * Chromium's own floor, which is what the `MEMORY` factors are added on top of.
 */
const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>docify memory harness</title>
<script type="module">
  let baseline = 0

  globalThis.measure = async () => {
    const { bytes } = await performance.measureUserAgentSpecificMemory()

    return bytes - baseline
  }

  globalThis.settle = async () => {
    // Two readings: the first one triggers the collection, the second reports
    // what survived it.
    await performance.measureUserAgentSpecificMemory()
    baseline = (await performance.measureUserAgentSpecificMemory()).bytes

    return baseline
  }

  globalThis.ready = true
</script>`

/** Serves the page, the libheif build and nothing else, cross-origin isolated. */
function startServer() {
  const isolated = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
  }

  const images = {
    ...Object.fromEntries(Object.entries(IMAGES).map(([name, build]) => [name, build()])),
    heic: readFileSync(join(repoRoot, HEIC_FIXTURE)),
  }

  const server = createServer((request, response) => {
    const image = request.url?.startsWith('/image/') ? images[request.url.slice(7)] : undefined

    if (image !== undefined) {
      response.writeHead(200, { ...isolated, 'content-type': 'image/png' })
      response.end(image)
      return
    }

    if (request.url === '/libheif-bundle.mjs') {
      response.writeHead(200, { ...isolated, 'content-type': 'text/javascript' })
      response.end(readFileSync(join(repoRoot, LIBHEIF)))
      return
    }

    if (request.url?.endsWith('.wasm')) {
      const name = request.url.slice(1)
      response.writeHead(200, { ...isolated, 'content-type': 'application/wasm' })
      response.end(readFileSync(join(repoRoot, 'node_modules/libheif-js/libheif-wasm', name)))
      return
    }

    response.writeHead(200, { ...isolated, 'content-type': 'text/html' })
    response.end(PAGE)
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }),
    )
  })
}

/** One scenario, in its own browser. */
async function run(url, { body, argument }) {
  const browser = await chromium.launch({ channel: 'chromium' })

  try {
    const page = await browser.newPage()
    await page.goto(url)
    await page.waitForFunction('globalThis.ready === true')
    await page.evaluate('globalThis.settle()')

    return await page.evaluate(([source, ...extra]) => eval(source)(...extra), [body, ...argument])
  } finally {
    await browser.close()
  }
}

function scenarios() {
  const canvas = Object.keys(IMAGES).flatMap((name) => [
    [`canvas-${name}-png`, { body: CANVAS_SCENARIO, argument: [name, 'image/png'] }],
    [`canvas-${name}-jpeg`, { body: CANVAS_SCENARIO, argument: [name, 'image/jpeg'] }],
  ])

  return Object.fromEntries([
    ...canvas,
    ['heif-module-only', { body: HEIF_MODULE_SCENARIO, argument: [] }],
    ['heif-fixture-64', { body: HEIF_SCENARIO, argument: ['heic'] }],
  ])
}

/**
 * The table, with the two columns the argument is about side by side.
 *
 * `peak/in` is what `MEMORY` currently models — a multiple of the encoded size.
 * `peak/px` is what the engine actually spends. A model is only honest if the
 * column it is fitted to is the one that stays still.
 */
function report(rows) {
  const mb = (bytes) => (bytes / MB).toFixed(1)

  console.log(['scenario', 'in MB', 'Mpx', 'peak MB', 'peak/in', 'peak B/px'].join('\t'))

  for (const row of rows) {
    if (row.failed !== undefined) {
      console.log([row.scenario, 'FAILED', row.failed].join('\t'))
      continue
    }

    console.log(
      [
        row.scenario,
        mb(row.inputBytes),
        (row.pixels / 1e6).toFixed(1),
        mb(row.measured),
        (row.measured / row.inputBytes).toFixed(1),
        (row.measured / row.pixels).toFixed(2),
      ].join('\t'),
    )
  }

  console.log(`\n${JSON.stringify(rows, null, 2)}`)
}

// --------------------------------------------------------------------- entry

const prefix = process.argv[2] ?? ''
const { server, url } = await startServer()
const rows = []

for (const [scenario, spec] of Object.entries(scenarios())) {
  if (!scenario.startsWith(prefix.replace(/\*$/, ''))) continue

  try {
    rows.push({ scenario, ...(await run(url, spec)) })
    console.error(`. ${scenario}`)
  } catch (error) {
    // One scenario that runs the renderer out of memory must not cost the rest.
    rows.push({ scenario, failed: String(error).split('\n')[0].slice(0, 120) })
    console.error(`x ${scenario}`)
  }
}

server.close()
report(rows)
