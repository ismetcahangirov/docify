import type * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * One claim in the strip: a decorative glyph over a two-line label.
 *
 * The icon is passed in by the caller rather than chosen here. A strip that
 * mapped `label` to a glyph would own the copy of every page that used it, and
 * the pattern exists precisely to be reused with different copy.
 */
export type Capability = {
  /** Line icon, rendered at 20px and hidden from assistive technology. */
  icon: LucideIcon
  /** First line — the claim itself. Set in the card-title step. */
  label: string
  /** Second line — a short qualifier. Set as an eyebrow. */
  detail: string
}

/**
 * The surfaces the strip is documented to sit on, exported so the contrast test
 * iterates the real set rather than a copy of it that could drift.
 *
 * A tone has to be declared because the strip's second line is muted, and the
 * muted tokens are surface-specific — `fg-dark-mut` is unreadable on `paper`
 * and `fg-light-mut` is unreadable on `ink`. The first line and the icon do
 * inherit, but there is nothing for the qualifier to inherit *from*.
 */
export const CAPABILITY_TONES = {
  dark: { root: 'text-fg-dark', detail: 'text-fg-dark-mut' },
  light: { root: 'text-fg-light', detail: 'text-fg-light-mut' },
} as const

export type CapabilityTone = keyof typeof CAPABILITY_TONES

export type CapabilityStripProps = Omit<React.ComponentProps<'ul'>, 'children'> & {
  items: readonly Capability[]
  /** The block the strip sits on. Defaults to the dark hero block. */
  tone?: CapabilityTone
}

/*
 * The CapabilityStrip — signature pattern 2 of the design system, the row of
 * core claims under the dark hero block (docify-design §2).
 *
 * Column counts: two on mobile, three from `md` (48rem/768px, iPad portrait),
 * five from `lg` (64rem/1024px). `md` rather than `sm` for the three-column
 * step because three tracks in a 640px viewport hyphenate every claim; `lg` for
 * five because that is the first width at which a five-track row still leaves
 * each cell around 180px inside the SectionBlock's 24px inset.
 *
 * The responsive contract (320px to 2560px, no horizontal scroll) is what
 * `min-w-0` and `wrap-anywhere` are for, and neither is decoration. A grid item
 * defaults to `min-width: auto`, so its min-content width — the longest
 * unbroken word — becomes a floor the track cannot go below; `min-w-0` removes
 * the floor, and `wrap-anywhere` lowers the measurement itself so the word
 * breaks instead of overflowing the track it no longer widens. `break-words`
 * would not do: `overflow-wrap: break-word` breaks the line but leaves
 * min-content at the longest word.
 */
function CapabilityStrip({ items, tone = 'dark', className, ...props }: CapabilityStripProps) {
  const palette = CAPABILITY_TONES[tone]

  return (
    <ul
      // Tailwind's preflight removes the list marker, and Safari + VoiceOver
      // then drop the list role with it. Stating the role keeps the strip
      // announced as "list, 5 items".
      role="list"
      data-slot="capability-strip"
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3 lg:grid-cols-5',
        'font-sans',
        palette.root,
        className,
      )}
      {...props}
    >
      {items.map(({ icon: Icon, label, detail }) => (
        <li key={label} className="flex min-w-0 flex-col gap-4">
          <Icon aria-hidden="true" focusable="false" className="size-5 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-h3 wrap-anywhere">{label}</p>
            {/*
             * The eyebrow step carries a leading of 1, which is specified for a
             * one-line label. In a five-column strip the qualifier wraps, and
             * stacked 12px uppercase lines at leading 1 collide — so the
             * wrapping variant relaxes the leading and nothing else.
             */}
            <p
              className={cn('text-eyebrow leading-normal uppercase wrap-anywhere', palette.detail)}
            >
              {detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export { CapabilityStrip }
