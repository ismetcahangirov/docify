import type { NextConfig } from 'next'

/**
 * Cross-origin isolation is what unlocks `SharedArrayBuffer`, and therefore
 * multi-threaded `ffmpeg.wasm`. The capability router reads `crossOriginIsolated`
 * and falls back to a single-threaded path with a `NO_ISOLATION` warning when it
 * is false.
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

/** Only these route groups become cross-origin isolated. */
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
  async headers() {
    return [
      ...ISOLATED_ROUTES.map((source) => ({ source, headers: CROSS_ORIGIN_ISOLATION_HEADERS })),
      ...ISOLATED_ASSET_ROUTES.map((source) => ({ source, headers: ISOLATED_ASSET_HEADERS })),
    ]
  },
}

export default nextConfig
