import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

/*
 * SectionBlock — the first of the layout patterns in docify-design (issue #16).
 *
 * A page is a stack of these: alternating light and dark blocks, each one a
 * rounded panel floating on the `shell` background with a strip of that shell
 * still visible down both sides. The alternation is the whole point, so the two
 * variants invert every colour — fill, border and text — rather than sharing a
 * neutral base.
 *
 * The acceptance criterion for the issue was written as `rounded-[28px]` and an
 * inset of 12px / 24px. Both numbers are here, but neither is written as an
 * arbitrary value: CLAUDE.md section 3 allows only the `--radius-*` steps, and
 * `--radius-xl` in app/globals.css is exactly 28px. The inset is `mx-3` /
 * `sm:mx-6` on Tailwind's 4px spacing scale — 12px, then 24px. Going through
 * the scales means retuning a token moves the component with it instead of
 * leaving a hard-coded pixel behind.
 *
 * Nothing here has a shadow, a ring, a blur or a gradient. The block is defined
 * by contrast against its neighbours and a 1px border, which is what keeps the
 * stack reading as flat editorial blocks rather than floating cards.
 *
 * Two things are deliberately the caller's:
 *
 * - **Vertical rhythm.** The block sets no top or bottom margin, because the gap
 *   between two blocks belongs to the stack, not to either block — a page sets
 *   it once with `space-y-*` and every seam matches. Without one, consecutive
 *   blocks abut and the rounded corners cut four notches out of the seam.
 * - **The accessible name.** A `<section>` is only a landmark once it has one,
 *   so pass `aria-labelledby` pointing at the block's own heading (or an
 *   `aria-label` when it has no visible one). An unnamed block is still valid
 *   markup — it is simply a group rather than a region a screen reader can jump
 *   to, which is the right outcome for a purely decorative band.
 */
const sectionBlockVariants = cva(
  [
    // The shell shows through the inset; the padding is the block's own gutter,
    // so that no caller has to re-decide it and no two blocks disagree.
    'mx-3 p-6 sm:mx-6 sm:p-10',
    'rounded-xl border font-sans',
  ].join(' '),
  {
    variants: {
      variant: {
        light: 'border-line-light bg-paper text-fg-light',
        dark: 'border-line-dark bg-ink text-fg-dark',
      },
    },
    defaultVariants: {
      variant: 'light',
    },
  },
)

function SectionBlock({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'section'> &
  VariantProps<typeof sectionBlockVariants> & {
    asChild?: boolean
  }) {
  // `<section>` is the default because a block is a titled region of the page.
  // `asChild` is there for the two that are not — the `<main>` a page opens
  // with, and the `<footer>` it closes with — so they get the same panel
  // without a wrapper element between the shell and the landmark.
  const Comp = asChild ? Slot.Root : 'section'

  return (
    <Comp
      data-slot="section-block"
      className={cn(sectionBlockVariants({ variant, className }))}
      {...props}
    />
  )
}

export { SectionBlock, sectionBlockVariants }
