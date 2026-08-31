/**
 * Copying `@ffmpeg/core` into `public/vendor/ffmpeg/`.
 *
 * Same reasoning as `../vendor-wasm-vips/vendor.mjs`, and more so. The core is
 * Emscripten output that resolves `ffmpeg-core.wasm` relative to its own script
 * location, and the binary is 31 MB — a bundler that follows the import either
 * inlines that into a chunk or rewrites the URL to somewhere the runtime does
 * not look. Serving the two files verbatim out of `public/` and fetching them at
 * run time avoids both, and makes it structurally impossible for the largest
 * asset in the project to reach a JavaScript bundle (CLAUDE.md §2.3).
 *
 * The ESM build rather than the UMD one: `lib/engines/ffmpeg-runtime.ts` reaches
 * it with `await import()`, which needs a module.
 *
 * The destination is gitignored. This runs from `pnpm dev` and `pnpm build`, so
 * the vendored copy is reproducible from the lockfile rather than committed.
 *
 * Logic only — `./cli.mjs` is the executable half, so importing this module has
 * no side effects.
 */

import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Must stay in step with `FFMPEG_ASSETS` in `lib/engines/ffmpeg-runtime.ts`. */
export const FFMPEG_VENDORED_FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm']

/** Where the files are served from, matching `FFMPEG_ASSET_PATH`. */
export const FFMPEG_VENDOR_DIR = join(repoRoot, 'public', 'vendor', 'ffmpeg')

/**
 * The `dist/esm` directory of the installed `@ffmpeg/core`.
 *
 * Resolved through the package's entry point, which is the UMD build, and then
 * redirected to the sibling ESM one. Path arithmetic over `node_modules` does
 * not work under pnpm, which links out of a content-addressed store.
 *
 * @returns {string}
 */
export function ffmpegCoreDir() {
  const umd = createRequire(import.meta.url).resolve('@ffmpeg/core')

  return join(dirname(dirname(umd)), 'esm')
}

/**
 * The on-disk size of one vendored file, read from the installed package.
 *
 * @param {string} file
 * @returns {number}
 */
export function ffmpegAssetBytes(file) {
  return statSync(join(ffmpegCoreDir(), file)).size
}

/**
 * Copies every vendored file into `public/`, returning the total byte count.
 *
 * @returns {number}
 */
export function vendorFfmpeg() {
  const source = ffmpegCoreDir()
  mkdirSync(FFMPEG_VENDOR_DIR, { recursive: true })

  let bytes = 0
  for (const file of FFMPEG_VENDORED_FILES) {
    copyFileSync(join(source, file), join(FFMPEG_VENDOR_DIR, file))
    bytes += ffmpegAssetBytes(file)
  }

  return bytes
}
