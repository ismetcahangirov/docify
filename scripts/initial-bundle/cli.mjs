#!/usr/bin/env node
/**
 * No-WASM-in-the-initial-bundle gate — `pnpm check:wasm`.
 *
 * CLAUDE.md §2.3: no WASM binary is part of the initial bundle. The source half
 * of that invariant is asserted in `test/app/initial-bundle.test.ts`, which needs
 * no build and runs in the unit job; this half reads what `next build` actually
 * emitted and follows every route's first-load set.
 *
 * Requires a production build to be present; run `pnpm build` first. A missing
 * or half-written `.next` fails rather than passing quietly — a gate that
 * measures nothing reports success forever.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { firstLoadFiles, wasmInFirstLoad } from './wasm.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const buildDir = join(repoRoot, '.next')

/** @param {string} message */
function fail(message) {
  // Surfaces the reason on the job summary rather than only in the log.
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error::${message}`)
  console.error(`\n${message}`)
  process.exitCode = 1
}

/** @param {string} name @returns {unknown} */
function readManifest(name) {
  return JSON.parse(readFileSync(join(buildDir, name), 'utf8'))
}

/** @param {string} file @returns {string} */
function readChunk(file) {
  try {
    return readFileSync(join(buildDir, file), 'utf8')
  } catch {
    // A chunk the manifest names but the build did not write is a broken build,
    // not a clean one — but it is `pnpm build`'s failure to report, not this
    // gate's, and reading it as empty keeps the message here about WASM.
    return ''
  }
}

function main() {
  let entries

  try {
    entries = firstLoadFiles(
      /** @type {never} */ (readManifest('app-build-manifest.json')),
      /** @type {never} */ (readManifest('app-path-routes-manifest.json')),
    )
  } catch (error) {
    fail(
      `Could not read the build manifests: ${error instanceof Error ? error.message : String(error)}. ` +
        'Run `pnpm build` first; if the build is fresh, .next is incomplete.',
    )
    return
  }

  if (entries.length === 0) {
    fail('The build manifests yielded no routes, so the WASM check looked at nothing.')
    return
  }

  const findings = wasmInFirstLoad({ entries, readChunk })
  const files = new Set(entries.flatMap((entry) => entry.files))

  console.log(
    `First-load WASM check — ${files.size} files across ${entries.length} routes, ` +
      `${findings.length} finding${findings.length === 1 ? '' : 's'}.`,
  )

  if (findings.length === 0) return

  console.error('')
  for (const { route, file, reason } of findings)
    console.error(`  ${route}  ${file}\n    ${reason}`)
  fail(
    `A WASM binary is in the initial bundle of ${findings.length} route file(s). Engines must be ` +
      'reached through `dynamic import()` after a file has been chosen (CLAUDE.md §2.3).',
  )
}

main()
