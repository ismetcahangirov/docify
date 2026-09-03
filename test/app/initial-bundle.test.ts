import { readdirSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { staticGraphOfAll } from '../support/import-graph'

/**
 * Nothing an engine needs may be in the initial bundle (issue #76).
 *
 * `test/worker/static-import-graph` already guards the other side of the same
 * invariant: the conversion worker reaches no engine statically. This guards the
 * side a visitor pays for. The two are separate because they fail separately —
 * a page that statically imports `lib/engines/vips` puts wasm-vips in the
 * first-load bundle no matter how careful the worker is, and no assertion made
 * about the worker would notice.
 *
 * ## What "the initial bundle" means here
 *
 * The transitive closure of *static* imports out of every App Router entry,
 * cut at each `await import()` — which is where a bundler cuts a chunk. Layouts
 * and pages are the obvious entries; `route`, `sitemap` and `robots` are walked
 * too. Those three never reach a browser, so an engine imported by one costs no
 * download; it is still a bug of the same family, and excluding them would mean
 * a second, quieter rule about which files the invariant applies to.
 *
 * ## Why the package list is pinned rather than pattern-matched
 *
 * The worker guard asks whether anything *heavy* leaked, with a regular
 * expression over known engine names. That answers today's question and not
 * tomorrow's: an engine added next year through a package the pattern has never
 * heard of passes it. Pinning the whole list inverts the default — a dependency
 * is lazy until somebody writes it down here — which is the property that makes
 * this hold for engines nobody has written.
 *
 * The complementary half runs after `next build`, in `scripts/initial-bundle`:
 * this file proves nothing in the repository imports an engine eagerly, and that
 * one proves the bundler agreed.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The file names Next.js treats as an entry in the App Router.
 *
 * `page` and `layout` are the ones that exist today. The rest are here so that
 * the day somebody adds `app/not-found.tsx` it is walked without anybody
 * remembering to come back — a guard that silently narrows as the app grows is
 * worse than one that was never written.
 */
const ENTRY_NAMES = new Set([
  'page',
  'layout',
  'template',
  'default',
  'loading',
  'error',
  'global-error',
  'not-found',
  'route',
  'sitemap',
  'robots',
])

/** Every App Router entry under `app/`, as repo-relative POSIX paths. */
function appEntries(directory = join(repoRoot, 'app')): string[] {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) return appEntries(path)

      const base = name.replace(/\.(?:ts|tsx|js|jsx|mjs)$/u, '')

      return base !== name && ENTRY_NAMES.has(base) ? [path] : []
    })
    .map((path) => posix.join(...relative(repoRoot, path).split(sep)))
    .sort()
}

const entries = appEntries()
const graph = staticGraphOfAll(entries, repoRoot)

describe('the entries the walk starts from', () => {
  it('finds every route file the app ships', () => {
    // Asserted rather than assumed: an empty entry list would make every
    // assertion below pass, which is the failure mode a membership guard has.
    expect(entries).toEqual([
      'app/convert/[pair]/page.tsx',
      'app/convert/page.tsx',
      'app/layout.tsx',
      'app/page.tsx',
      'app/robots.ts',
      'app/sitemap.ts',
      'app/tools/page.tsx',
    ])
  })

  it('walks a graph large enough to be believable', () => {
    // A resolver that answered null for everything would report a perfectly
    // clean bundle. The pages plus their blocks are comfortably past this floor.
    expect(graph.files.length).toBeGreaterThan(20)
  })

  it('reaches the modules the pages are actually built out of', () => {
    expect(graph.files).toContain('components/blocks/section-block.tsx')
    expect(graph.files).toContain('lib/registry/pairs.ts')
  })
})

describe('the initial bundle', () => {
  it('contains no engine module', () => {
    // Including the descriptors, which are cheap but drag `lib/engines/registry`
    // and the router in behind them. They are reached through the converter
    // island's `dynamic()`, and that is where they must stay.
    expect(graph.files.filter((file) => file.startsWith('lib/engines/'))).toEqual([])
  })

  it('contains no WASM binary and no engine dependency', () => {
    // The acceptance criterion of #76, stated as membership rather than as
    // weight: `pnpm size` would only notice an engine that broke 120 kB, and a
    // 5 kB module that fetches 32 MB of WASM at runtime passes that gate.
    const engines = [
      '@ffmpeg/core',
      '@ffmpeg/ffmpeg',
      'wasm-vips',
      'libheif-js',
      'pdfjs-dist',
      'pdf-lib',
      'mp4box',
      'fflate',
      'comlink',
    ]

    for (const engine of engines) {
      expect(
        graph.packages.filter((name) => name === engine || name.startsWith(`${engine}/`)),
      ).toEqual([])
    }
  })

  it('costs exactly these runtime dependencies and no others', () => {
    // The list is pinned, not filtered. Adding a package here is a decision
    // about every visitor's first paint, and it should read like one in the
    // diff. `next/*` and `react` are the framework; the other three are the
    // 3 kB of class-name plumbing every component on every page uses.
    expect(graph.packages).toEqual([
      'class-variance-authority',
      'clsx',
      'next/dynamic',
      'next/font/local',
      'next/navigation',
      'radix-ui',
      'react',
      'tailwind-merge',
    ])
  })

  it('reaches the converter only through a dynamic import', () => {
    // The island is the boundary. Everything behind it — the queue, the worker
    // client, the router, and through the router every engine descriptor — is
    // in a chunk that is fetched after the page has rendered.
    expect(graph.files).toContain('components/converter/converter-island.tsx')
    expect(graph.files).not.toContain('components/converter/converter.tsx')
    expect(graph.files).not.toContain('lib/worker/client.ts')
    expect(graph.files).not.toContain('lib/router/route.ts')
  })
})
