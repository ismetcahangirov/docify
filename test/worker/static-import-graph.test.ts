/**
 * Guards CLAUDE.md §2.3 at the module-graph level: no engine and no WASM binary
 * may be reachable from the worker entry through a *static* import.
 *
 * A bundler decides what lands in a chunk by following static imports and
 * cutting the graph at every `await import()`. `./import-graph` does the same
 * walk over the source on disk, so an accidental `import { createRunner } from
 * './ffmpeg'` fails here — in milliseconds, with a readable message — instead
 * of showing up later as a 32 MB regression in `pnpm size`.
 *
 * Type-only imports are skipped because TypeScript erases them; they cost
 * nothing at runtime and are the intended way for the worker to talk about
 * engines without loading one.
 *
 * The first block below tests the walker rather than the worker. A guard that
 * silently returns an empty graph passes every assertion made against it, so
 * the shapes most likely to hide a leak are pinned explicitly.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { staticGraphOf, valueImportsOf } from './import-graph'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const WORKER_ENTRY = 'lib/worker/conversion.worker.ts'
const CLIENT = 'lib/worker/client.ts'

/** Anything whose presence in the worker chunk would mean an engine leaked in. */
const HEAVY_PACKAGE = /wasm|ffmpeg|vips|heif|heic|pdf|mp4box|fflate|libarchive|canvas|jszip/i

const workerGraph = staticGraphOf(WORKER_ENTRY, repoRoot)
const clientGraph = staticGraphOf(CLIENT, repoRoot)

describe('the walker, on the shapes that could hide a leak', () => {
  const LEAK = './engines/ffmpeg'

  it('sees a value re-export that follows a multi-line type-only export', () => {
    const source = [
      'export type EngineId =',
      "  | 'canvas'",
      "  | 'ffmpeg'",
      `export { runner } from '${LEAK}'`,
    ].join('\n')

    expect(valueImportsOf(source)).toEqual([LEAK])
  })

  it('sees an import that follows a type alias', () => {
    const source = ['export type Foo = { a: 1 }', `import ffmpeg from '${LEAK}'`].join('\n')

    expect(valueImportsOf(source)).toEqual([LEAK])
  })

  it('is not fooled by comment delimiters inside string literals', () => {
    const source = ["const a = '/*'", `import ffmpeg from '${LEAK}'`, "const b = '*/'"].join('\n')

    expect(valueImportsOf(source)).toEqual([LEAK])
  })

  it('sees both imports when two share a line', () => {
    const source = `import a from 'comlink'; import b from '${LEAK}'`

    expect(valueImportsOf(source)).toEqual(['comlink', LEAK])
  })

  it('sees an import written without whitespace', () => {
    expect(valueImportsOf(`import{runner}from'${LEAK}'`)).toEqual([LEAK])
  })

  it('drops type-only imports and exports, which tsc erases', () => {
    const source = [`import type { A } from '${LEAK}'`, `export type { B } from '${LEAK}'`].join(
      '\n',
    )

    expect(valueImportsOf(source)).toEqual([])
  })

  it('ignores dynamic imports, which is where a bundler cuts the chunk', () => {
    const source = `const { createRunner } = await import('${LEAK}')`

    expect(valueImportsOf(source)).toEqual([])
  })

  it('ignores specifiers that only appear in comments', () => {
    const source = [`// import x from '${LEAK}'`, `/* import y from '${LEAK}' */`].join('\n')

    expect(valueImportsOf(source)).toEqual([])
  })

  it('keeps side-effect imports, which a bundler also follows', () => {
    expect(valueImportsOf(`import '${LEAK}'`)).toEqual([LEAK])
  })
})

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
  it('was walked at all — the assertions below pass on an empty graph', () => {
    expect(clientGraph.packages).toContain('comlink')
  })

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
