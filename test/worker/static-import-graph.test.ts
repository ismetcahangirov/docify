/**
 * Guards CLAUDE.md §2.3 at the module-graph level: no engine and no WASM binary
 * may be reachable from the worker entry through a *static* import.
 *
 * A bundler decides what lands in a chunk by following static imports and
 * cutting the graph at every `await import()`. This test does the same walk over
 * the source on disk, so an accidental `import { createRunner } from './ffmpeg'`
 * fails here — in milliseconds, with a readable message — instead of showing up
 * later as a 32 MB regression in `pnpm size`.
 *
 * Type-only imports are skipped because TypeScript erases them; they cost
 * nothing at runtime and are the intended way for the worker to talk about
 * engines without loading one.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const WORKER_ENTRY = 'lib/worker/conversion.worker.ts'
const CLIENT = 'lib/worker/client.ts'

/** Block comments and line comments, so prose about ffmpeg is not read as code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

/**
 * `import … from '…'` and `export … from '…'` at the start of a line, which is
 * where Prettier puts every one of them. `import type` / `export type` are
 * dropped: they leave no trace in the emitted JavaScript. `await import('…')`
 * is never matched, because it is never at the start of a line and never has a
 * `from` clause — which is exactly the cut a bundler makes.
 */
const FROM_IMPORT =
  /^[ \t]*(?:import|export)(?<typeOnly>[ \t]+type\b)?(?<clause>[^;]*?)[ \t]from[ \t]*['"](?<specifier>[^'"]+)['"]/gm

/** Side-effect imports: `import './polyfill'`. */
const BARE_IMPORT = /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm

function valueImportsOf(source: string): string[] {
  const code = stripComments(source)
  const specifiers: string[] = []

  for (const match of code.matchAll(FROM_IMPORT)) {
    if (match.groups?.typeOnly) continue
    specifiers.push(match.groups!.specifier)
  }
  for (const match of code.matchAll(BARE_IMPORT)) {
    specifiers.push(match[1])
  }

  return specifiers
}

/** Mirrors the `@/*` alias in tsconfig.json plus the extensions a bundler tries. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(repoRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(repoRoot, dirname(fromFile), specifier)
      : null

  if (base === null) return null

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return posix.join(...relative(repoRoot, candidate).split(/[\\/]/))
    }
  }

  throw new Error(`Cannot resolve "${specifier}" imported from ${fromFile}`)
}

interface Graph {
  /** Repo-relative paths of every local module a bundler would pull in. */
  files: string[]
  /** Bare specifiers — the npm packages that end up in the chunk. */
  packages: string[]
}

/** Transitive closure of the value imports reachable from `entry`. */
function staticGraphOf(entry: string): Graph {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (files.has(file)) continue
    files.add(file)

    for (const specifier of valueImportsOf(readFileSync(join(repoRoot, file), 'utf8'))) {
      const local = resolveLocal(specifier, file)
      if (local === null) packages.add(specifier)
      else queue.push(local)
    }
  }

  files.delete(entry)
  return { files: [...files].sort(), packages: [...packages].sort() }
}

/** Anything whose presence in the worker chunk would mean an engine leaked in. */
const HEAVY_PACKAGE = /wasm|ffmpeg|vips|heif|heic|pdf|mp4box|fflate|libarchive|canvas|jszip/i

const workerGraph = staticGraphOf(WORKER_ENTRY)
const clientGraph = staticGraphOf(CLIENT)

describe('the walker itself', () => {
  it('follows relative specifiers out of the entry', () => {
    expect(workerGraph.files).toContain('lib/worker/api.ts')
  })

  it('sees value imports of npm packages', () => {
    expect(workerGraph.packages).toContain('comlink')
  })

  it('erases type-only imports, exactly as tsc does', () => {
    expect(workerGraph.files).not.toContain('lib/router/types.ts')
    expect(workerGraph.files).not.toContain('lib/engines/types.ts')
  })
})

describe('the conversion worker entry', () => {
  it('reaches no engine module', () => {
    expect(workerGraph.files.filter((file) => file.startsWith('lib/engines/'))).toEqual([])
  })

  it('reaches no WASM or media package', () => {
    expect(workerGraph.packages.filter((name) => HEAVY_PACKAGE.test(name))).toEqual([])
  })

  it('costs exactly one runtime dependency', () => {
    expect(workerGraph.packages).toEqual(['comlink'])
  })
})

describe('the main-thread client', () => {
  it('never statically imports the worker entry, so it stays a separate chunk', () => {
    expect(clientGraph.files).not.toContain(WORKER_ENTRY)
  })

  it('reaches no engine and no WASM package either', () => {
    expect(clientGraph.files.filter((file) => file.startsWith('lib/engines/'))).toEqual([])
    expect(clientGraph.packages.filter((name) => HEAVY_PACKAGE.test(name))).toEqual([])
  })

  it('names the worker in the literal form Turbopack and webpack can statically resolve', () => {
    const source = readFileSync(join(repoRoot, CLIENT), 'utf8')

    expect(source).toMatch(
      /new Worker\(\s*new URL\(\s*'\.\/conversion\.worker\.ts',\s*import\.meta\.url,?\s*\)/,
    )
  })
})
