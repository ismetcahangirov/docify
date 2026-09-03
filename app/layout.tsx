import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN } from '@/lib/seo/site'

import { fontVariables } from './fonts'

import './globals.css'

/*
 * `metadataBase` is what turns every relative URL Next.js generates into an
 * absolute one — the Open Graph image most of all. `og:image` must be absolute
 * or no crawler can fetch it, and without this the build emits `/opengraph-image
 * .png` and a warning nobody reads. It is the same literal the canonical URLs
 * are built from, for the reason `lib/seo/site.ts` gives about deployments.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The font variables live on <html> rather than <body> so that the theme
    // tokens in app/globals.css — which are declared on :root — can resolve them.
    //
    // The body's own colours are tokens rather than Tailwind's palette for the
    // same reason every other surface's are, plus one that only shows up in an
    // audit: Tailwind v4 emits its built-in palette as `oklch()`, and axe-core
    // cannot compute a contrast ratio from a colour it cannot parse. Text over
    // an oklch background is not reported as failing — it is reported as
    // *unknown*, which is the one answer an accessibility audit cannot use.
    <html lang="en" className={fontVariables}>
      <body className="min-h-dvh bg-shell text-fg-light antialiased">{children}</body>
    </html>
  )
}
