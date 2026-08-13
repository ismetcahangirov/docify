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
  async headers() {
    return ISOLATED_ROUTES.map((source) => ({
      source,
      headers: CROSS_ORIGIN_ISOLATION_HEADERS,
    }))
  },
}

export default nextConfig
