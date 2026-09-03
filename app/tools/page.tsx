import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Tools',
  robots: { index: false },
}

/**
 * Placeholder. Exists so that the cross-origin isolation headers configured for
 * `/tools/:path*` can be exercised before the real tool pages land.
 *
 * The real pages live at `/tools/[slug]`, so nothing in EPIC 8 replaces this
 * file — delete it there explicitly.
 */
export default function ToolsPlaceholderPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-24">
      <div className="flex flex-col gap-4 border border-line-light bg-paper p-8">
        {/*
         * A heading, because every document has one thing it is about and a
         * page with none is one a crawler, a screen reader and an outline view
         * all read as a fragment. `pnpm audit:seo` is what noticed; the page is
         * `noindex` and was skipped by everything that only looks at the
         * indexable surface.
         */}
        <h1 className="text-h2 uppercase">Tools</h1>
        <p className="text-body text-fg-light-mut">
          Tool routes are not implemented yet. The converters live under{' '}
          <a href="/convert" className="underline underline-offset-4">
            /convert
          </a>
          .
        </p>
      </div>
    </main>
  )
}
