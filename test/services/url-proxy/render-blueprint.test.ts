import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SITE_ORIGIN } from '@/lib/seo/site'

/*
 * `render.yaml`, checked against the service it deploys (issue #100).
 *
 * ## Why this is a test and not a comment in the blueprint
 *
 * A deployment descriptor is the one file whose mistakes are invisible until
 * production. Every value below is a claim about something that lives in a
 * different file — the path `proxy.ts` answers health checks on, the script
 * `package.json` declares, the origin `lib/seo/site.ts` says the app is served
 * from — and each of those can be renamed by somebody who has no reason to open
 * a YAML file at the repository root.
 *
 * The failure modes are not subtle, and they are all silent from inside the
 * repository:
 *
 *   healthCheckPath  wrong → Render restarts a healthy service in a loop
 *   ALLOWED_ORIGINS  wrong → every import is a 403, and the browser says
 *                            nothing more useful than "failed to fetch"
 *   ALLOWED_ORIGINS  empty → the same, because empty means nobody by design
 *   buildCommand     wrong → no TypeScript on the deploy, no `dist/`, no boot
 *
 * So the blueprint is read as text and compared with its sources. What is not
 * asserted is the plan, the region and the service name: those are operational
 * choices that should be changeable without a test telling somebody they are
 * wrong.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const blueprint = readFileSync(join(repoRoot, 'render.yaml'), 'utf8')
const proxySource = readFileSync(join(repoRoot, 'services', 'url-proxy', 'src', 'proxy.ts'), 'utf8')
const servicePackage: { scripts: Record<string, string> } = JSON.parse(
  readFileSync(join(repoRoot, 'services', 'url-proxy', 'package.json'), 'utf8'),
)

/** One top-level-ish key's value from the blueprint, unquoted. */
function value(key: string): string | undefined {
  for (const line of blueprint.split('\n')) {
    const trimmed = line.trim().replace(/^-\s*/, '')
    if (!trimmed.startsWith(`${key}:`)) continue

    return trimmed
      .slice(key.length + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
  }

  return undefined
}

/**
 * The value of one `envVars` entry, which is a `key:`/`value:` pair.
 *
 * Scanned line by line rather than matched with a pattern, for the reason the
 * comparable helpers in `test/ci/artifact-uploads.test.ts` and
 * `scripts/seo-audit/rules.mjs` give: the repository has no YAML parser, and one
 * bought for a single assertion is a dependency in the supply chain of a service
 * whose entire selling point is not having one.
 */
function envVar(name: string): string | undefined {
  const lines = blueprint.split('\n').map((line) => line.trim())
  const at = lines.indexOf(`- key: ${name}`)
  if (at === -1) return undefined

  const next = lines[at + 1] ?? ''
  if (!next.startsWith('value:')) return undefined

  return next
    .slice('value:'.length)
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

describe('render.yaml', () => {
  it('deploys the url-proxy service and not the application', () => {
    // The app is on Vercel. A blueprint that built the repository root would
    // deploy a second, unwanted copy of it.
    expect(value('rootDir')).toBe('services/url-proxy')
  })

  it('polls the path the proxy actually answers health checks on', () => {
    const served = proxySource.match(/const HEALTH_PATH = '([^']+)'/)?.[1]

    expect(served).toBeDefined()
    expect(value('healthCheckPath')).toBe(served)
  })

  it('starts the service with the script its package.json declares', () => {
    expect(servicePackage.scripts.start).toBeDefined()
    expect(value('startCommand')).toBe('npm start')
  })

  it('installs devDependencies before building', () => {
    // Render sets NODE_ENV=production, and `npm install` under that skips
    // devDependencies — where `typescript` is. Without the flag the build
    // succeeds locally, fails on Render, and fails with "tsc: not found".
    expect(servicePackage.scripts.build).toBeDefined()
    expect(value('buildCommand')).toContain('--include=dev')
    expect(value('buildCommand')).toContain('npm run build')
  })

  it('allows exactly the origin the application is served from', () => {
    // `ALLOWED_ORIGINS` empty means nobody (services/url-proxy/src/config.ts),
    // which is the safe default and a dead service if it reaches production.
    const origins = envVar('ALLOWED_ORIGINS')

    expect(origins).toBeDefined()
    expect(origins?.split(',').map((origin) => origin.trim())).toContain(SITE_ORIGIN)
  })

  it('pins a Node version the service supports', () => {
    const declared = envVar('NODE_VERSION')
    const required: { engines: { node: string } } = JSON.parse(
      readFileSync(join(repoRoot, 'services', 'url-proxy', 'package.json'), 'utf8'),
    )

    expect(declared).toBeDefined()
    expect(Number(declared)).toBeGreaterThanOrEqual(
      Number(required.engines.node.replace(/[^\d]/g, '')),
    )
  })
})
