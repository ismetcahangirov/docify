import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Tools',
  robots: { index: false, follow: false },
}

/**
 * Placeholder. Exists so that the cross-origin isolation headers configured for
 * `/tools/:path*` can be exercised before the real tool pages land.
 */
export default function ToolsPlaceholderPage() {
  return <main>Tool routes are not implemented yet.</main>
}
