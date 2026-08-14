#!/usr/bin/env node
/**
 * Vendors wasm-vips into `public/` — run by `pnpm dev` and `pnpm build`.
 *
 * See `./vendor.mjs` for why the package is copied rather than bundled.
 */
import { VIPS_VENDORED_FILES, vendorWasmVips } from './vendor.mjs'

/** @param {string} message */
function fail(message) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error::${message}`)
  console.error(`\n${message}`)
  process.exitCode = 1
}

function main() {
  let bytes

  try {
    bytes = vendorWasmVips()
  } catch (error) {
    // Almost always a missing or partial install: without the vendored files
    // every image conversion fails at run time, so this must not look like a pass.
    fail(
      `Could not vendor wasm-vips: ${error instanceof Error ? error.message : String(error)}. ` +
        'Run `pnpm install` first.',
    )
    return
  }

  const megabytes = (bytes / 1024 / 1024).toFixed(1)
  console.log(
    `wasm-vips: ${VIPS_VENDORED_FILES.length} files (${megabytes} MB) → public/vendor/wasm-vips/`,
  )
}

main()
