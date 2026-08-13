#!/usr/bin/env node
/**
 * Bundle budget gate — `pnpm size`.
 *
 * Reads the manifest that `next build` writes, works out which chunks each
 * route downloads before it can render, and fails when any route's gzipped
 * first-load JavaScript exceeds the budget in `bundle-budget.config.mjs`.
 *
 * Requires a production build to be present; run `pnpm build` first.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

import config from '../bundle-budget.config.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(repoRoot, '.next')
const MANIFEST_PATH = join(BUILD_DIR, 'app-build-manifest.json')

/**
 * `next build` measures gzip at maximum compression, and the numbers below are
 * meant to be comparable with the ones it prints.
 */
const GZIP_LEVEL = 9

/**
 * @typedef {{ pages: Record<string, string[]> }} AppBuildManifest
 * @typedef {{ route: string, files: string[] }} FirstLoadEntry
 * @typedef {{ route: string, bytes: number, overBy: number }} RouteResult
 */

/**
 * Turn an app-build-manifest page key into the route it serves.
 *
 * @param {string} pageKey e.g. `/convert/page`
 * @returns {string} e.g. `/convert`
 */
export function routeFromPageKey(pageKey) {
  const route = pageKey.replace(/\/page$/, '')
  return route === '' ? '/' : route
}

/**
 * Every layout key that wraps a given page key, outermost first. Next.js lists
 * layout chunks under their own manifest entries, so a page's real first-load
 * set is its own entry plus each of its ancestors'.
 *
 * @param {string} pageKey
 * @returns {string[]}
 */
function ancestorLayoutKeys(pageKey) {
  const segments = pageKey.split('/').slice(1, -1)
  const keys = ['/layout']
  let prefix = ''
  for (const segment of segments) {
    prefix += `/${segment}`
    keys.push(`${prefix}/layout`)
  }
  return keys
}

/**
 * The set of JavaScript chunks each route downloads on first load.
 *
 * @param {AppBuildManifest} manifest
 * @returns {FirstLoadEntry[]}
 */
export function firstLoadEntries(manifest) {
  return Object.keys(manifest.pages)
    .filter((key) => key.endsWith('/page'))
    .map((pageKey) => {
      const keys = [...ancestorLayoutKeys(pageKey), pageKey]
      const files = keys.flatMap((key) => manifest.pages[key] ?? [])
      return {
        route: routeFromPageKey(pageKey),
        files: [...new Set(files)].filter((file) => file.endsWith('.js')),
      }
    })
}

/**
 * Weigh every route against the budget.
 *
 * @param {FirstLoadEntry[]} entries
 * @param {(file: string) => number} sizeOf gzipped size of one chunk, in bytes
 * @param {number} maxBytes
 * @returns {{ ok: boolean, routes: RouteResult[] }}
 */
export function evaluateBudget(entries, sizeOf, maxBytes) {
  const routes = entries
    .map(({ route, files }) => {
      const bytes = files.reduce((total, file) => total + sizeOf(file), 0)
      return { route, bytes, overBy: Math.max(0, bytes - maxBytes) }
    })
    .sort((a, b) => b.bytes - a.bytes || a.route.localeCompare(b.route))

  return { ok: routes.every((route) => route.overBy === 0), routes }
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`
}

/** @param {string} file */
function gzippedSize(file) {
  return gzipSync(readFileSync(join(BUILD_DIR, file)), { level: GZIP_LEVEL }).length
}

/** @param {string} message */
function fail(message) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error::${message}`)
  console.error(`\n${message}`)
  process.exitCode = 1
}

function main() {
  /** @type {AppBuildManifest} */
  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch {
    fail(`No production build found at ${MANIFEST_PATH}. Run \`pnpm build\` first.`)
    return
  }

  const { maxFirstLoadJsBytes } = config
  const { ok, routes } = evaluateBudget(
    firstLoadEntries(manifest),
    gzippedSize,
    maxFirstLoadJsBytes,
  )

  const width = Math.max(...routes.map((route) => route.route.length), 'route'.length)
  console.log(`First Load JS, gzipped — budget ${formatBytes(maxFirstLoadJsBytes)} per route\n`)
  for (const { route, bytes, overBy } of routes) {
    const verdict = overBy > 0 ? `over by ${formatBytes(overBy)}` : 'ok'
    console.log(`  ${route.padEnd(width)}  ${formatBytes(bytes).padStart(9)}  ${verdict}`)
  }

  if (!ok) {
    const offenders = routes.filter((route) => route.overBy > 0).map((route) => route.route)
    fail(
      `Bundle budget exceeded on ${offenders.length} route(s): ${offenders.join(', ')}. ` +
        'Split the added code behind a dynamic import(), or raise the budget in ' +
        'bundle-budget.config.mjs with a reason.',
    )
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()
