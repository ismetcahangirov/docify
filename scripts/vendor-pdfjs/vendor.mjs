/**
 * Copying pdf.js' optional data files into `public/vendor/pdfjs/`.
 *
 * pdf.js ships its library in `build/` and four trees of data beside it, which
 * it fetches only when a document turns out to need them: CJK character maps,
 * the fourteen standard PDF fonts, the CMYK ICC profile, and the WASM decoders
 * for JPEG 2000, JBIG2 and colour management. Left unserved, none of that fails
 * — pdf.js substitutes a face, skips the colour transform and draws nothing for
 * the image. The document renders; it is simply wrong.
 *
 * The files are therefore copied verbatim into `public/` and fetched at run time
 * from our own origin by `lib/engines/pdfjs-runtime.ts`, exactly as
 * `../vendor-wasm-vips/vendor.mjs` does for libvips. Two things follow, both
 * wanted: nothing is fetched from a CDN (CLAUDE.md §3), and the 2.3 MB the tree
 * weighs cannot reach a JavaScript bundle, because no bundler ever sees it
 * (CLAUDE.md §2.3).
 *
 * The destination is gitignored. This runs from `pnpm dev` and `pnpm build`, so
 * the vendored copy is reproducible from the lockfile rather than committed.
 *
 * Logic only — `./cli.mjs` is the executable half, so importing this module has
 * no side effects.
 */

import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * One file that must come out of each copied directory.
 *
 * Three of the four are copied whole, so an empty or relocated directory would
 * otherwise vendor nothing, report success and leave the app rendering the
 * wrong thing — the exact failure this script exists to prevent. Naming a file
 * per directory turns that into a build error.
 *
 * @type {Record<string, string>}
 */
export const PDFJS_REQUIRED_FILES = {
  cmaps: 'Adobe-Japan1-UCS2.bcmap',
  standard_fonts: 'LiberationSans-Regular.ttf',
  iccs: 'CGATS001Compat-v2-micro.icc',
  wasm: 'openjpeg.wasm',
}

/**
 * The directories that are copied, matching the four URLs
 * `lib/engines/pdfjs-assets.ts` hands to pdf.js.
 */
export const PDFJS_ASSET_DIRS = Object.keys(PDFJS_REQUIRED_FILES)

/**
 * The `wasm/` directory, pinned rather than copied whole.
 *
 * Three decoders and their licences. What is left behind is `quickjs-eval.*`,
 * which only runs JavaScript embedded in a PDF — a feature this app does not
 * enable and would not want to — and the `*_nowasm_fallback.js` pair, 600 kB of
 * hand-compiled JavaScript that pdf.js imports when a `.wasm` fails to fetch or
 * instantiate. That path is deliberately left unreachable: every browser that
 * can run a Docify conversion has WebAssembly, so reaching it means something
 * else is already broken, and the cost of the miss is one undecoded image and a
 * warning rather than a failed page.
 */
export const PDFJS_WASM_FILES = [
  'jbig2.wasm',
  'openjpeg.wasm',
  'qcms_bg.wasm',
  'LICENSE_JBIG2',
  'LICENSE_OPENJPEG',
  'LICENSE_PDFJS_JBIG2',
  'LICENSE_PDFJS_OPENJPEG',
  'LICENSE_PDFJS_QCMS',
  'LICENSE_QCMS',
]

/** Where the files are served from, matching `PDFJS_ASSET_PATH`. */
export const PDFJS_VENDOR_DIR = join(repoRoot, 'public', 'vendor', 'pdfjs')

/**
 * The root of the installed pdfjs-dist package.
 *
 * Resolved through the package's entry point rather than by joining
 * `node_modules`: pnpm links packages out of a content-addressed store, so no
 * amount of path arithmetic finds the real directory. The entry point is
 * `build/pdf.mjs`, and the data trees are that directory's siblings — shared by
 * the legacy build `lib/engines/pdfjs-runtime.ts` actually imports, which keeps
 * its own copy of the library alone.
 *
 * @returns {string}
 */
export function pdfjsPackageDir() {
  return resolve(dirname(createRequire(import.meta.url).resolve('pdfjs-dist')), '..')
}

/**
 * The files copied out of one asset directory.
 *
 * `wasm/` is pinned; the rest are taken whole, because a cMap this app declines
 * to serve is a language whose documents it renders as blanks.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function pdfjsAssetFiles(dir) {
  if (dir === 'wasm') return [...PDFJS_WASM_FILES]

  return readdirSync(join(pdfjsPackageDir(), dir), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
}

/**
 * Copies every vendored file into `destination`, returning the total byte count.
 *
 * The destination is a parameter so a test can vendor into a directory of its
 * own and serve the result, rather than asserting against a copy that may or may
 * not have been made.
 *
 * @param {string} [destination]
 * @returns {number}
 */
export function vendorPdfjs(destination = PDFJS_VENDOR_DIR) {
  const source = pdfjsPackageDir()
  let bytes = 0

  // Emptied rather than written over: an upgrade that renames a cMap would
  // otherwise leave the old one being served forever, and the whole claim here
  // is that `public/vendor/` mirrors the lockfile.
  rmSync(destination, { recursive: true, force: true })

  for (const dir of PDFJS_ASSET_DIRS) {
    const files = pdfjsAssetFiles(dir)

    if (!files.includes(PDFJS_REQUIRED_FILES[dir])) {
      throw new Error(`${dir}/${PDFJS_REQUIRED_FILES[dir]} is missing from ${source}`)
    }

    mkdirSync(join(destination, dir), { recursive: true })

    for (const file of files) {
      const from = join(source, dir, file)

      copyFileSync(from, join(destination, dir, file))
      bytes += statSync(from).size
    }
  }

  return bytes
}
