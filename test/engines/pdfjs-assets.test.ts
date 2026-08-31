// @vitest-environment node

/**
 * The self-hosting contract for pdf.js' optional data files.
 *
 * pdf.js renders a document with or without its cMaps, standard fonts, ICC
 * profile and WASM decoders — which is exactly the problem. A page set in
 * non-embedded Helvetica still appears; it is simply drawn in a substitute face,
 * and nobody who has not seen the source document can tell. So the assertion
 * that matters here is not "the render succeeded" but "the font pdf.js loaded
 * came from our own origin", and `missingFile` is pdf.js' own name for the
 * difference.
 *
 * Every byte is served from Docify's origin: CLAUDE.md §3 forbids CDN requests,
 * and `Cross-Origin-Embedder-Policy: require-corp` would block them anyway.
 */

import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  type PdfAssetUrls,
  PDFJS_ASSET_PATH,
  PDFJS_CMAP_PATH,
  PDFJS_ICC_PATH,
  PDFJS_STANDARD_FONT_PATH,
  PDFJS_WASM_PATH,
  pdfjsAssetUrls,
} from '@/lib/engines/pdfjs-assets'
import { loadPdfDocument } from '@/lib/engines/pdfjs-runtime'
import {
  PDFJS_ASSET_DIRS,
  PDFJS_REQUIRED_FILES,
  PDFJS_WASM_FILES,
  pdfjsAssetFiles,
  pdfjsPackageDir,
  vendorPdfjs,
} from '@/scripts/vendor-pdfjs/vendor.mjs'

import { PDF_SUITE_TIMEOUT_MS } from '../support/timeouts'

// Real documents, real parsing: see the module this number lives in.
vi.setConfig({ testTimeout: PDF_SUITE_TIMEOUT_MS })

const ORIGIN = 'https://docify.app'

/**
 * What the guard refuses a base with — returned rather than matched, so two
 * refusals can be compared for being the same message and not merely both loud.
 */
const rejectionFor = (base: string): string => {
  try {
    pdfjsAssetUrls(base)
  } catch (error) {
    return (error as Error).message
  }

  throw new Error(`pdfjsAssetUrls(${JSON.stringify(base)}) resolved a base it cannot resolve`)
}

/** What pdf.js hands back for a font once its operator list is built. */
interface LoadedFont {
  /** pdf.js' own flag: true when it had to invent a face rather than load one. */
  readonly missingFile: boolean
  readonly name: string
}

interface OperatorList {
  readonly fnArray: readonly number[]
  readonly argsArray: readonly unknown[][]
}

/** The two members of a pdf.js page this test reads and the engine does not. */
interface InspectablePage {
  getOperatorList(): Promise<OperatorList>
  commonObjs: { get(id: string): LoadedFont }
  cleanup(): boolean
}

/** A one-page document whose only text is set in non-embedded Helvetica. */
async function standard14Fixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const page = document.addPage([612, 792])
  const font = await document.embedFont(StandardFonts.Helvetica)

  page.drawText('Hamburgefonstiv', { x: 72, y: 700, size: 24, font })

  return document.save()
}

/**
 * Serves the vendored tree from disk, recording every path pdf.js asks for.
 *
 * The recording is the point. pdf.js swallows a failed asset fetch and carries
 * on, so a request that went somewhere else would not fail here on its own —
 * what catches that is asserting on what was asked for afterwards.
 */
function serveVendoredAssets(directory: string): string[] {
  const requested: string[] = []

  vi.stubGlobal('fetch', async (input: unknown): Promise<Response> => {
    const url = new URL(String(input))
    requested.push(url.pathname)

    if (!url.pathname.startsWith(PDFJS_ASSET_PATH)) {
      throw new Error(`pdf.js fetched something that is not vendored: ${url.href}`)
    }

    const file = join(directory, url.pathname.slice(PDFJS_ASSET_PATH.length))

    return new Response(await readFile(file))
  })

  return requested
}

