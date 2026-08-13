#!/usr/bin/env node
/**
 * Bundle budget gate — `pnpm size`.
 *
 * Reads the manifests `next build` writes, sums the gzipped weight of every
 * chunk each route downloads before it can render, and exits non-zero when a
 * route exceeds the budget in `bundle-budget.config.mjs`.
 *
 * Requires a production build to be present; run `pnpm build` first.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import config from '../../bundle-budget.config.mjs'
import { checkBudget, formatBytes } from './measure.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const buildDir = join(repoRoot, '.next')

/** `next build` reports gzip at maximum compression; match it so the numbers line up. */
const GZIP_LEVEL = 9

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

/** @param {string} file @returns {number} */
function gzippedSize(file) {
  return gzipSync(readFileSync(join(buildDir, file)), { level: GZIP_LEVEL }).length
}

function main() {
  const { maxFirstLoadJsBytes } = config
  let result

  try {
    result = checkBudget({
      appBuildManifest: /** @type {never} */ (readManifest('app-build-manifest.json')),
      appPathRoutes: /** @type {never} */ (readManifest('app-path-routes-manifest.json')),
      sizeOf: gzippedSize,
      maxBytes: maxFirstLoadJsBytes,
    })
  } catch (error) {
    // A missing or half-written .next is the common case here, and it must not
    // look like a pass.
    fail(
      `Could not measure the bundle: ${error instanceof Error ? error.message : String(error)}. ` +
        'Run `pnpm build` first; if the build is fresh, .next is incomplete.',
    )
    return
  }

  const width = Math.max(...result.routes.map((route) => route.route.length), 0)
  console.log(`First Load JS, gzipped — budget ${formatBytes(maxFirstLoadJsBytes)} per route\n`)
  for (const { route, bytes, overBy } of result.routes) {
    const verdict = overBy > 0 ? `over by ${formatBytes(overBy)}` : 'ok'
    console.log(`  ${route.padEnd(width)}  ${formatBytes(bytes).padStart(9)}  ${verdict}`)
  }

  if (result.unmapped.length > 0) {
    console.log(
      `\nNot attributed to any route, so not measured: ${result.unmapped.join(', ')}. ` +
        'These chunks still load with the route that renders them.',
    )
  }

  if (result.problem) fail(result.problem)
}

main()
