/**
 * Copying the wasm-vips package into `public/vendor/wasm-vips/`.
 *
 * wasm-vips is Emscripten output: it resolves `vips.wasm` and its side modules
 * relative to its own `import.meta.url`, and it starts its pthread pool with
 * `new Worker(new URL('vips-es6.js', import.meta.url))`. A bundler that rewrites
 * those URLs produces a chunk whose siblings are no longer where the runtime
 * looks for them, and the failure only appears in production. So the files are
 * served verbatim out of `public/` and fetched at run time by
 * `lib/engines/vips-runtime.ts` — which also makes it impossible for the 5 MB
 * binary to reach a JavaScript bundle (CLAUDE.md §2.3).
 *
 * The destination is gitignored. This runs from `pnpm dev` and `pnpm build`, so
 * the vendored copy is reproducible from the lockfile rather than committed.
 *
 * `vips-jxl.wasm` and `vips-resvg.wasm` are deliberately left behind: JPEG-XL is
 * not a format Docify offers and SVG rendering is Canvas' job, so copying them
 * would add 3.3 MB of download for nothing.
 *
 * Logic only — `./cli.mjs` is the executable half, so importing this module has
 * no side effects.
 */

import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Must stay in step with `VIPS_ASSETS` in `lib/engines/vips-runtime.ts`. */
export const VIPS_VENDORED_FILES = ['vips-es6.js', 'vips.wasm', 'vips-heif.wasm']

/** Where the files are served from, matching `VIPS_ASSET_PATH`. */
export const VIPS_VENDOR_DIR = join(repoRoot, 'public', 'vendor', 'wasm-vips')

/**
 * The `lib/` directory of the installed wasm-vips package.
 *
 * Resolved through the package's entry point rather than by joining
 * `node_modules`: pnpm links packages out of a content-addressed store, so no
 * amount of path arithmetic finds the real directory. `package.json` is not in
 * the package's `exports` map and cannot be resolved directly either.
 *
 * @returns {string}
 */
export function vipsLibDir() {
  return dirname(createRequire(import.meta.url).resolve('wasm-vips'))
}

/**
 * The on-disk size of one vendored file, read from the installed package.
 *
 * @param {string} file
 * @returns {number}
 */
export function vipsAssetBytes(file) {
  return statSync(join(vipsLibDir(), file)).size
}

/**
 * Copies every vendored file into `public/`, returning the total byte count.
 *
 * @returns {number}
 */
export function vendorWasmVips() {
  const source = vipsLibDir()
  mkdirSync(VIPS_VENDOR_DIR, { recursive: true })

  let bytes = 0
  for (const file of VIPS_VENDORED_FILES) {
    copyFileSync(join(source, file), join(VIPS_VENDOR_DIR, file))
    bytes += vipsAssetBytes(file)
  }

  return bytes
}
