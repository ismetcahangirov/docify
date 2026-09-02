import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { convertHref } from '@/lib/registry/slugs'
import { formatName } from '@/lib/router/copy'
import type { ConversionTask, RejectionCode, RouteRejection } from '@/lib/router/types'
import { cn } from '@/lib/utils'

/*
 * A refusal, and the way out of it (issue #62).
 *
 * CLAUDE.md §2.5 makes both halves of a `RouteRejection` mandatory, and this is
 * where the user finally reads them. Three things are on screen every time:
 * what went wrong, what to do about it, and — where one exists — a page that
 * will do it.
 *
 * ## Nothing here rewrites the router's words
 *
 * `message` and `suggestion` are rendered verbatim. They are the only text in
 * the app with the job's real numbers in them — this file is 292 MB, the
 * ceiling on this device is 210 MB — and a component that paraphrased them would
 * be a second, wrong copy of the memory model (CLAUDE.md §2.4). The only words
 * this component contributes are the short title, which names the *kind* of
 * refusal so the block is scannable above the sentence that explains it.
 *
 * ## Why the failure is not red
 *
 * `--color-err` on `--color-ink-2` measures 2.9:1 — below AA for text and below
 * 3:1 for a meaningful glyph. So the signal is a rule down the left edge and the
 * words stay in the ordinary foreground, which is also the accessible answer:
 * colour is never the only thing carrying the meaning. The same decision as
 * `./job-card`, and for the same measurement.
 *
 * ## Why the alternatives are plain anchors
 *
 * A converter route is cross-origin isolated and a `next/link` soft navigation
 * carries the *previous* document's isolation across the boundary — see the
 * header of `next.config.ts`. A rejection is a rare path where a whole-document
 * load costs nothing, and a full load is what guarantees the destination gets
 * its own headers evaluated. Whether an alternative is offered at all is
 * `lib/router/alternatives.ts`'s decision, verified against `route()`; this
 * component only draws what it is handed.
 */

/**
 * What each refusal is, in three or four words.
 *
 * A heading rather than a restatement: the sentence underneath already says
 * what happened, and a block of two paragraphs with no title is one a user
 * skips. Written from the user's side of it — `DEVICE_TOO_WEAK` is not a
 * verdict on their phone, it is a fact about what a mobile browser gives a tab.
 */
const TITLE: Readonly<Record<RejectionCode, string>> = {
  EMPTY_INPUT: 'Nothing to convert',
  UNSUPPORTED_PAIR: 'Not available in this browser',
  CODEC_UNAVAILABLE: 'This browser is missing a codec',
  FILE_TOO_LARGE: 'Too large for one job',
  DEVICE_TOO_WEAK: 'Too large for a mobile browser',
}

const rejectionVariants = cva(
  'flex min-w-0 flex-col gap-3 border-l-2 border-err pl-4 font-sans break-words',
  {
    variants: {
      variant: {
        dark: 'text-fg-dark',
        light: 'text-fg-light',
      },
    },
    defaultVariants: { variant: 'dark' },
  },
)

const mutedVariants = cva('', {
  variants: { variant: { dark: 'text-fg-dark-mut', light: 'text-fg-light-mut' } },
  defaultVariants: { variant: 'dark' },
})

export type RejectionProps = Omit<React.ComponentProps<'div'>, 'children'> &
  VariantProps<typeof rejectionVariants> & {
    rejection: RouteRejection
    /**
     * The job that was refused.
     *
     * Only the source format is used, to name where each alternative starts
     * from. Without it no alternatives are drawn at all, because a link built
     * from a guessed source would point at a page that converts something else.
     */
    task?: ConversionTask
    /**
     * Conversions this device would accept instead, already verified — see
     * `lib/router/alternatives.ts`. The router decides; this only renders.
     */
    alternatives?: readonly ConversionTask[]
  }

function Rejection({
  className,
  variant,
  rejection,
  task,
  alternatives = [],
  ...props
}: RejectionProps) {
  const muted = mutedVariants({ variant })
  const offered = task === undefined ? [] : alternatives

  return (
    <div
      data-slot="rejection"
      data-code={rejection.code}
      // Announced, not merely rendered. A refusal arrives after the user has
      // done something and moved their eyes elsewhere; `alert` is what reaches
      // somebody who is not looking at this block. `assertive` by definition of
      // the role — unlike a progress update, this is the end of the attempt.
      role="alert"
      className={cn(rejectionVariants({ variant, className }))}
      {...props}
    >
      <p data-slot="rejection-title" className="text-h3">
        {TITLE[rejection.code]}
      </p>

      <p data-slot="rejection-message" className="text-body">
        {rejection.message}
      </p>

      <p data-slot="rejection-suggestion" className={cn('text-body', muted)}>
        {rejection.suggestion}
      </p>

      {offered.length > 0 && task !== undefined && (
        <div data-slot="rejection-alternatives" className="flex min-w-0 flex-col gap-2">
          <p className={cn('text-eyebrow uppercase', muted)}>Instead, in this browser</p>
          <ul className="flex list-none flex-wrap gap-x-4 gap-y-2">
            {offered.map((alternative) => (
              <li key={alternative.to} className="min-w-0">
                <a
                  data-slot="rejection-alternative"
                  href={convertHref(alternative.from, alternative.to)}
                  className={cn(
                    'text-body break-words underline underline-offset-4',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
                  )}
                >
                  {/*
                   * The whole conversion, not "this one". A list of four links
                   * all called "convert" is four identical announcements to a
                   * screen reader working through them out of context.
                   */}
                  {`${formatName(alternative.from)} to ${formatName(alternative.to)}`}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export { Rejection, rejectionVariants, TITLE as REJECTION_TITLES }
