import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

/*
 * Retuned from the shadcn default (issue #15).
 *
 * Everything shadcn ships that CLAUDE.md section 3 forbids has been removed:
 * the `--primary` / `--muted` / `--destructive` variables, the `ring-3` focus
 * glow, the `bg-clip-padding` gradient guard and the six-variant surface. What
 * is left is the design system's own button — three variants, pill radius,
 * flat fill, colours drawn only from the `@theme` palette in app/globals.css.
 *
 * Focus is shown as a 2px outline with a 2px offset in the current text colour,
 * so the indicator inverts correctly on both the light and the dark sections
 * without a second set of tokens.
 */
/**
 * The button sizes, exported so the touch-target test iterates the real set
 * rather than a copy of it that could drift.
 *
 * There is deliberately no size below 44px. shadcn ships `xs`/`sm` heights of
 * 24-28px, but the responsive contract puts the floor at 44x44px — offering a
 * smaller size would be a trap for whoever reaches for it next.
 */
const BUTTON_SIZES = {
  default: 'h-11 px-6',
  lg: 'h-12 px-8',
  icon: 'size-11',
} as const

const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap',
    'rounded-full border border-transparent font-sans text-body font-medium',
    'transition-colors select-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
    'disabled:pointer-events-none disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(' '),
  {
    variants: {
      variant: {
        // White fill, black text — the one high-emphasis action per block.
        primary: 'bg-paper text-ink hover:bg-paper-2',
        // Transparent with a 1px border; sits on the dark sections.
        secondary: 'border-line-dark bg-transparent text-fg-dark hover:bg-ink-3',
        // Text only. Hover underlines rather than filling a surface.
        ghost: 'bg-transparent hover:underline hover:underline-offset-4',
      },
      size: BUTTON_SIZES,
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'primary',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, BUTTON_SIZES, buttonVariants }