/** The face pdf.js settled on for the first font the page draws with. */
async function firstFontOf(data: Uint8Array, assets?: PdfAssetUrls): Promise<LoadedFont> {
  const loading = await loadPdfDocument(data, assets)

  try {
    const page = (await (await loading.promise).getPage(1)) as unknown as InspectablePage
    const { fnArray, argsArray } = await page.getOperatorList()
    const index = fnArray.indexOf(OPS.setFont)

    expect(index).toBeGreaterThanOrEqual(0)

    const font = page.commonObjs.get(String(argsArray[index][0]))
    page.cleanup()

    return font
  } finally {
    await loading.destroy()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('where pdf.js fetches its optional data from', () => {
  it('resolves to this origin, never a CDN', () => {
    expect(pdfjsAssetUrls(ORIGIN)).toEqual({
      cMapUrl: `${ORIGIN}/vendor/pdfjs/cmaps/`,
      standardFontDataUrl: `${ORIGIN}/vendor/pdfjs/standard_fonts/`,
      iccUrl: `${ORIGIN}/vendor/pdfjs/iccs/`,
      wasmUrl: `${ORIGIN}/vendor/pdfjs/wasm/`,
    })
  })

  it('is rooted at the origin, so a nested route resolves it identically', () => {
    expect(pdfjsAssetUrls(`${ORIGIN}/convert/pdf-to-jpg`)).toEqual(pdfjsAssetUrls(`${ORIGIN}/`))
  })

  it('ends every URL with a slash, because pdf.js appends the filename raw', () => {
    for (const url of Object.values(pdfjsAssetUrls(ORIGIN))) expect(url.endsWith('/')).toBe(true)
  })

  it('names the tree it could not resolve when there is no origin at all', () => {
    // Server rendering, or a test without a location. `new URL()` would throw
    // about an invalid base, which points nowhere useful.
    expect(rejectionFor('')).toContain(PDFJS_ASSET_PATH)
  })

  it('says the same when the origin is opaque, which serialises to "null"', () => {
    // A sandboxed iframe, a data: document, a file:// page. The string is not
    // empty, so an emptiness check waves it through and `new URL(path, 'null')`
    // throws `Invalid URL` — the failure this guard exists to replace.
    expect(rejectionFor('null')).toBe(rejectionFor(''))
  })
})

describe('the vendored tree', () => {
  it('serves exactly the directories the vendor script writes', () => {
    expect(new Set(PDFJS_ASSET_DIRS.map((dir) => `${PDFJS_ASSET_PATH}${dir}/`))).toEqual(
      new Set([PDFJS_CMAP_PATH, PDFJS_STANDARD_FONT_PATH, PDFJS_ICC_PATH, PDFJS_WASM_PATH]),
    )
  })

  it('names directories that exist in the installed package', () => {
    for (const dir of PDFJS_ASSET_DIRS) {
      expect(statSync(join(pdfjsPackageDir(), dir)).isDirectory()).toBe(true)
    }
  })

  it('watches a real file in each directory, so an empty one cannot pass', () => {
    // Three of the four are copied whole. The canary is what turns "pdfjs-dist
    // moved its data" into a failed build rather than a silent 0 MB copy — and
    // it only works while the file it names is one the package still ships.
    for (const [dir, file] of Object.entries(PDFJS_REQUIRED_FILES)) {
      expect(pdfjsAssetFiles(dir)).toContain(file)
    }
  })

  it('leaves out the payloads no Docify conversion reaches', () => {
    // PDF-embedded JavaScript is never executed here, and the no-WASM fallbacks
    // are 600 kB of code for engines that cannot run this app at all.
    expect(PDFJS_WASM_FILES).not.toContain('quickjs-eval.wasm')
    expect(PDFJS_WASM_FILES).not.toContain('openjpeg_nowasm_fallback.js')
    expect(PDFJS_WASM_FILES).not.toContain('jbig2_nowasm_fallback.js')
  })

  it('copies the decoders a PDF can actually need', () => {
    expect(PDFJS_WASM_FILES).toContain('openjpeg.wasm')
    expect(PDFJS_WASM_FILES).toContain('jbig2.wasm')
    expect(PDFJS_WASM_FILES).toContain('qcms_bg.wasm')
  })
})

describe('a standard-14 font, on a document built here', () => {
  const vendored = mkdtempSync(join(tmpdir(), 'docify-pdfjs-'))

  beforeAll(() => {
    vendorPdfjs(vendored)
  })

  afterAll(() => {
    rmSync(vendored, { recursive: true, force: true })
  })

  it('draws the real face, fetched from our own origin', async () => {
    const requested = serveVendoredAssets(vendored)
    const font = await firstFontOf(await standard14Fixture(), pdfjsAssetUrls(ORIGIN))

    expect(font.missingFile).toBe(false)
    expect(font.name).toBe('Helvetica')
    expect(requested).toContain('/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf')
    expect(requested.every((path) => path.startsWith(PDFJS_ASSET_PATH))).toBe(true)
  })

  it('finds the tree on its own, from nothing but the origin', async () => {
    // What production does: `pdf-render.ts` calls `loadPdfDocument` with the
    // document and nothing else, and the default has to reach the same files.
    vi.stubGlobal('location', { origin: ORIGIN })

    const requested = serveVendoredAssets(vendored)
    const font = await firstFontOf(await standard14Fixture())

    expect(font.missingFile).toBe(false)
    expect(requested).toContain('/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf')
  })

  it('falls back to a substitute when the fonts are not served', async () => {
    // The control. Without it, the assertions above could pass for a document
    // pdf.js never needed a font file to draw. The tree is on disk throughout;
    // what changes is only whether pdf.js was told where it is.
    const requested = serveVendoredAssets(vendored)
    const font = await firstFontOf(await standard14Fixture(), {})

    expect(font.missingFile).toBe(true)
    expect(requested).toEqual([])
  })
})
