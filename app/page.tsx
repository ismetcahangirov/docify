import type { Metadata } from 'next'

import { OG_SIZE, siteCard, siteImageUrl } from '@/lib/seo/og'
import { absoluteUrl, SITE_NAME } from '@/lib/seo/site'

const TITLE = `${SITE_NAME} — Convert Any File, Entirely In Your Browser`

/*
 * 156 characters, which is inside the window a search result shows as written.
 * The root layout's own description is the fallback for pages that declare
 * none; this page declares its own, because the home page is the one result
 * somebody sees when they search the brand.
 */
const DESCRIPTION =
  'Convert images, video, audio and PDFs without uploading a byte. Every conversion runs ' +
  'inside your own browser — free, no sign-up, and no limit on file size.'

const IMAGES = [
  {
    url: siteImageUrl(),
    width: OG_SIZE.width,
    height: OG_SIZE.height,
    alt: siteCard().alt,
  },
]

/*
 * Declared rather than inherited, and the `images` most of all: a page that
 * declares an `openGraph` object does not get `app/opengraph-image.tsx` merged
 * into it, and the canonical tag does not exist at all unless a page asks for
 * one. Both gaps were found by `pnpm audit:seo` reading the rendered HTML.
 */
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/'),
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    images: IMAGES,
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: IMAGES },
}

/*
 * The scaffold's placeholder home page, still waiting for the marketing
 * sections in EPIC 2.
 *
 * Its colours are `@theme` tokens rather than Tailwind's own palette. That is
 * the house rule (CLAUDE.md §3) and it is also what makes the page auditable:
 * Tailwind v4 emits its built-in palette as `oklch()`, and axe-core cannot
 * compute a contrast ratio from a colour it cannot parse — it reported all
 * three paragraphs here as *unknown* rather than as passing or failing, which
 * is the one answer `e2e/a11y.spec.ts` cannot accept.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-24">
      {/*
       * The content sits on a `paper` surface rather than directly on the
       * shell, which is the design system's own pattern (flat fill, one
       * hairline) and is also what makes the muted text legal: `fg-light-mut`
       * on `shell` measures 4.41:1, just under the 4.5:1 AA needs, while the
       * same colour on `paper` measures 4.78:1. Muted text belongs on a
       * surface; the shell is the ground between them.
       */}
      <div className="flex flex-col gap-6 border border-line-light bg-paper p-8">
        <p className="text-eyebrow uppercase text-fg-light-mut">Docify</p>

        <h1 className="text-4xl uppercase leading-[0.95] tracking-[-0.02em] sm:text-6xl">
          Convert any file, entirely in your browser
        </h1>

        <p className="max-w-prose text-balance text-fg-light-mut">
          Scaffold placeholder. The design tokens, typography and marketing sections arrive with the
          design system; the conversion router and engines follow after that.
        </p>

        <div className="border border-line-light bg-paper-2 p-4">
          <p className="text-sm text-fg-light-mut">
            Nothing here talks to a server. Every conversion Docify ships will run on your own
            device.
          </p>
        </div>

        {/*
         * The one link on the page, and it is not decoration. A home page that
         * links nowhere is a dead end for a crawler that arrived at the root,
         * and the hub is what makes the other 124 pages reachable from it. A
         * plain anchor rather than `next/link`, because `/convert` is
         * cross-origin isolated — see the header of `next.config.ts`.
         */}
        <p className="text-body">
          <a
            href="/convert"
            className={[
              '-mx-2 inline-flex min-h-11 min-w-11 items-center px-2',
              'underline underline-offset-4',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
            ].join(' ')}
          >
            Browse every converter
          </a>
        </p>
      </div>
    </main>
  )
}
