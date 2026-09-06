import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import nextConfig from '../../next.config'

/*
 * Issue #260, as corrected after review.
 *
 * `pnpm build` crashed on the Windows development machine with
 *
 *   TypeError: Cannot read properties of undefined (reading 'length')
 *       at WasmHash._updateWithBuffer
 *
 * The stack points at webpack's hashing, which is why it was first read as a
 * Node 24 / WebAssembly incompatibility. It is neither. `hash.update()` was
 * handed `undefined`:
 *
 *  1. pnpm links each package into `node_modules/` as an NTFS *junction* on
 *     Windows, and `fs.readlink()` on a junction returns an *absolute* target.
 *     On Linux pnpm writes a relative symlink.
 *  2. webpack's `lstatReadlinkAbsolute` does `join(dirname(link), target)`, and
 *     `path.win32.join` appends an absolute second argument instead of taking
 *     it whole — so the target becomes `…
ode_modules\C:\…
ode_modules
ext`,
 *     a path that does not exist.
 *  3. Reading a directory that is not there stores `null` in both
 *     `_contextTimestamps` and `_contextHashes`.
 *  4. `_readContextTimestampAndHash` merges the two as `{ ...null, ...null }`,
 *     which is `{}` — an entry with no `hash`.
 *  5. `_resolveContextTsh` guards that entry with `if (entry)`, `{}` passes,
 *     and `undefined` reaches `hash.update()`.
 *
 * ## What these tests can and cannot say
 *
 * Step 4 needs *both* maps to already hold the path, so the junction alone is
 * not enough — a populated persistent cache is the other half, and `main`
 * builds cold and warm on Windows without this configuration. So the option
 * below makes a latent fault unreachable rather than repairing a broken build,
 * and no unit test could have caught the original defect. What is asserted here
 * is only that the configuration says what it means to say, on both snapshot
 * families rather than one.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const configSource = readFileSync(join(repoRoot, 'next.config.ts'), 'utf8')

/** The slice of webpack's configuration this repository touches. */
type SnapshotMode = { hash?: boolean; timestamp?: boolean }

type SnapshotConfig = {
  snapshot?: { buildDependencies?: SnapshotMode; resolveBuildDependencies?: SnapshotMode }
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

  it('says the same thing about the resolve dependencies', () => {
    const config = applyWebpackConfig({})

    // `PackFileCachePlugin` snapshots these separately and with the same
    // defaults. Setting only the first would leave the identical merge
    // reachable through the second, and a comment claiming otherwise.
    expect(config.snapshot?.resolveBuildDependencies).toEqual({ hash: true, timestamp: false })
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
    // And the precondition, which the first version of that comment left out:
    // without a populated cache the junction alone does not crash a build, and
    // a reader who is not told that will draw the wrong conclusion twice.
    expect(configSource).toMatch(/cold cache|persistent cache/i)
  })
})
