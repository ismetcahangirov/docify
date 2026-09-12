import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SITE_ORIGIN } from '@/lib/seo/site'

/*
 * The site origin, checked for leaks (issue #303).
 *
 * ## What this protects
 *
 * `lib/seo/site.ts` gives the reason the origin is a literal: one constant, so
 * a canonical tag and an `og:url` for the same page cannot disagree. That
 * argument holds only while the constant is the *only* place the address is
 * written down. A second copy — in a module, in a script, in a doc comment
 * explaining what the first one resolves to — is a copy nobody thinks to change,
 * and the whole point of the design is that there is nothing to remember.
 *
 * The value itself is not eternal. It moved once already, from a paid domain to
 * the free subdomain the deployment actually answers on, and the cost of that
 * move is exactly the number of places the old string had reached.
 *
 * ## Why the comments count
 *
 * `scripts/seo-audit/rules.mjs` held the origin twice, in prose describing what
 * Next.js resolves `metadataBase` down to. Nothing executes a comment, so
 * nothing failed when it went stale — it simply became a paragraph that tells
 * the next reader a confident and wrong thing about where the site lives.
 *
 * ## What is deliberately out of scope
 *
 * `render.yaml` *must* carry the origin: it is the proxy's allowlist, read by
 * another host entirely. `test/services/url-proxy/render-blueprint.test.ts`
 * asserts it matches this constant, which is the same guarantee reached from the
 * other end.
 *
 * Fixtures under `test/` are not scanned. A synthetic page in an audit test
 * needs *an* origin, and the one it uses is arbitrary by design.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Everything that ships or builds. */
const SOURCE_DIRS = ['app', 'lib', 'components', 'scripts']

/** The one file allowed to say it. */
const DECLARATION = 'lib/seo/site.ts'

const CODE = /\.(ts|tsx|mjs)$/

function sourceFiles(): string[] {
  return SOURCE_DIRS.flatMap((dir) =>
    (readdirSync(join(repoRoot, dir), { recursive: true }) as string[])
      .filter((entry) => CODE.test(entry))
      .map((entry) => [dir, ...entry.split(sep)].join('/')),
  )
}

describe('SITE_ORIGIN', () => {
  it('is written down in exactly one file', () => {
    const holders = sourceFiles().filter((file) =>
      readFileSync(join(repoRoot, file), 'utf8').includes(SITE_ORIGIN),
    )

    expect(holders).toEqual([DECLARATION])
  })

  it('scans a source tree that is actually there', () => {
    expect(sourceFiles()).toContain(DECLARATION)
    expect(sourceFiles().length).toBeGreaterThan(50)
  })
})
