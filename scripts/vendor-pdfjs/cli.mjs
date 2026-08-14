#!/usr/bin/env node
/**
 * Vendors pdf.js' optional data files into `public/` — run by `pnpm dev` and
 * `pnpm build`.
 *
 * See `./vendor.mjs` for what is copied and why it is not bundled.
 */
import { PDFJS_ASSET_DIRS, vendorPdfjs } from './vendor.mjs'

/** @param {string} message */
function fail(message) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error::${message}`)
  console.error(`\n${message}`)
  process.exitCode = 1
}

function main() {
  let bytes

  try {
    bytes = vendorPdfjs()
  } catch (error) {
    // Almost always a missing or partial install. Without these files a PDF
    // still renders, in the wrong font and without its images, so this must not
    // look like a pass.
    fail(
      `Could not vendor pdf.js assets: ${error instanceof Error ? error.message : String(error)}. ` +
        'Run `pnpm install` first.',
    )
    return
  }

  const megabytes = (bytes / 1024 / 1024).toFixed(1)
  console.log(`pdf.js: ${PDFJS_ASSET_DIRS.join(', ')} (${megabytes} MB) → public/vendor/pdfjs/`)
}

main()
