import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The muted caption tone, per the surface the stat is placed on.
 *
 * The figure deliberately names no colour: it inherits `currentColor` and so
 * flips with the block around it. The caption cannot do the same — "muted" is a
 * separate token on each surface, and `--color-fg-dark-mut` on a light block
 * would fall below the contrast floor.
 */
const CAPTION_TONE = {
  dark: 'text-fg-dark-mut',
  light: 'text-fg-light-mut',
} as const

export type StatPairProps = Omit<React.ComponentProps<'p'>, 'children'> & {
  /** The number itself — `0`, `<2`, `100`. */
  figure: React.ReactNode
  /** The small trailing unit — `KB`, `s`, `%`. Omit it for a bare figure. */
  unit?: React.ReactNode
  /** What the figure counts: `sent to a server`. */
  caption: React.ReactNode
  /** The surface the stat sits on. Defaults to the dark block. */
  surface?: keyof typeof CAPTION_TONE
}

/**
 * A large figure with a small unit, and a muted caption beneath — the third of
 * the six signature patterns (docify-design section 3): `0 KB / sent to a server`.
 *
 * The three parts are one text block rather than three siblings on purpose. A
 * figure, a unit and a caption in separate paragraphs are read out as three
 * unrelated fragments; inside a single paragraph a screen reader reads the
 * statement the design draws — "0 KB sent to a server" — with no ARIA needed to
 * glue it back together. The spans lay out as blocks, which is a rendering
 * concern and leaves the paragraph's content model untouched.
 */
function StatPair({ className, figure, unit, caption, surface = 'dark', ...props }: StatPairProps) {
  return (
    <p
      data-slot="stat-pair"
      // `min-w-0` and `break-words`: a five-digit figure or a long caption is one
      // unbroken run of text, and as a grid item its min-content width would
      // otherwise widen the row rather than wrap — the horizontal scroll the
      // responsive contract forbids between 320px and 2560px.
      className={cn('flex min-w-0 flex-col gap-2 break-words', className)}
      {...props}
    >
      <span className="flex flex-wrap items-baseline gap-2">
        <span data-slot="stat-pair-figure" className="font-display text-stat uppercase">
          {figure}
        </span>
        {unit === undefined ? null : (
          <>
            {' '}
            <span data-slot="stat-pair-unit" className="font-display text-h3 uppercase">
              {unit}
            </span>
          </>
        )}
      </span>{' '}
      {/*
       * The caption is the eyebrow step — the design system's one 12px role —
       * so it is set in the eyebrow's case and tracking too. Its leading is
       * relaxed by a step because the token's `1` is sized for a single-line
       * eyebrow, and these captions run to two or three lines.
       */}
      <span
        data-slot="stat-pair-caption"
        className={cn('text-eyebrow leading-snug uppercase', CAPTION_TONE[surface])}
      >
        {caption}
      </span>
    </p>
  )
}

export { StatPair, CAPTION_TONE }
