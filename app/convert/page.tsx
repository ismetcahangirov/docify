import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Convert',
  robots: { index: false, follow: false },
}

/**
 * Placeholder. Exists so that the cross-origin isolation headers configured for
 * `/convert/:path*` can be exercised before the real converter pages land.
 */
export default function ConvertPlaceholderPage() {
  return <main>Converter routes are not implemented yet.</main>
}
