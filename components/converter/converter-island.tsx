'use client'

import dynamic from 'next/dynamic'

import type { ConversionPair } from '@/lib/registry/pairs'

/*
 * The boundary between the static page and the part of it that runs.
 *
 * A conversion page is almost entirely server-rendered HTML — the heading, the
 * explanation, the steps, the questions, the links. The converter is the one
 * piece that has to hydrate, and at 36 kB gzipped it was, on its own, most of
 * the difference between a page inside the 120 kB first-load budget and one 19
 * kB outside it.
 *
 * ## Why deferring it is a real improvement and not a way to move the number
 *
 * The static content is what a reader sees first, what a crawler reads, and
 * where the largest contentful paint lands. Putting 36 kB of file-queue
 * machinery in front of it delays all three to no purpose: the converter cannot
 * do anything until somebody drops a file on it, which is several seconds after
 * the page has painted at the very best. Loading it in parallel rather than in
 * front costs the user nothing and gets the words on screen sooner.
 *
 * ## Why `ssr: false`
 *
 * The component renders an empty queue on the server and then throws it away —
 * there are no files until a browser has one. Rendering it twice for that is
 * work, and `probeCapabilities()` cannot run there in any case.
 *
 * ## Why there is a skeleton and why it is exactly this tall
 *
 * A component that appears after the first paint pushes everything below it
 * down, which is precisely the layout shift EPIC 9 sets a budget for. The
 * placeholder occupies the dropzone's own `min-h-52` box with the same padding
 * and the same border, so the arrival of the real thing moves nothing.
 */

const Converter = dynamic(async () => (await import('./converter')).Converter, {
  ssr: false,
  loading: () => <ConverterSkeleton />,
})

export interface ConverterIslandProps {
  pair: ConversionPair
}

function ConverterIsland({ pair }: ConverterIslandProps) {
  return <Converter pair={pair} />
}

/**
 * The dropzone's shape, before the dropzone exists.
 *
 * Deliberately not animated: it is on screen for a fraction of a second, and a
 * spinner in that window reads as the page being slower rather than faster.
 * `aria-hidden`, because there is nothing here for a screen reader to do — the
 * real zone carries its own label and arrives with it.
 */
function ConverterSkeleton() {
  return (
    <div
      data-slot="converter-skeleton"
      aria-hidden="true"
      className={[
        'flex min-h-52 w-full min-w-0 flex-col items-center justify-center gap-4',
        'rounded-lg border border-line-dark bg-ink-2 p-8 text-center sm:p-12',
        'font-sans text-body text-fg-dark-mut',
      ].join(' ')}
    >
      <span className="size-11 rounded-full border border-current opacity-40" />
      <span>Preparing the converter</span>
    </div>
  )
}

export { ConverterIsland, ConverterSkeleton }
