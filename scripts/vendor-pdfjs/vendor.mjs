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

import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The directories that are copied, matching the four URLs
 * `lib/engines/pdfjs-runtime.ts` hands to pdf.js.
 */
export const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'iccs', 'wasm']

/**
 * The `wasm/` directory, pinned rather than copied whole.
 *
 * Three decoders and their licences. What is left behind is `quickjs-eval.*`,
 * which only runs JavaScript embedded in a PDF — a feature this app does not
 * enable and would not want to — and the `*_nowasm_fallback.js` pair, 600 kB of
 * hand-compiled JavaScript for engines without WebAssembly, which cannot run
 * anything else in Docify either.
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
 * `build/pdf.mjs`, and the data trees are that directory's siblings.
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

  for (const dir of PDFJS_ASSET_DIRS) {
    mkdirSync(join(destination, dir), { recursive: true })

    for (const file of pdfjsAssetFiles(dir)) {
      const from = join(source, dir, file)

      copyFileSync(from, join(destination, dir, file))
      bytes += statSync(from).size
    }
  }

  return bytes
}
