import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * Docify has no server-side image pipeline, and issue #114 is about making that
 * true in the install rather than only in the prose.
 *
 * `sharp` is Next's *server-side* image optimisation binding. Nothing in this
 * repository uses `next/image`; the two Open Graph routes go through `next/og`,
 * which rasterises with satori and resvg-wasm and never touches sharp. Approving
 * its native build therefore bought a high-severity `pnpm audit --prod` finding
 * and a native compile in all five CI jobs, in exchange for nothing.
 *
 * pnpm 11 fails an install outright while a dependency's build script is neither
 * approved nor denied, so `pnpm-workspace.yaml` has to name it either way.
 * Denying is a decision, which is all pnpm requires — the install still exits 0.
 *
 * The three assertions below are one decision seen from three sides, and each
 * one is the place a future change would quietly undo it: the deny itself, the
 * `unoptimized` flag that makes the consequence visible where images are
 * configured, and the absence of the import that would need the optimiser back.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), 'utf8')

const workspace = read('pnpm-workspace.yaml')
const nextConfig = read('next.config.ts')

/** Every TypeScript source file under the shipped directories. */
function sourceFiles(directory: string): string[] {
  return readdirSync(join(repoRoot, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}

describe('the server-side image pipeline', () => {
  it('denies the sharp build script', () => {
    expect(workspace).toMatch(/^\s*sharp:\s*false\s*$/m)
  })

  it('still decides the other native build script rather than leaving it open', () => {
    // pnpm 11 refuses the install while any build script is undecided, so the
    // deny above only helps if every other entry stays explicit too.
    expect(workspace).toMatch(/^\s*unrs-resolver:\s*(true|false)\s*$/m)
  })

  it('records why sharp is denied, next to the deny', () => {
    expect(workspace).toMatch(/next\/image/)
    expect(workspace).toMatch(/GHSA-f88m-g3jw-g9cj/)
  })

  it('turns the built-in image optimiser off explicitly', () => {
    // Without this, the first `next/image` added to the tree would silently
    // want the binding back — at runtime, on Vercel, not in CI.
    expect(nextConfig).toMatch(/images:\s*\{\s*unoptimized:\s*true\s*\}/)
  })

  it('imports next/image nowhere', () => {
    const offenders = ['app', 'components', 'lib']
      .flatMap(sourceFiles)
      .filter((file) => /from\s+['"]next\/image['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repoRoot, file).split(sep).join('/'))

    expect(offenders).toEqual([])
  })
})
