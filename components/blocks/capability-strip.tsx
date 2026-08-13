import type * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * One claim in the strip: a decorative glyph over a two-line label.
 *
 * The icon is passed in by the caller rather than chosen here. A strip that
 * mapped `label` to a glyph would own the copy of every page that used it, and
 * the pattern exists precisely to be reused with different copy.
 *
 * Named `CapabilityItem` rather than `Capability` because `lib/router/types.ts`
 * already exports `Capabilities` for the browser feature probe, and a page that
 * imported both would read as though they were related. They are not.
 */
export type CapabilityItem = {
  /** Line icon, rendered at 20px and hidden from assistive technology. */
  icon: LucideIcon
  /** First line — the claim itself. Set in the card-title step. */
  label: string
  /** Second line — a short qualifier. Set as an eyebrow. */
  detail: string
}

/**
 * The muted token for the second line, per surface — exported so the contrast
 * test iterates the real set rather than a copy of it that could drift.
 *
 * This is the only thing the tone decides, and the reason a tone has to be
 * declared at all: the qualifier is muted, and the muted tokens are
 * surface-specific. `fg-dark-mut` on `paper` is 2.6:1 and `fg-light-mut` on
 * `ink` is worse. Everything else — the claim, the icon — sets no colour and
 * inherits from the block, which is what lets the strip invert for free.
 *
 * `light` means the `paper` block (5.05:1). The strip is not designed to sit
 * directly on the `shell` background, where the same token is 4.42:1 and misses
 * AA.
 */
export const CAPABILITY_TONES = {
  dark: 'text-fg-dark-mut',
  light: 'text-fg-light-mut',
} as const

export type CapabilityTone = keyof typeof CAPABILITY_TONES

export type CapabilityStripProps = Omit<React.ComponentProps<'ul'>, 'children' | 'role'> & {
  items: readonly CapabilityItem[]
  /**
   * The block the strip sits on. Required rather than defaulted: a default is
   * right for one of the two surfaces and invisible on the other, and nothing
   * at the call site would show which one you got.
   */
  tone: CapabilityTone
}

/*
 * The CapabilityStrip — signature pattern 2 of the design system, the row of
 * core claims under the hero block (docify-design §2).
 *
 * Column counts: two on mobile, three from `md` (48rem/768px, iPad portrait),
 * five from `lg` (64rem/1024px). `md` rather than `sm` for the three-column
 * step because three tracks in a 640px viewport hyphenate every claim; `lg` for
 * five because that is the first width at which a five-track row still leaves
 * each cell around 180px inside the SectionBlock's 24px inset.
 *
 * The responsive contract (320px to 2560px, no horizontal scroll) rests on
 * three things, none of them decoration. `grid-cols-*` compiles to
 * `repeat(n, minmax(0, 1fr))`, so a track is never sized by its content. A grid
 * item still defaults to `min-width: auto`, which would put a floor under the
 * track at the longest unbroken word — `min-w-0` removes it. And `wrap-anywhere`
 * (`overflow-wrap: anywhere`) lowers the min-content measurement itself, so the
 * word breaks instead of overflowing the track it can no longer widen.
 *
 * `break-words` rides along as the fallback for `overflow-wrap: anywhere`
 * (Safari < 15.4, where the declaration is dropped). It is not a substitute —
 * `break-word` breaks the line without lowering min-content — but against a
 * track already fixed at a fraction it is enough to keep the word in the cell.
 */
function CapabilityStrip({ items, tone, className, ...props }: CapabilityStripProps) {
  return (
    <ul
      {...props}
      // After the spread, not before: Tailwind's preflight removes the list
      // marker and Safari + VoiceOver then drop the list role with it, so the
      // explicit role is what keeps the strip announced as "list, 5 items".
      // A caller must not be able to spread that guarantee away.
      role="list"
      data-slot="capability-strip"
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3 lg:grid-cols-5',
        'font-sans',
        className,
      )}
    >
      {items.map(({ icon: Icon, label, detail }, index) => (
        // Keyed by position: the strip is static copy that never reorders, and
        // two capabilities are allowed to share a label.
        <li key={index} className="flex min-w-0 flex-col gap-4">
          <Icon aria-hidden="true" focusable="false" className="size-5 shrink-0" />
          <div className="flex flex-col gap-1.5">
            <p className="text-h3 break-words wrap-anywhere">{label}</p>
            {/*
             * The eyebrow step carries a leading of 1, which is specified for a
             * one-line label. In a five-column strip the qualifier wraps, and
             * stacked 12px uppercase lines at leading 1 collide — so the
             * wrapping variant relaxes the leading and nothing else.
             */}
            <p
              className={cn(
                'text-eyebrow break-words wrap-anywhere uppercase leading-normal',
                CAPABILITY_TONES[tone],
              )}
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
