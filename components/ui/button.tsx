import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { ArrowRightIcon } from 'lucide-react'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * The button sizes, exported so the touch-target test iterates the real set
 * rather than a copy of it that could drift.
 *
 * There is deliberately no size below 44px. shadcn ships `xs`/`sm` heights of
 * 24-28px, but the responsive contract puts the floor at 44x44px — offering a
 * smaller size would be a trap for whoever reaches for it next.
 *
 * The heights are minimums rather than fixed: the label is allowed to wrap (see
 * the note on `whitespace-nowrap` below), and a wrapped label must grow the
 * button instead of spilling out of it.
 */
const BUTTON_SIZES = {
  default: 'min-h-11 px-6 py-2',
  lg: 'min-h-12 px-8 py-2',
  icon: 'size-11',
} as const

/*
 * Retuned from the shadcn default (issue #15).
 *
 * Everything shadcn ships that CLAUDE.md section 3 forbids has been removed:
 * the `--primary` / `--muted` / `--destructive` variables, the `ring-3` focus
 * glow, the `bg-clip-padding` gradient guard and the six-variant surface. What
 * is left is the design system's own button — three variants, pill radius,
 * flat fill, colours drawn only from the `@theme` palette in app/globals.css.
 *
 * shadcn's `whitespace-nowrap` is gone too. It is not a style choice at 320px:
 * a nowrap label wider than its container is the button's min-content width, so
 * a long action in a dialog footer pushes the panel sideways and produces the
 * horizontal scroll the responsive contract forbids.
 *
 * Focus is a 2px outline at a 2px offset. Because of the offset the outline is
 * drawn *outside* the button, so it has to contrast with the section behind it,
 * not with the button's own fill — which is why `primary` names its colour
 * explicitly. `currentColor` would paint the primary button's black text colour
 * onto the black block it sits on and disappear (1:1). The variants that set no
 * fill keep `currentColor` on purpose: inheriting is what lets them invert
 * between the light and the dark sections.
 */
/**
 * The one place the defaults are written.
 *
 * `cva` needs them and so does the arrow below, which belongs to the primary
 * button alone — and a button that names no variant would otherwise have to be
 * compared against a second copy of the word.
 */
const DEFAULTS = { variant: 'primary', size: 'default' } as const

const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2',
    'rounded-full border border-transparent font-sans text-body font-medium',
    'transition-colors select-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
    'disabled:pointer-events-none disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(' '),
  {
    variants: {
      variant: {
        // White fill, black text — the one high-emphasis action per block, and
        // the reason it names an outline colour: it lives on the dark block.
        primary: 'bg-paper text-ink hover:bg-paper-2 focus-visible:outline-fg-dark',
        // Transparent with a 1px border; sits on the dark sections.
        secondary: 'border-line-dark bg-transparent text-fg-dark hover:bg-ink-3',
        // Text only. Hover underlines rather than filling a surface.
        ghost: 'bg-transparent hover:underline hover:underline-offset-4',
      },
      size: BUTTON_SIZES,
    },
    defaultVariants: DEFAULTS,
  },
)

/**
 * The arrow CLAUDE.md section 3 puts on the primary button, drawn rather than
 * typed.
 *
 * Written as the character it names, it would miss every subset the app ships:
 * the self-hosted faces carry only Google's `latin` unicode-range, which covers
 * U+2191 and U+2193 but not U+2192 (`app/fonts.ts`). The browser would fall
 * back to a system face whose weight, metrics and optical size match neither
 * Archivo nor Inter, and pick a different one on every platform.
 * `scripts/design-lint` refuses the whole U+2190–U+21FF block so the shortcut
 * cannot come back.
 *
 * `aria-hidden` because it is decoration: the accessible name is the label, and
 * "Convert file right arrow" is the decoration read aloud.
 */
function ButtonArrow() {
  return <ArrowRightIcon aria-hidden="true" />
}

function Button({
  className,
  children,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  // Only the primary variant, and never the icon size — that one is a square
  // holding a single glyph, and a second would not fit in it.
  const showsArrow =
    (variant ?? DEFAULTS.variant) === 'primary' && (size ?? DEFAULTS.size) !== 'icon'

  // `Slottable` is what lets `asChild` keep the arrow: it marks which child the
  // caller's element is merged into, so the icon travels *inside* the rendered
  // link instead of turning the slot into an illegal two-child render.
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {asChild ? <Slot.Slottable>{children}</Slot.Slottable> : children}
      {showsArrow && <ButtonArrow />}
    </Comp>
  )
}

export { Button, BUTTON_SIZES, buttonVariants }
