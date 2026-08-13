import { describe, expect, it } from 'vitest'

import {
  checkBudget,
  evaluateBudget,
  firstLoadEntries,
  formatBytes,
  unmappedPageKeys,
} from '../scripts/bundle-budget/measure.mjs'

/**
 * Shaped like a real `.next/app-build-manifest.json`, with the property the
 * measurement depends on: a page entry does *not* repeat its ancestor layout's
 * chunks, so they have to be unioned in. Includes a route group and a parallel
 * route slot, neither of which exists in the app yet.
 */
const APP_BUILD_MANIFEST = {
  pages: {
    '/layout': [
      'static/chunks/webpack.js',
      'static/chunks/framework.js',
      'static/css/app.css',
      'static/chunks/app/layout.js',
    ],
    '/page': [
      'static/chunks/webpack.js',
      'static/chunks/framework.js',
      'static/chunks/app/page.js',
    ],
    '/(marketing)/layout': ['static/chunks/app/marketing/layout.js'],
    '/(marketing)/about/page': ['static/chunks/webpack.js', 'static/chunks/app/about/page.js'],
    '/convert/layout': ['static/chunks/webpack.js', 'static/chunks/app/convert/layout.js'],
    '/convert/page': [
      'static/chunks/webpack.js',
      'static/chunks/framework.js',
      'static/chunks/app/convert/page.js',
    ],
    '/@modal/photo/page': ['static/chunks/app/modal/photo/page.js'],
  },
}

/** `next build` writes this as the authoritative entry-key -> route map. */
const APP_PATH_ROUTES = {
  '/page': '/',
  '/(marketing)/about/page': '/about',
  '/convert/page': '/convert',
}

const entriesByRoute = new Map(
  firstLoadEntries(APP_BUILD_MANIFEST, APP_PATH_ROUTES).map((entry) => [entry.route, entry.files]),
)

describe('firstLoadEntries', () => {
  it('reports the route users visit, not the build entry key', () => {
    expect([...entriesByRoute.keys()].sort()).toEqual(['/', '/about', '/convert'])
  })

  it('includes the chunks of every ancestor layout', () => {
    expect(entriesByRoute.get('/convert')).toContain('static/chunks/app/layout.js')
    expect(entriesByRoute.get('/convert')).toContain('static/chunks/app/convert/layout.js')
  })

  it('resolves a route group layout, which shares no path prefix with the route', () => {
    expect(entriesByRoute.get('/about')).toContain('static/chunks/app/marketing/layout.js')
  })

  it('does not leak a nested layout into a sibling route', () => {
    expect(entriesByRoute.get('/')).not.toContain('static/chunks/app/convert/layout.js')
  })

  it('counts a shared chunk once even though every entry lists it', () => {
    const webpack = entriesByRoute.get('/')?.filter((file) => file === 'static/chunks/webpack.js')
    expect(webpack).toHaveLength(1)
  })

  it('measures JavaScript only, since the budget is a JS budget', () => {
    expect(entriesByRoute.get('/')).not.toContain('static/css/app.css')
  })

  it('does not invent a route for a parallel route slot', () => {
    expect([...entriesByRoute.keys()]).not.toContain('/@modal/photo')
  })
})

describe('unmappedPageKeys', () => {
  it('names the page entries no route claims, so they are not silently dropped', () => {
    expect(unmappedPageKeys(APP_BUILD_MANIFEST, APP_PATH_ROUTES)).toEqual(['/@modal/photo/page'])
  })

  it('is empty when every page entry maps to a route', () => {
    expect(unmappedPageKeys({ pages: { '/page': [] } }, { '/page': '/' })).toEqual([])
  })
})

describe('evaluateBudget', () => {
  const entries = [
    { route: '/', files: ['a.js', 'b.js'] },
    { route: '/convert', files: ['a.js', 'c.js'] },
  ]
  const sizes: Record<string, number> = { 'a.js': 100_000, 'b.js': 19_000, 'c.js': 25_000 }
  const sizeOf = (file: string) => sizes[file]

  it('passes when every route fits the budget', () => {
    const result = evaluateBudget(entries.slice(0, 1), sizeOf, 120_000)
    expect(result.ok).toBe(true)
    expect(result.routes[0]).toMatchObject({ route: '/', bytes: 119_000, overBy: 0 })
  })

  it('fails when a single route exceeds the budget', () => {
    const result = evaluateBudget(entries, sizeOf, 120_000)
    expect(result.ok).toBe(false)
    expect(result.routes.filter((route) => route.overBy > 0)).toEqual([
      { route: '/convert', bytes: 125_000, overBy: 5_000 },
    ])
  })

  it('treats the budget as an inclusive maximum', () => {
    expect(evaluateBudget([{ route: '/', files: ['a.js'] }], sizeOf, 100_000).ok).toBe(true)
    expect(evaluateBudget([{ route: '/', files: ['a.js'] }], sizeOf, 99_999).ok).toBe(false)
  })

  it('sorts the heaviest route first so the report leads with the worst case', () => {
    const result = evaluateBudget(entries, sizeOf, 200_000)
    expect(result.routes.map((route) => route.route)).toEqual(['/convert', '/'])
  })
})

describe('checkBudget', () => {
  const sizeOf = () => 10_000

  it('reports no problem when the build fits', () => {
    const result = checkBudget({
      appBuildManifest: APP_BUILD_MANIFEST,
      appPathRoutes: APP_PATH_ROUTES,
      sizeOf,
      maxBytes: 120_000,
    })
    expect(result.ok).toBe(true)
    expect(result.problem).toBeNull()
  })

  it('names the offending routes in the failure message', () => {
    const result = checkBudget({
      appBuildManifest: APP_BUILD_MANIFEST,
      appPathRoutes: APP_PATH_ROUTES,
      sizeOf,
      maxBytes: 30_000,
    })
    expect(result.ok).toBe(false)
    expect(result.problem).toContain('/convert')
    expect(result.problem).toContain('dynamic import()')
  })

  it('fails rather than passes when there is nothing to measure', () => {
    const result = checkBudget({
      appBuildManifest: { pages: {} },
      appPathRoutes: {},
      sizeOf,
      maxBytes: 120_000,
    })
    expect(result.ok).toBe(false)
    expect(result.problem).toContain('no routes')
  })
})

describe('formatBytes', () => {
  it('reports kB in the same 1000-byte unit as the next build output', () => {
    expect(formatBytes(102_339)).toBe('102.3 kB')
    expect(formatBytes(0)).toBe('0.0 kB')
  })
})
