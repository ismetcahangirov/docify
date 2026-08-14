// @vitest-environment node
//
// CLAUDE.md §2.3 for the HEIC engine, asserted against the source on disk.
//
// libheif ships as a 1.4 MB JavaScript bundle with the WASM binary embedded in
// it, so a single static `import 'libheif-js/...'` anywhere on the path from a
// page to the registry would put the whole thing in a route's first-load
// JavaScript. `pnpm size` catches that eventually and expensively, after a
// production build; this catches it in milliseconds and says which module did
// it.
//
// The walker is `test/worker/import-graph.ts`, the same one the worker shell's
// own guard uses: it follows static imports and cuts at every `await import()`,
// exactly where a bundler cuts a chunk.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { staticGraphOf, valueImportsOf } from '../worker/import-graph'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const REGISTRY = 'lib/engines/registry.ts'
const ENGINE = 'lib/engines/heif.ts'
const DECODE = 'lib/engines/heif-decode.ts'

const registryGraph = staticGraphOf(REGISTRY, repoRoot)
const engineGraph = staticGraphOf(ENGINE, repoRoot)

/** Anything whose presence in a page chunk would mean the WASM bundle leaked. */
const HEAVY_PACKAGE = /heif|heic|wasm/i

describe('the engine registry', () => {
  it('was walked at all — the assertions below pass on an empty graph', () => {
    expect(registryGraph.files).toContain(ENGINE)
  })

  it('reaches libheif through no static import, so the router costs a page nothing', () => {
    expect(registryGraph.packages.filter((name) => HEAVY_PACKAGE.test(name))).toEqual([])
  })

  it('costs a page no runtime dependency at all', () => {
    expect(registryGraph.packages).toEqual([])
  })
})

describe('the heif engine module', () => {
  it('reaches libheif through no static import either', () => {
    expect(engineGraph.packages.filter((name) => HEAVY_PACKAGE.test(name))).toEqual([])
  })

  it('names libheif only inside a dynamic import, which is the bundler chunk boundary', () => {
    const source = readFileSync(join(repoRoot, DECODE), 'utf8')

    expect(valueImportsOf(source).filter((name) => HEAVY_PACKAGE.test(name))).toEqual([])
    expect(source).toMatch(/await import\(\s*'libheif-js\//)
  })
})

describe('the worker runner loader', () => {
  it('reaches the heif engine through a dynamic import, not a static one', () => {
    const source = readFileSync(join(repoRoot, 'lib/worker/api.ts'), 'utf8')

    expect(source).toMatch(/import\(\s*'@\/lib\/engines\/heif'\s*\)/)
    expect(valueImportsOf(source)).not.toContain('@/lib/engines/heif')
  })
})
