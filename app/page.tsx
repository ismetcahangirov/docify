import type { Metadata } from 'next'
import type { LucideIcon } from 'lucide-react'
import {
  AudioLinesIcon,
  BadgeCheckIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  InfinityIcon,
  MonitorIcon,
  ShieldCheckIcon,
  ZapIcon,
} from 'lucide-react'

import { CapabilityStrip, type CapabilityItem } from '@/components/blocks/capability-strip'
import { FeatureCard } from '@/components/blocks/feature-card'
import { GridOverlay } from '@/components/blocks/grid-overlay'
import { SectionBlock } from '@/components/blocks/section-block'
import { StatPair } from '@/components/blocks/stat-pair'
import { Button } from '@/components/ui/button'
import { type FormatKind, formatMeta } from '@/lib/registry/formats'
import { type ConversionPair, PAIRS, pairTitle, popularPairs } from '@/lib/registry/pairs'
import { convertHref } from '@/lib/registry/slugs'
import { OG_SIZE, siteCard, siteImageUrl } from '@/lib/seo/og'
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from '@/lib/seo/site'

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
 * The home page (issue #267): the brand search result, and the root every other
 * page hangs off.
 *
 * ## Static, all of it
 *
 * Five blocks of server-rendered HTML and not one client component of its own.
 * The only JavaScript on the route is the layout's analytics beacon, which is
 * what keeps `/` far inside the first-load budget `pnpm size` enforces — and
 * what makes the page exist, whole, before any script runs.
 *
 * ## What the figures are, and are not
 *
 * The numbers in the fourth block come from the registry and from the
 * architecture: how many pairs have a page, and the two zeros the product is
 * built on. None of them is fetched. Live counts from `/api/stats` are a
 * separate feature with its own failure modes, and a home page that waited on
 * a request to say "0 uploads" would be making the claim conditional on a
 * server.
 *
 * ## Plain anchors, again
 *
 * Every link into `/convert` is an `<a>`, not `next/link`: the catalogue is
 * cross-origin isolated (see the header of `next.config.ts`), and a soft
 * navigation would carry this document's isolation across the boundary.
 */

/**
 * The kinds of file the catalogue converts, in the order the popular grid
 * shows them, with the glyph each one carries. `archive` is absent because no
 * archive pair is in high demand — a grid row for it would be empty.
 */
const KINDS: readonly { kind: FormatKind; icon: LucideIcon }[] = [
  { kind: 'image', icon: ImageIcon },
  { kind: 'document', icon: FileTextIcon },
  { kind: 'video', icon: FilmIcon },
  { kind: 'audio', icon: AudioLinesIcon },
]

/** Cards per kind in the popular grid: one row of four columns each. */
const PER_KIND = 3

/**
 * The popular pairs the first screen shows: the first few of each kind, in
 * catalogue order, so the grid reads as one row per kind of file rather than
 * as eleven image conversions followed by everything else.
 */
function featured(): readonly { pair: ConversionPair; icon: LucideIcon }[] {
  const popular = popularPairs()

  return KINDS.flatMap(({ kind, icon }) =>
    popular
      .filter((pair) => formatMeta(pair.from).kind === kind)
      .slice(0, PER_KIND)
      .map((pair) => ({ pair, icon })),
  )
}

const CAPABILITIES: readonly CapabilityItem[] = [
  { icon: MonitorIcon, label: 'Runs in your browser', detail: 'Nothing leaves the tab' },
  { icon: ShieldCheckIcon, label: 'No sign-up', detail: 'No account, no email' },
  { icon: InfinityIcon, label: 'No file limits', detail: 'Your memory is the ceiling' },
  { icon: ZapIcon, label: 'Hardware-accelerated', detail: 'Where the device has it' },
  { icon: BadgeCheckIcon, label: 'Free', detail: 'No plan, no watermark' },
]

const STEPS: readonly { title: string; body: string }[] = [
  {
    title: 'Drop a file',
    body: 'Drag it onto the page, or pick it from your device. Nothing is uploaded: the file is opened by your browser and stays in this tab.',
  },
  {
    title: 'It converts here',
    body: 'Your browser does the work. Docify measures the file against what your device can hold, picks the fastest engine it can run, and says so if it cannot.',
  },
  {
    title: 'Save the result',
    body: 'Download the converted file. Close the tab and there is no trace of either one left anywhere, because there was never a copy to delete.',
  },
]

const QUESTIONS: readonly { q: string; a: string }[] = [
  {
    q: 'Does Docify ever see my file?',
    a: 'No. The page you are reading is the last thing the server sends. The converter itself runs inside your browser, and the file is never transmitted — not to Docify, not to anyone. The only thing counted afterwards is that a conversion happened, as a format pair and a rough size band, with nothing from the file in it.',
  },
  {
    q: 'Is there a file size limit?',
    a: 'Not one Docify sets. The ceiling is the memory your device gives a browser tab, because that is where the work happens. Before anything starts, Docify measures the file against that ceiling and, if it will not fit, tells you the number and what to try instead — a desktop, or a lighter conversion.',
  },
  {
    q: 'Which formats does it handle?',
    a: `${PAIRS.length} pairs across images, PDFs, video and audio: phone photos in HEIC and AVIF, footage in MOV, MKV and WebM, recordings in FLAC, WAV and M4A, and PDFs to and from pictures and text. Every pair has a page of its own, and the catalogue lists them by the format you already have.`,
  },
  {
    q: 'What does it cost?',
    a: 'Nothing, and there is no account to make. The usual price of a converter pays for the servers that do the converting; Docify has none, because your device does it. There is no free tier with a paid one behind it, no watermark, and no daily allowance.',
  },
]

export default function HomePage() {
  const cards = featured()

  return (
    <main className="flex flex-col gap-6 py-6">
      {/*
       * The hero, and the one place the grid overlay is allowed. `relative`
       * and `overflow-hidden` are what the overlay's `absolute inset-0` sits
       * inside; the content is lifted above it with its own `relative`.
       */}
      <SectionBlock
        variant="dark"
        aria-labelledby="hero-heading"
        className="relative overflow-hidden"
      >
        <GridOverlay />
        <div className="relative flex min-w-0 flex-col gap-8 py-6 sm:py-12">
          <p className="text-eyebrow uppercase text-fg-dark-mut">File converter</p>
          <h1
            id="hero-heading"
            className="max-w-5xl text-display break-words hyphens-auto uppercase"
          >
            Convert any file, entirely in your browser
          </h1>
          <p className="max-w-2xl text-body text-fg-dark-mut">{SITE_DESCRIPTION}</p>
          <div>
            <Button asChild size="lg">
              <a href="/convert">Browse every converter</a>
            </Button>
          </div>
        </div>
      </SectionBlock>

      <SectionBlock
        variant="light"
        aria-labelledby="popular-heading"
        className="flex min-w-0 flex-col gap-8"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <h2 id="popular-heading" className="text-h2 uppercase">
            Popular converters
          </h2>
          <p className="max-w-2xl text-body text-fg-light-mut">
            The conversions people arrive with most: a photo the laptop will not open, a video the
            television will not play, a recording the wrong tool refuses. One row of each.
          </p>
        </div>

        <ul className="grid list-none grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(({ pair, icon }) => (
            <li key={pair.slug} className="min-w-0">
              {/*
               * The whole card is the link. An anchor around flow content is
               * valid HTML, and it is what gives the card a 44px-plus hit
               * area instead of a small underlined title inside a big box
               * that does nothing.
               */}
              <a
                href={convertHref(pair.from, pair.to)}
                className="block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
              >
                <FeatureCard icon={icon} title={pairTitle(pair)} className="h-full">
                  {formatMeta(pair.from).summary}
                </FeatureCard>
              </a>
            </li>
          ))}
        </ul>

        <p className="text-body">
          <a
            href="/convert"
            className={[
              '-mx-2 inline-flex min-h-11 items-center px-2',
              'underline underline-offset-4',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
            ].join(' ')}
          >
            See every converter, grouped by the format you have
          </a>
        </p>
      </SectionBlock>

      <SectionBlock
        variant="light"
        aria-labelledby="how-heading"
        className="flex min-w-0 flex-col gap-8"
      >
        <h2 id="how-heading" className="text-h2 uppercase">
          How it works
        </h2>

        {/*
         * An ordered list because the order is the information: these are
         * the three things that happen, in the order they happen. The marker
         * is set in the mono step because a step number is a technical
         * label, not a heading.
         */}
        <ol className="grid list-none grid-cols-1 gap-8 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex min-w-0 flex-col gap-3 border-t border-line-light pt-4"
            >
              <span className="font-mono text-tech text-fg-light-mut">0{index + 1}</span>
              <h3 className="text-h3">{step.title}</h3>
              <p className="text-body text-fg-light-mut">{step.body}</p>
            </li>
          ))}
        </ol>
      </SectionBlock>

      <SectionBlock
        variant="dark"
        aria-labelledby="facts-heading"
        className="flex min-w-0 flex-col gap-10"
      >
        <h2 id="facts-heading" className="max-w-4xl text-h2 uppercase">
          The whole converter, and none of the server
        </h2>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          <StatPair figure={PAIRS.length} caption="converters, each with a page of its own" />
          <StatPair figure="0" caption="uploads — no file has ever reached a server" />
          <StatPair figure="0" caption="accounts — nothing to sign up for or to leak" />
        </div>

        <CapabilityStrip
          items={CAPABILITIES}
          tone="dark"
          className="border-t border-line-dark pt-8"
        />
      </SectionBlock>

      <SectionBlock
        variant="light"
        aria-labelledby="faq-heading"
        className="flex min-w-0 flex-col gap-8"
      >
        <h2 id="faq-heading" className="text-h2 uppercase">
          Common questions
        </h2>

        <dl className="flex flex-col gap-8">
          {QUESTIONS.map((question) => (
            <div key={question.q} className="flex min-w-0 flex-col gap-2">
              <dt className="text-h3">{question.q}</dt>
              <dd className="max-w-3xl text-body text-fg-light-mut">{question.a}</dd>
            </div>
          ))}
        </dl>
      </SectionBlock>
    </main>
  )
}
