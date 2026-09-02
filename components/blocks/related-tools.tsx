import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { formatMeta } from '@/lib/registry/formats'
import type { ConversionPair } from '@/lib/registry/pairs'
import { pairTitle } from '@/lib/registry/pairs'
import { relatedTo } from '@/lib/registry/related'
import { convertHref } from '@/lib/registry/slugs'
import { cn } from '@/lib/utils'

/*
 * The spokes, and the link back to the hub (issue #71).
 *
 * `lib/registry/related.ts` decides *which* conversions a page points at and
 * why; this decides how they read. Nothing here selects anything — a component
 * that filtered or reordered the list would be a second linking strategy
 * competing with the first, and the property the other module proves (that no
 * page is orphaned) would stop being true of what actually ships.
 *
 * ## Why every link names the whole conversion
 *
 * "HEIC to PNG", not "PNG" and not "this one". A list of six links read out of
 * context — by a screen reader working through them, or by a crawler weighing
 * anchor text — has to say where each one goes. Anchor text is also the single
 * strongest signal about the page at the other end, and six links all called
 * "convert" waste it entirely.
 *
 * ## Why these are plain anchors
 *
 * Converter routes are cross-origin isolated and a `next/link` soft navigation
 * carries the *previous* document's isolation across the boundary — see the
 * header of `next.config.ts`. A full document load is what guarantees the
 * destination evaluates its own headers, which for a page that is about to load
 * a WASM engine is the difference between a working converter and a broken one.
 */

const HUB_HREF = '/convert'

const sectionVariants = cva('flex min-w-0 flex-col gap-6 font-sans', {
  variants: {
    variant: {
      dark: 'text-fg-dark',
      light: 'text-fg-light',
    },
  },
  defaultVariants: { variant: 'light' },
})

const mutedVariants = cva('', {
  variants: { variant: { dark: 'text-fg-dark-mut', light: 'text-fg-light-mut' } },
  defaultVariants: { variant: 'light' },
})

const linkVariants = cva(
  [
    'flex min-w-0 flex-col gap-1 rounded-md border p-4',
    'text-body break-words transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
  ].join(' '),
  {
    variants: {
      variant: {
        dark: 'border-line-dark bg-ink-2 hover:bg-ink-3',
        light: 'border-line-light bg-paper hover:bg-paper-2',
      },
    },
    defaultVariants: { variant: 'light' },
  },
)

export type RelatedToolsProps = Omit<React.ComponentProps<'section'>, 'children'> &
  VariantProps<typeof sectionVariants> & {
    /** The page these links sit on. Its neighbours are derived, never passed in. */
    pair: ConversionPair
  }

function RelatedTools({ className, variant, pair, ...props }: RelatedToolsProps) {
  const headingId = React.useId()
  const links = relatedTo(pair)
  const muted = mutedVariants({ variant })

  return (
    <section
      data-slot="related-tools"
      aria-labelledby={headingId}
      className={cn(sectionVariants({ variant, className }))}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <p className={cn('text-eyebrow uppercase', muted)}>Related converters</p>
        <h2 id={headingId} className="text-h2 uppercase">
          Other ways to convert {formatMeta(pair.from).name}
        </h2>
      </div>

      <ul
        data-slot="related-tools-list"
        className="grid list-none grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {links.map((link) => (
          <li key={link.slug} className="min-w-0">
            <a
              data-slot="related-tools-link"
              href={convertHref(link.from, link.to)}
              className={cn(linkVariants({ variant }))}
            >
              <span className="text-h3">{pairTitle(link)}</span>
              <span className={cn('font-mono text-tech', muted)}>
                {formatMeta(link.from).extension} to {formatMeta(link.to).extension}
              </span>
            </a>
          </li>
        ))}
      </ul>

      {/*
       * The hub rung. Not one of the six — it goes to an index rather than to a
       * conversion — and it is what makes the pattern hub-and-spoke rather than
       * a flat mesh.
       */}
      <p className="text-body">
        <a
          data-slot="related-tools-hub"
          href={HUB_HREF}
          className={cn(
            'underline underline-offset-4',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
          )}
        >
          Browse every converter
        </a>
      </p>
    </section>
  )
}

export { RelatedTools, HUB_HREF as CONVERTERS_HUB_HREF }
