'use client'

import * as React from 'react'
import { Progress as ProgressPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/*
 * Retuned from the shadcn default (issue #15).
 *
 * The track was `bg-muted` and the fill `bg-primary`; both now come from the
 * `@theme` palette. The bar is flat — an ink-3 track with a solid fg-dark
 * fill, no shadow, no ring and no gradient sweep. `overflow-hidden` keeps the
 * fill inside the track even if a caller passes a value outside 0-100.
 *
 * Callers pass their own `aria-label`: a conversion job's progress needs to say
 * which job it belongs to, which only the caller knows.
 */
/**
 * A progressbar has to carry a name — it is announced on its own, away from
 * whatever heading sits near it, and "50%" of nothing helps nobody (WCAG 4.1.2).
 * Requiring it in the type means a caller cannot forget.
 */
type ProgressProps = Omit<
  React.ComponentProps<typeof ProgressPrimitive.Root>,
  'aria-label' | 'aria-labelledby'
> &
  ({ 'aria-label': string } | { 'aria-labelledby': string })

function Progress({ className, value, max = 100, ...props }: ProgressProps) {
  // Clamped once, then used for both the fill and the accessibility tree, so
  // the two cannot disagree. shadcn scales the fill against a hard-coded 100
  // while `max` still reaches the root through the spread — a caller passing
  // `max={200}` gets a bar that reads full at the half-way point.
  const percent = Math.min(100, Math.max(0, ((value ?? 0) / max) * 100))

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value === null || value === undefined ? value : (percent * max) / 100}
      max={max}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-ink-3', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full bg-fg-dark transition-transform motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
