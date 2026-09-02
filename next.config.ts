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

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
    return ISOLATED_ROUTES.map((source) => ({
      source,
      headers: CROSS_ORIGIN_ISOLATION_HEADERS,
    }))
  },
}

export default nextConfig
