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
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-ink-3', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full flex-1 bg-fg-dark transition-transform motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
