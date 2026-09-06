import type { NextConfig } from 'next'

/**
 * Cross-origin isolation is what unlocks `SharedArrayBuffer`, and therefore the
 * multi-threaded engine builds. The capability router reads
 * `crossOriginIsolated` and routes around the engines that need it when it is
 * false. The vendored ffmpeg core is not one of them: it is built
 * `--disable-pthreads` and runs on one core either way, so its `NO_ISOLATION`
 * warning is about that build and not about these headers.
 *
 * `Cross-Origin-Embedder-Policy: require-corp` blocks every cross-origin
 * subresource that does not explicitly opt in, so it is scoped to the converter
 * routes only. Marketing pages must stay un-isolated so third-party resources
 * keep loading.
 *
 * These headers are evaluated when the document is created, so a `next/link`
 * soft navigation carries the previous page's isolation across the boundary.
 * Links between marketing and converter routes must be plain `<a href>`.
 */
const CROSS_ORIGIN_ISOLATION_HEADERS = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
]

/**
 * Only these route groups become cross-origin isolated.
 *
 * `/tools` is reserved for the tool pages the plan puts there. Until they land
 * it is a `noindex` placeholder, and it stays listed here so the headers are
 * already in place — and already exercised — on the day the real pages arrive.
 */
const ISOLATED_ROUTES = ['/convert/:path*', '/tools/:path*']

/**
 * What an isolated document is allowed to load.
 *
 * `require-corp` does not only block *cross-origin* subresources. A dedicated
 * worker is held to the owner document's policy, and Chromium refuses to start
 * one whose script was served without a matching `Cross-Origin-Embedder-Policy`
 * — same origin or not. Without these headers every conversion page loaded, and
 * rendered, and then answered a dropped file with a job stuck on "Waiting" and
 * one line in the console: the worker chunk came back `ERR_BLOCKED_BY_RESPONSE`
 * and the engines were unreachable. Nothing in the unit suites could see it:
 * jsdom has no COEP and no worker, and the e2e suites never dropped a file.
 *
 * `Cross-Origin-Resource-Policy: same-origin` is the other half. It is what an
 * isolated document needs in order to fetch the WASM binaries under
 * `/vendor/`, which `pnpm vendor` copies out of node_modules and which are
 * fetched by URL rather than bundled.
 *
 * Both are applied to assets, never to a document: a `Cross-Origin-Opener-Policy`
 * belongs on the page and is deliberately not repeated here.
 */
const ISOLATED_ASSET_HEADERS = [
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
]

/** Everything an isolated page fetches: its own chunks, and the vendored engines. */
const ISOLATED_ASSET_ROUTES = ['/_next/static/:path*', '/vendor/:path*']

/**
 * The slice of webpack's configuration this repository sets.
 *
 * Next types the `webpack` hook's argument as `any`; naming the two fields that
 * are touched keeps that `any` out of this file.
 */
type SnapshotMode = { hash?: boolean; timestamp?: boolean }

