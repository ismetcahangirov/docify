import { describe, expect, it } from 'vitest'

import {
  evaluateBudget,
  firstLoadEntries,
  formatBytes,
  routeFromPageKey,
} from '../scripts/bundle-budget.mjs'

/**
 * A trimmed copy of a real `.next/app-build-manifest.json`: one root layout,
 * a home page, a nested route and the not-found page. The shared runtime
 * chunks repeat across every entry, exactly as Next.js emits them.
 */
const MANIFEST = {
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
    '/convert/layout': ['static/chunks/webpack.js', 'static/chunks/app/convert/layout.js'],
    '/convert/page': [
      'static/chunks/webpack.js',
      'static/chunks/framework.js',
      'static/chunks/app/convert/page.js',
    ],
    '/_not-found/page': ['static/chunks/webpack.js', 'static/chunks/app/_not-found/page.js'],
  },
}

describe('routeFromPageKey', () => {
  it('maps the root page key to /', () => {
    expect(routeFromPageKey('/page')).toBe('/')
  })

  it('strips the trailing /page segment from nested routes', () => {
    expect(routeFromPageKey('/convert/page')).toBe('/convert')
    expect(routeFromPageKey('/tools/pdf/page')).toBe('/tools/pdf')
  })
})

describe('firstLoadEntries', () => {
  const entries = firstLoadEntries(MANIFEST)
  const byRoute = new Map(entries.map((entry) => [entry.route, entry.files]))

  it('returns one entry per page, keyed by route', () => {
    expect([...byRoute.keys()].sort()).toEqual(['/', '/_not-found', '/convert'])
  })

  it('includes the chunks of every ancestor layout', () => {
    expect(byRoute.get('/convert')).toContain('static/chunks/app/layout.js')
    expect(byRoute.get('/convert')).toContain('static/chunks/app/convert/layout.js')
  })

  it('does not leak a nested layout into a sibling route', () => {
    expect(byRoute.get('/')).not.toContain('static/chunks/app/convert/layout.js')
  })

  it('counts a shared chunk once even though every entry lists it', () => {
    const webpackChunks = byRoute.get('/')?.filter((file) => file === 'static/chunks/webpack.js')
    expect(webpackChunks).toHaveLength(1)
  })

  it('measures JavaScript only, since the budget is a JS budget', () => {
    expect(byRoute.get('/')).not.toContain('static/css/app.css')
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

  it('treats a route sitting exactly on the budget as passing', () => {
    const result = evaluateBudget([{ route: '/', files: ['a.js'] }], sizeOf, 100_000)
    expect(result.ok).toBe(true)
  })

  it('sorts the heaviest route first so the report leads with the worst case', () => {
    const result = evaluateBudget(entries, sizeOf, 200_000)
    expect(result.routes.map((route) => route.route)).toEqual(['/convert', '/'])
  })
})

describe('formatBytes', () => {
  it('reports kB in the same 1000-byte unit as the next build output', () => {
    expect(formatBytes(102_339)).toBe('102.3 kB')
    expect(formatBytes(0)).toBe('0.0 kB')
  })
})
