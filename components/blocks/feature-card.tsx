import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type FeatureCardProps = React.ComponentProps<'div'> & {
  /**
   * The lucide icon shown in the badge, passed as the component itself so the
   * card can size it and hide it from assistive technology. Taking it from the
   * caller also keeps every icon out of the bundle of pages that do not use it.
   */
  icon: LucideIcon
  /** The card's one-line claim, rendered as its heading. */
  title: React.ReactNode
  /** The supporting copy — a sentence or two of text, not blocks. */
  children: React.ReactNode
}

/**
 * A feature card on the dark block — the fourth of the six signature patterns
 * (docify-design section 4): a 44px circular icon badge, a title, and two lines
 * of copy on an `--color-ink-2` surface.
 *
 * The heading is an `<h3>` because the pattern places these cards under a
 * block's H2. The card itself is a plain `<div>`: `<article>` would put an
 * unnamed `role="article"` in the accessibility tree for every card in the grid,
 * and naming it needs an id that only a client component could generate.
 */
function FeatureCard({ className, icon: Icon, title, children, ...props }: FeatureCardProps) {
  return (
    <div
      data-slot="feature-card"
      // Flat fill plus a 1px border — no shadow, no glow. `min-w-0` and
      // `break-words` keep an unbroken word (a long MIME type, a URL) from
      // setting the card's min-content width and pushing its grid sideways,
      // which is the horizontal scroll the responsive contract forbids.
      className={cn(
        'group flex min-w-0 flex-col items-start gap-5 break-words',
        'rounded-lg border border-line-dark bg-ink-2 p-6 transition-colors hover:bg-ink-3',
        className,
      )}
      {...props}
    >
      {/*
       * 44px on the spacing scale — `size-11`, four pixels per step — rather
       * than an arbitrary value, so it stays the same measure as the button's
       * icon size. It is also the touch-target floor, which matters the moment
       * anything here becomes interactive.
       *
       * On hover the card takes the badge's own `--color-ink-3`, so the two
       * swap rather than merge: the badge drops to the card's resting fill and
       * the step between them survives. That step is one tone either way — the
       * separation between the dark surfaces in this palette is deliberately
       * faint, and the badge's 1px border is what actually draws its edge.
       */}
      <span
        data-slot="feature-card-badge"
        className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line-dark bg-ink-3 text-fg-dark transition-colors group-hover:bg-ink-2"
      >
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.5} />
      </span>

      <div className="flex flex-col gap-2">
        <h3 data-slot="feature-card-title" className="font-sans text-h3 text-fg-dark">
          {title}
        </h3>
        <p data-slot="feature-card-copy" className="font-sans text-body text-fg-dark-mut">
          {children}
        </p>
      </div>
    </div>
  )
}

export { FeatureCard }
