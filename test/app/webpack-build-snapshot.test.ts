import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import nextConfig from '../../next.config'

/*
 * Issue #260: `pnpm build` crashed on the Windows dev machine, before a single
 * route was emitted, with
 *
 *   TypeError: Cannot read properties of undefined (reading 'length')
 *       at WasmHash._updateWithBuffer
 *
 * The stack points at webpack's hashing, which is why the crash was first read
 * as a Node 24 / WebAssembly incompatibility. It is neither. `hash.update()` was
 * handed `undefined`, and the chain that produces it is:
 *
 *  1. pnpm links each package into `node_modules/` as an NTFS *junction* on
 *     Windows, and `fs.readlink()` on a junction returns an *absolute* target.
 *     On Linux pnpm writes a relative symlink, which is why CI never sees this.
 *  2. webpack's `lstatReadlinkAbsolute` does `join(dirname(link), target)`, and
 *     `path.win32.join` appends an absolute second argument instead of taking
 *     it whole — so the target becomes `…\node_modules\C:\…\node_modules\next`,
 *     a path that does not exist.
 *  3. Reading a directory that does not exist stores `null` in both
 *     `_contextTimestamps` and `_contextHashes`.
 *  4. `_readContextTimestampAndHash` merges the two as `{ ...null, ...null }`,
 *     which is `{}` — an entry with no `hash`.
 *  5. `_resolveContextTsh` guards that entry with `if (entry)`, `{}` passes,
 *     and `undefined` reaches `hash.update()`.
 *
 * Step 4 is the only step reachable from our side. It runs only when the
 * build-dependency snapshot is taken by timestamp *and* hash, which is
 * webpack's default. The hash-only and timestamp-only resolvers guard the same
 * entry with `if (entry)` against a `null` that never became `{}`, so either one
 * alone is safe. `next.config.ts` asks for hash only.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const configSource = readFileSync(join(repoRoot, 'next.config.ts'), 'utf8')

/** The slice of webpack's configuration this repository touches. */
type SnapshotConfig = {
  snapshot?: { buildDependencies?: { hash?: boolean; timestamp?: boolean } }
}

/*
 * Next types the hook as `(config: any, context: WebpackConfigContext) => any`.
 * Nothing here reads the context, so it is called with the one argument it uses
 * and the result narrowed to the part under test.
 */
const applyWebpackConfig = nextConfig.webpack as unknown as (
  config: SnapshotConfig,
) => SnapshotConfig

describe('the webpack build-dependency snapshot', () => {
  it('is taken by content hash and not by timestamp', () => {
    const config = applyWebpackConfig({})

    expect(config.snapshot?.buildDependencies).toEqual({ hash: true, timestamp: false })
  })

  it('keeps the rest of the snapshot configuration Next assembled', () => {
    const config = applyWebpackConfig({
      snapshot: { buildDependencies: { hash: true, timestamp: true }, module: { timestamp: true } },
    } as SnapshotConfig)

    expect(config.snapshot).toMatchObject({ module: { timestamp: true } })
  })

  it('returns the same configuration object Next passed in', () => {
    const config: SnapshotConfig = {}

    expect(applyWebpackConfig(config)).toBe(config)
  })

  it('records why the snapshot is configured at all', () => {
    // A one-line override with no reason next to it is the kind of thing a
    // later cleanup deletes, and the crash comes back on the next Windows
    // checkout while CI stays green.
    expect(configSource).toMatch(/junction/i)
    expect(configSource).toMatch(/pnpm/)
    expect(configSource).toMatch(/#260/)
  })
})
