import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { CpuIcon, TriangleAlertIcon } from 'lucide-react'

import { formatBytes } from '@/lib/router/copy'
import type { EngineId, Warning } from '@/lib/router/types'
import { cn } from '@/lib/utils'

/*
 * The routing decision, shown to the person it was made for (issue #59).
 *
 * Every other converter treats engine selection as an implementation detail and
 * shows a spinner. This one has a router that weighs hardware codecs against a
 * 31 MB download against a memory budget, and the result of that weighing is
 * something the user is entitled to see: it explains why one file is instant and
 * the next one takes a minute, and it is the visible half of the claim that
 * nothing leaves the device.
 *
 * ## It reports; it never decides
 *
 * Everything rendered here comes off a `RouteSuccess` — the engine, its own
 * label, its download size, its warnings. Nothing in this file maps an id to a
 * name or works out whether a job will be slow, because that would be a second
 * copy of the priority table drifting from the first (CLAUDE.md §2.4). The
 * component's whole job is to put what `route()` already said in front of
 * someone.
 *
 * ## Warnings are text, not a tooltip
 *
 * A warning that only exists on hover does not exist on a phone, and does not
 * exist to a screen reader that has not been told to look. They are rendered as
 * a list, in the order `route()` produced them — how slow, why it is slow, the
 * wait before it starts, then the cost to the file — so the most consequential
 * one is read first.
 */

const badgeVariants = cva(
  [
    'inline-flex max-w-full min-w-0 items-center gap-2',
    'rounded-full border px-3 py-1 font-mono text-tech break-words',
  ].join(' '),
  {
    variants: {
      variant: {
        dark: 'border-line-dark bg-ink-2 text-fg-dark',
        light: 'border-line-light bg-paper-2 text-fg-light',
      },
    },
    defaultVariants: { variant: 'dark' },
  },
)

const listVariants = cva('flex list-none flex-col gap-1.5 font-sans text-body', {
  variants: {
    variant: {
      dark: 'text-fg-dark-mut',
      light: 'text-fg-light-mut',
    },
  },
  defaultVariants: { variant: 'dark' },
})

export type RouteBadgeProps = React.ComponentProps<'div'> &
  VariantProps<typeof badgeVariants> & {
    /** The engine `route()` chose. Reported, never interpreted. */
    engine: EngineId
    /** The engine's own label, straight off `RouteSuccess.reason`. */
    reason: string
    /**
     * The engine binary's download size in bytes, off `RouteSuccess.loadCost`.
     *
     * Zero is a real answer and the best one there is — Canvas downloads
     * nothing — so it is rendered as words rather than as `0 KB`.
     */
    loadCost?: number
    /** What the user should know about a job that is going to run anyway. */
    warnings?: readonly Warning[]
  }

function RouteBadge({
  className,
  variant,
  engine,
  reason,
  loadCost,
  warnings,
  ...props
}: RouteBadgeProps) {
  const listed = warnings ?? []

  return (
    <div
      data-slot="route-badge"
      // The id rather than the label, because this is what a test, a bug report
      // or a future analytics event needs to be stable.
      data-engine={engine}
      className={cn('flex min-w-0 flex-col items-start gap-3', className)}
      {...props}
    >
      <span data-slot="route-badge-pill" className={cn(badgeVariants({ variant }))}>
        {/* Decoration: the accessible name is the text beside it. */}
        <CpuIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.5} />
        <span data-slot="route-badge-reason">{reason}</span>
        <span aria-hidden="true">·</span>
        <span data-slot="route-badge-cost">{downloadLabel(loadCost)}</span>
      </span>

      {listed.length > 0 && (
        <ul data-slot="route-badge-warnings" className={cn(listVariants({ variant }))}>
          {listed.map((warning) => (
            <li key={warning.code} data-warning={warning.code} className="flex min-w-0 gap-2">
              {/*
               * `--color-warn` is a functional signal and not a brand colour,
               * which is the only use CLAUDE.md §3 allows it. The icon carries
               * no meaning the sentence does not, so it is hidden rather than
               * labelled twice.
               */}
              <TriangleAlertIcon
                aria-hidden="true"
                className="mt-1 size-4 shrink-0 text-warn"
                strokeWidth={1.5}
              />
              <span className="min-w-0 break-words">{warning.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * What the engine costs to fetch, in the terms someone on a phone cares about.
 *
 * "No download" rather than "0 KB": a zero here is the best possible answer and
 * deserves to read like one.
 */
function downloadLabel(loadCost: number | undefined): string {
  if (loadCost === undefined) return 'On your device'
  if (loadCost <= 0) return 'No download'

  return `${formatBytes(loadCost)} download`
}

export { RouteBadge, badgeVariants as routeBadgeVariants }