type WebpackSnapshotConfig = {
  snapshot?: {
    buildDependencies?: SnapshotMode
    /** `PackFileCachePlugin` snapshots these separately, with the same defaults. */
    resolveBuildDependencies?: SnapshotMode
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /*
   * Docify has no server-side image pipeline, so it does not have Next's one
   * either. `sharp` — the native binding that backs `/_next/image` — is denied
   * in `pnpm-workspace.yaml`, and this is the other half of that decision
   * (issue #114): with the optimiser off, the route is not served at all and a
   * `next/image` added later fails visibly here rather than at runtime on a
   * deployment.
   *
   * It changes nothing today. Nothing in the tree imports `next/image`, and
   * `next/og` — which does render the Open Graph cards — rasterises with satori
   * and resvg-wasm and never touches sharp.
   */
  images: { unoptimized: true },
  /*
   * `radix-ui` is an umbrella package that re-exports every primitive from one
   * barrel, and a bundler that cannot see through it ships all of them. The
   * cost is not theoretical: importing `Slot` alone for `SectionBlock` added
   * 76 kB gzipped to the first load of every route that used it, which is most
   * of the 120 kB budget spent on one polymorphic wrapper.
   *
   * `optimizePackageImports` rewrites the barrel import into a direct one at
   * build time. `lucide-react` is already on Next's own default list; naming it
   * here as well makes the intent explicit rather than dependent on that list
   * staying as it is.
   */
  experimental: {
    optimizePackageImports: ['radix-ui', 'lucide-react'],
  },
  /*
   * Issue #260, and a correction to what the first version of this comment
   * claimed.
   *
   * `pnpm build` died on the Windows development machine with `TypeError:
   * Cannot read properties of undefined (reading 'length')` raised inside
   * webpack's `WasmHash`. The stack made that look like a Node 24 WebAssembly
   * incompatibility; it is not a Node version problem at all. `hash.update()`
   * was handed `undefined`, by this route:
   *
   * 1. pnpm links each package into `node_modules/` as an NTFS *junction* on
   *    Windows, and `fs.readlink()` on a junction returns an *absolute* target.
   *    On Linux pnpm writes a *relative* symlink.
   * 2. webpack joins that target onto the link's own directory with
   *    `path.win32.join`, which appends an absolute second argument instead of
   *    taking it whole. The target becomes `<repo>
ode_modules\` with
   *    `C:\<repo>
ode_modules\.pnpm
ext@…` stuck on the end — a directory
   *    that does not exist.
   * 3. Reading a directory that is not there stores `null` under both
   *    `_contextTimestamps` and `_contextHashes`.
   * 4. `_readContextTimestampAndHash` merges the pair as `{ ...null, ...null }`,
   *    which is `{}`.
   * 5. `{}` walks through the `if (entry)` guard in `_resolveContextTsh`, and
   *    `entry.hash` — `undefined` — reaches the hash.
   *
   * ## The precondition the first version of this comment left out
   *
   * Step 4 needs *both* maps to already hold an entry for that path, and on a
   * cold cache neither does. The junction is present on every Windows build;
   * the crash also needs a persistent cache that was populated across the
   * separate timestamp and hash snapshots. A `rm -rf .next` cures it, which is
   * what `.claude/memory/entries/parallel-agent-coordination.md` had already
   * recorded before this issue was opened.
   *
   * So this is a *latent* fault made unreachable, not a build that could not
   * otherwise run: `main` builds cold and warm on Windows with this hook
   * removed.
   *
   * ## What this hook does, including the part that is not the option
   *
   * Step 4 is the only step reachable from configuration, and it is reached
   * only when a snapshot is taken by timestamp *and* hash — webpack's default.
   * The hash-only resolver applies the same `if (entry)` guard to a `null` that
   * was never merged into `{}`, so hash-only cannot produce the fault. Both
   * snapshot families are set, because `PackFileCachePlugin` takes two and
   * setting one would leave the other on the default.
   *
   * Merely *having* a `webpack` hook also changes two things in Next's own
   * config (`next/dist/build/webpack-config.js`): `webpack: !!config.webpack`
   * feeds `cache.version`, so adding it invalidated the existing pack once, and
   * `next.config.ts` is added to `cache.buildDependencies.config`. The first of
   * those is the same cure as deleting `.next`, and it is honest to say that it
   * — rather than the option below — is what cleared the poisoned cache on the
   * machine where this was found.
   *
   * Nothing about the emitted bundle changes either way: these options decide
   * when webpack's persistent cache is invalidated, not what is compiled.
   * Hashing rather than trusting mtimes is also the stricter of the two, and
   * measured at roughly no steady-state cost.
   */
  webpack(config: WebpackSnapshotConfig) {
    const byHashAlone = { hash: true, timestamp: false }

    config.snapshot = {
      ...config.snapshot,
      buildDependencies: byHashAlone,
      resolveBuildDependencies: byHashAlone,
    }
    return config
  },
  async headers() {
    return [
      ...ISOLATED_ROUTES.map((source) => ({ source, headers: CROSS_ORIGIN_ISOLATION_HEADERS })),
      ...ISOLATED_ASSET_ROUTES.map((source) => ({ source, headers: ISOLATED_ASSET_HEADERS })),
    ]
  },
}

export default nextConfig
