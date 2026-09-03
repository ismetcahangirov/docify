/**
 * Whether the build put a WASM binary in front of a page.
 *
 * `test/app/initial-bundle.test.ts` proves nothing in this repository imports an
 * engine eagerly. This proves the bundler agreed. The two can disagree: a
 * bundler inlines, hoists and rewrites, and `next.config.ts` can ask for things
 * no source file says.
 *
 * It replaces `find .next/static/chunks -maxdepth 1 -name '*.wasm'`, which was
 * true of this repository for a reason unrelated to the invariant — every engine
 * binary is vendored into `public/` and fetched by URL, so webpack has nothing
 * to emit into that directory whatever the pages import.
 *
 * Pure, over the manifests and chunk contents the caller reads.
 */

/**
 * @typedef {{ pages: Record<string, string[]> }} AppBuildManifest
 * @typedef {Record<string, string>} AppPathRoutes entry key -> served route
 * @typedef {{ route: string, file: string, reason: string }} WasmFinding
 */

/**
 * Layout entries wrap page entries and a route downloads both. The same walk
 * `scripts/bundle-budget` does, for the same reason: Next.js files layout chunks
 * under their own manifest keys and does not repeat them inside the page entry.
 *
 * @param {string} pageKey
 * @returns {string[]}
 */
function ancestorLayoutKeys(pageKey) {
  const keys = ['/layout']
  let prefix = ''
  for (const segment of pageKey.split('/').slice(1, -1)) {
    prefix += `/${segment}`
    keys.push(`${prefix}/layout`)
  }

  return keys
}

/**
 * Every file each route downloads on first load — all of them, not only the
 * JavaScript. The bundle budget filters to `.js` because it is weighing
 * downloads; this is looking for exactly the extension that filter would hide.
 *
 * @param {AppBuildManifest} appBuildManifest
 * @param {AppPathRoutes} appPathRoutes
 * @returns {Array<{ route: string, files: string[] }>}
 */
export function firstLoadFiles(appBuildManifest, appPathRoutes) {
  return Object.entries(appPathRoutes).map(([pageKey, route]) => {
    const keys = [...ancestorLayoutKeys(pageKey), pageKey]
    const files = keys.flatMap((key) => appBuildManifest.pages[key] ?? [])

    return { route, files: [...new Set(files)] }
  })
}

/**
 * Every WASM binary a route pulls in before it renders.
 *
 * Two ways it can happen and both are reported: the manifest lists a `.wasm`
 * asset among a route's own files, or one of its JavaScript chunks names one —
 * which is what a bundler emits when it turns `new URL('….wasm', import.meta.url)`
 * into a fetch. The second is the one a search of the chunk directory could
 * never find, because the binary it points at is not in that directory.
 *
 * @param {{
 *   entries: Array<{ route: string, files: string[] }>,
 *   readChunk: (file: string) => string,
 * }} input
 * @returns {WasmFinding[]}
 */
export function wasmInFirstLoad({ entries, readChunk }) {
  /** @type {WasmFinding[]} */
  const findings = []

  for (const { route, files } of entries) {
    for (const file of files) {
      if (file.endsWith('.wasm')) {
        findings.push({ route, file, reason: 'the route downloads this binary directly' })
        continue
      }

      if (!file.endsWith('.js')) continue
      if (readChunk(file).includes('.wasm')) {
        findings.push({ route, file, reason: 'this first-load chunk names a .wasm binary' })
      }
    }
  }

  return findings
}
