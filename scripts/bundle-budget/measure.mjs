/**
 * Pure measurement half of the bundle budget gate. Everything here takes the
 * build manifests as arguments and does no I/O, so the CLI's decisions can be
 * tested without a production build on disk.
 *
 * @typedef {{ pages: Record<string, string[]> }} AppBuildManifest
 * @typedef {Record<string, string>} AppPathRoutes entry key -> served route
 * @typedef {{ route: string, files: string[] }} FirstLoadEntry
 * @typedef {{ route: string, bytes: number, overBy: number }} RouteResult
 */

/**
 * Every layout entry key that wraps a given page key, outermost first. Next.js
 * files layout chunks under their own manifest entries and does not repeat them
 * inside the page entry, so a route's real first-load set is its own entry plus
 * each of its ancestors'.
 *
 * @param {string} pageKey e.g. `/convert/page`
 * @returns {string[]} e.g. `['/layout', '/convert/layout']`
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
 * The JavaScript chunks each route downloads on first load.
 *
 * The route list comes from `app-path-routes-manifest.json` rather than from
 * the build manifest's own keys: it is the authoritative entry-key -> route
 * map, so route groups are reported under the path users actually visit
 * (`/(marketing)/about` -> `/about`) and non-navigable entries such as parallel
 * route slots never appear as routes of their own.
 *
 * @param {AppBuildManifest} appBuildManifest
 * @param {AppPathRoutes} appPathRoutes
 * @returns {FirstLoadEntry[]}
 */
export function firstLoadEntries(appBuildManifest, appPathRoutes) {
  return Object.entries(appPathRoutes).map(([pageKey, route]) => {
    const keys = [...ancestorLayoutKeys(pageKey), pageKey]
    const files = keys.flatMap((key) => appBuildManifest.pages[key] ?? [])
    return { route, files: [...new Set(files)].filter((file) => file.endsWith('.js')) }
  })
}

/**
 * Page entries the build emitted that no route claims — parallel route slots
 * (`@modal`) and anything a future Next.js version introduces. Their chunks
 * load with the route that renders them but cannot be attributed to one route
 * from the manifests alone, so they are reported rather than silently dropped.
 *
 * @param {AppBuildManifest} appBuildManifest
 * @param {AppPathRoutes} appPathRoutes
 * @returns {string[]}
 */
export function unmappedPageKeys(appBuildManifest, appPathRoutes) {
  return Object.keys(appBuildManifest.pages).filter(
    (key) => key.endsWith('/page') && !(key in appPathRoutes),
  )
}

/**
 * Weigh every route against the budget, heaviest first.
 *
 * `maxBytes` is an inclusive maximum: a route weighing exactly the budget
 * passes. The one-byte difference from the plan's "< 120 KB" is not worth a
 * rule nobody can predict.
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
 * @returns {string} the same 1000-byte kB unit `next build` prints
 */
export function formatBytes(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`
}

/**
 * The whole verdict, from manifests to pass/fail.
 *
 * @param {{
 *   appBuildManifest: AppBuildManifest,
 *   appPathRoutes: AppPathRoutes,
 *   sizeOf: (file: string) => number,
 *   maxBytes: number,
 * }} input
 * @returns {{ ok: boolean, routes: RouteResult[], unmapped: string[], problem: string | null }}
 */
export function checkBudget({ appBuildManifest, appPathRoutes, sizeOf, maxBytes }) {
  const entries = firstLoadEntries(appBuildManifest, appPathRoutes)
  const unmapped = unmappedPageKeys(appBuildManifest, appPathRoutes)

  // A gate that measures nothing is worse than no gate: it reports success
  // forever. Treat an empty route list as a broken check, not as a pass.
  if (entries.length === 0) {
    return {
      ok: false,
      routes: [],
      unmapped,
      problem:
        'The build manifests yielded no routes to measure. The bundle budget checked nothing, ' +
        'which usually means the Next.js manifest format changed.',
    }
  }

  const { ok, routes } = evaluateBudget(entries, sizeOf, maxBytes)
  const offenders = routes.filter((route) => route.overBy > 0).map((route) => route.route)

  return {
    ok,
    routes,
    unmapped,
    problem: ok
      ? null
      : `Bundle budget exceeded on ${offenders.length} route(s): ${offenders.join(', ')}. ` +
        'Split the added code behind a dynamic import(), or raise the budget in ' +
        'bundle-budget.config.mjs with a reason.',
  }
}
