import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * `vercel.json`, checked against the repository it deploys (issue #99).
 *
 * ## Why there is a config file at all when Next.js on Vercel is zero-config
 *
 * Because one of the defaults is wrong here, and wrong in a way that produces a
 * *working* deployment.
 *
 * `pnpm build` is `pnpm vendor && next build`. The vendor step copies the
 * wasm-vips, pdf.js and ffmpeg binaries out of node_modules into `public/vendor/`,
 * which `.gitignore` deliberately keeps out of the history. A build that runs
 * `next build` on its own produces every page, passes every check a crawler
 * makes, and serves a converter whose engines 404 the first time somebody drops
 * a file. So the command is pinned rather than detected, and the test below is
 * what keeps it pinned to the same script the rest of the repository runs.
 *
 * ## What is deliberately not in that file
 *
 * Headers. `next.config.ts` sets COOP, COEP and CORP, scoped to the converter
 * routes and the assets they load, with several paragraphs about why each one
 * is there. A `headers` array in `vercel.json` would be a second source for the
 * same thing — and the platform's rules and the framework's rules do not merge
 * in a way anybody can predict from reading either file. One place, and a test
 * that says so.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

interface VercelConfig {
  framework?: string
  buildCommand?: string
  installCommand?: string
  regions?: string[]
  functions?: Record<string, { maxDuration?: number }>
  headers?: unknown
  redirects?: unknown
  rewrites?: unknown
}

const config: VercelConfig = JSON.parse(readFileSync(join(repoRoot, 'vercel.json'), 'utf8'))
const packageJson: { scripts: Record<string, string> } = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
)

describe('vercel.json', () => {
  it('builds with the script that vendors the engine binaries', () => {
    // The failure this prevents is a deployment that works everywhere except
    // the moment somebody drops a file: `public/vendor/` is gitignored and only
    // exists because `pnpm vendor` put it there.
    expect(config.buildCommand).toBe('pnpm build')
    expect(packageJson.scripts.build).toContain('pnpm vendor')
  })

  it('installs from the lockfile', () => {
    // The same argument CI makes with `--frozen-lockfile`: a deploy that
    // silently resolved a newer dependency is a deploy nobody can reproduce.
    expect(config.installCommand).toContain('--frozen-lockfile')
  })

  it('declares the framework rather than leaving it to detection', () => {
    expect(config.framework).toBe('nextjs')
  })

  it('does not set headers, redirects or rewrites', () => {
    // next.config.ts owns all three. Two sources for the isolation headers is
    // how a converter page loses `crossOriginIsolated` without anybody editing
    // the file that documents it.
    expect(config.headers).toBeUndefined()
    expect(config.redirects).toBeUndefined()
    expect(config.rewrites).toBeUndefined()
  })

  it('pins a single region', () => {
    // The site is static except for one counter route, so the region is really
    // a choice about where that route sits relative to the database. More than
    // one is also not available on the plan this deploys to.
    expect(config.regions).toHaveLength(1)
  })

  it('bounds every function it names, and names only routes that exist', () => {
    const functions = Object.entries(config.functions ?? {})

    expect(functions.length).toBeGreaterThan(0)

    for (const [path, settings] of functions) {
      expect(existsSync(join(repoRoot, path))).toBe(true)
      // The platform default is 300 seconds. Nothing here is a long-running
      // job: the one route increments a counter and answers 202, and a limit
      // that generous only decides how long a runaway invocation bills for.
      expect(settings.maxDuration).toBeLessThanOrEqual(15)
    }
  })
})
