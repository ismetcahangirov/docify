import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * The URL proxy's package manifest, checked for sufficiency (issue #305).
 *
 * ## What this is really testing
 *
 * That the service can be built by somebody standing in its own directory.
 *
 * Nowhere else does that. A developer machine and all five CI jobs run from the
 * repository root, where `node_modules/@types/node` exists for the Next.js app,
 * and TypeScript finds `@types/*` by walking upward — so the service's source
 * compiles against types no file of its own declares, and everything passes.
 *
 * `render.yaml` sets `rootDir: services/url-proxy`. Render builds inside that
 * directory with nothing above it, which is the first place the manifest is
 * asked to be true rather than merely convenient. It was not: the first deploy
 * failed in eight seconds with twenty-one `TS2307: Cannot find module
 * 'node:http'`-shaped errors, after `npm install --include=dev` reported
 * "added 1 package".
 *
 * ## Why it derives the requirement instead of asserting it
 *
 * `expect(devDependencies).toHaveProperty('@types/node')` would have caught
 * this one and nothing after it. The rule that actually holds is conditional —
 * source that imports a Node builtin needs the types for Node — so the test
 * reads the imports and applies it. The tenth builtin import cannot reintroduce
 * the bug, and a service that stopped importing them would not be held to a
 * dependency it no longer needs.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const service = join(repoRoot, 'services', 'url-proxy')

interface Manifest {
  engines?: { node?: string }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const manifest = JSON.parse(readFileSync(join(service, 'package.json'), 'utf8')) as Manifest

/** `from 'node:http'`, `import('node:dns')` — the specifier is what matters, not the form. */
const BUILTIN = /['"]node:[a-z/]+['"]/g

function builtinsImported(): string[] {
  const dir = join(service, 'src')
  const found = new Set<string>()

  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    if (!entry.endsWith('.ts')) continue

    for (const match of readFileSync(join(dir, entry), 'utf8').matchAll(BUILTIN)) {
      found.add(match[0].slice(1, -1))
    }
  }

  return [...found].sort()
}

describe('services/url-proxy/package.json', () => {
  it('declares the types for every Node builtin its source imports', () => {
    const builtins = builtinsImported()
    const declared = { ...manifest.dependencies, ...manifest.devDependencies }

    // Guard: an empty list would make the assertion below vacuously true.
    expect(builtins.length).toBeGreaterThan(0)
    expect(builtins.every((name) => name.startsWith('node:'))).toBe(true)

    expect(
      builtins.length > 0 && !('@types/node' in declared)
        ? `imports ${builtins.join(', ')} but declares no @types/node`
        : null,
    ).toBeNull()
  })

  it('pins those types to the major version its engines field requires', () => {
    const types = manifest.devDependencies?.['@types/node']
    const engines = manifest.engines?.node

    expect(types).toBeDefined()
    expect(engines).toBeDefined()

    // `>=22` and `^22.x` — the types should describe the runtime the service
    // says it needs, not some other Node.
    const wanted = /(\d+)/.exec(engines ?? '')?.[1]
    expect(types).toContain(`${wanted}.`)
  })

  it('still has no runtime dependencies, which is a claim its README makes', () => {
    expect(manifest.dependencies ?? {}).toEqual({})
  })
})
