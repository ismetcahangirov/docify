'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { CheckIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { etaLabel } from '@/lib/queue/eta'
import type { QueuedJob } from '@/lib/queue/queue'
import type { JobState } from '@/lib/queue/state'
import { isRunning } from '@/lib/queue/state'
import { formatBytes } from '@/lib/router/copy'
import type { ConversionTask } from '@/lib/router/types'
import { cn } from '@/lib/utils'

import { Rejection } from './rejection'
import { RouteBadge } from './route-badge'

/*
 * One file in the queue (issue #58): where it is, how much longer, a cancel
 * that works, and a failure that says what to do next.
 *
 * ## The clock is the component's, and only while it is needed
 *
 * An estimate has to count down, which means a render a second, which means an
 * interval. It runs only while the job is actually running and is torn down the
 * moment it is not, because a hundred cards each waking once a second is a
 * hundred renders a second on a page that has finished working. `now` can be
 * passed in instead, which is how the tests pin an estimate rather than racing
 * one.
 *
 * ## Why colour does almost nothing here
 *
 * The palette's three status colours are functional signals and are held to the
 * contrast rules like everything else. `--color-err` on `--color-ink-2` measures
 * 2.9:1 — below AA for text and below 3:1 for a meaningful icon — so a failure
 * is *not* drawn in red text. It is a rule down the left of the block, with the
 * words themselves in the ordinary foreground, and the state is named in
 * language rather than in hue. That is also the accessible answer: colour is
 * never the only thing carrying the meaning.
 *
 * ## A router refusal is drawn by the component that owns refusals
 *
 * A failure carrying a `RejectionCode` came from `route()`, and everything the
 * app says about one — the title, the rule down the side, the alternatives that
 * were verified against this device — belongs to `./rejection` (issue #62). The
 * card delegates rather than growing a second copy that would drift. What is
 * left here is the other kind: an engine that threw, which has a message and
 * often no advice at all, and no code to look anything up by.
 *
 * ## Cancel, and what it actually does
 *
 * The button asks the queue, which asks the worker, and the job returns to
 * `queued` with the file still in the list. Nothing here decides whether the
 * cancel arrived in time — that is the state table's answer, and this component
 * renders whatever it says afterwards.
 */

/** What each state is called in front of a person. */
const STATUS: Readonly<Record<JobState, string>> = {
  queued: 'Waiting',
  routing: 'Choosing an engine',
  'loading-engine': 'Loading the engine',
  processing: 'Converting',
  done: 'Done',
  failed: 'Could not convert',
}

const cardVariants = cva(
  'flex min-w-0 flex-col gap-4 rounded-lg border p-6 font-sans break-words',
  {
    variants: {
      variant: {
        dark: 'border-line-dark bg-ink-2 text-fg-dark',
        light: 'border-line-light bg-paper text-fg-light',
      },
    },
    defaultVariants: { variant: 'dark' },
  },
)

const mutedVariants = cva('', {
  variants: {
    variant: { dark: 'text-fg-dark-mut', light: 'text-fg-light-mut' },
  },
  defaultVariants: { variant: 'dark' },
})

export type JobCardProps = React.ComponentProps<'article'> &
  VariantProps<typeof cardVariants> & {
    job: QueuedJob
    /** Stops a running job. Absent hides the button rather than disabling it. */
    onCancel?: (id: string) => void
    /** Runs a finished job again. */
    onRetry?: (id: string) => void
    /** Takes the file out of the queue altogether. */
    onRemove?: (id: string) => void
    /**
     * The conversion this job was queued for, used only to build the links
     * under a router refusal. Absent, no alternatives are offered.
     */
    task?: ConversionTask
    /**
     * Conversions this device would accept instead of the refused one, already
     * verified by `lib/router/alternatives.ts`.
     */
    alternatives?: readonly ConversionTask[]
    /**
     * The clock, in epoch milliseconds.
     *
     * Passed only by a test. Left out, the card runs its own — see the module
     * header.
     */
    now?: number
  }

function JobCard({
  className,
  variant,
  job,
  onCancel,
  onRetry,
  onRemove,
  task,
  alternatives,
  now,
  ...props
}: JobCardProps) {
  const headingId = React.useId()
  const clock = useNow(isRunning(job.state), now)
  const eta = job.state === 'processing' ? etaLabel(job, clock) : null
  const muted = mutedVariants({ variant })

  return (
    <article
      data-slot="job-card"
      data-state={job.state}
      aria-labelledby={headingId}
      className={cn(cardVariants({ variant, className }))}
      {...props}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {/*
         * `break-all`, not `break-words`: a file name is often one unbroken
         * token, and a token wider than the card is the card's min-content
         * width — which is the horizontal scroll the responsive contract
         * forbids.
         */}
        <h3 id={headingId} data-slot="job-card-name" className="min-w-0 text-h3 break-all">
          {job.file.name}
        </h3>
        <span data-slot="job-card-size" className={cn('shrink-0 font-mono text-tech', muted)}>
          {formatBytes(job.file.size)}
        </span>
      </div>

      {/*
       * Announced rather than merely rendered: a job finishing is news, and a
       * user who is not looking at this card is exactly the one who needs it.
       * `polite` so it waits for a gap instead of interrupting.
       */}
      <p
        data-slot="job-card-status"
        aria-live="polite"
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body"
      >
        {job.state === 'done' && (
          <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-ok" strokeWidth={2} />
        )}
        <span data-slot="job-card-state">{STATUS[job.state]}</span>
        {eta !== null && (
          <span data-slot="job-card-eta" className={muted}>
            {eta}
          </span>
        )}
      </p>

      {isRunning(job.state) && (
        <Progress
          data-slot="job-card-progress"
          // A fraction of one, on a bar that counts to a hundred. An engine that
          // cannot measure itself reports `-1`, and an empty track under a
          // "Loading the engine" line says the same thing honestly.
          value={job.progress !== null && job.progress >= 0 ? job.progress * 100 : 0}
          aria-label={`Converting ${job.file.name}`}
        />
      )}

      {job.engine !== undefined && job.reason !== undefined && (
        <RouteBadge
          variant={variant}
          engine={job.engine}
          reason={job.reason}
          warnings={job.warnings}
        />
      )}

      {job.failure !== undefined &&
        (job.failure.code !== undefined ? (
          <Rejection
            variant={variant}
            task={task}
            alternatives={alternatives}
            rejection={{
              ok: false,
              code: job.failure.code,
              message: job.failure.message,
              // A router rejection always carries one — CLAUDE.md §2.5 makes it
              // a compile error not to — so the fallback is unreachable through
              // `route()` and exists only because `JobFailure` types the field
              // as optional for the engine case below.
              suggestion: job.failure.suggestion ?? '',
            }}
          />
        ) : (
          <div
            data-slot="job-card-failure"
            // The rule is the signal, and the words are the meaning. See the
            // module header for why the text is not red.
            className="flex min-w-0 flex-col gap-1 border-l-2 border-err pl-4"
          >
            <p data-slot="job-card-failure-message" className="text-body">
              {job.failure.message}
            </p>
            {job.failure.suggestion !== undefined && (
              <p data-slot="job-card-failure-suggestion" className={cn('text-body', muted)}>
                {job.failure.suggestion}
              </p>
            )}
          </div>
        ))}

      <div className="flex flex-wrap items-center gap-2">
        {isRunning(job.state) && onCancel !== undefined && (
          <Button
            type="button"
            variant="secondary"
            data-slot="job-card-cancel"
            // One card in a list of twenty, and "Cancel" on its own names none
            // of them.
            aria-label={`Cancel converting ${job.file.name}`}
            onClick={() => onCancel(job.id)}
          >
            Cancel
          </Button>
        )}

        {job.state === 'failed' && onRetry !== undefined && (
          <Button
            type="button"
            variant="secondary"
            data-slot="job-card-retry"
            aria-label={`Try converting ${job.file.name} again`}
            onClick={() => onRetry(job.id)}
          >
            Try again
          </Button>
        )}

        {onRemove !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="job-card-remove"
            aria-label={`Remove ${job.file.name} from the queue`}
            onClick={() => onRemove(job.id)}
          >
            <XIcon aria-hidden="true" />
          </Button>
        )}
      </div>
    </article>
  )
}

/**
 * A clock that ticks once a second, and only while it is being watched.
 *
 * Starts at zero rather than at `Date.now()` so that server and client render
 * the same thing: an estimate needs a `startedAt`, which only exists once the
 * job has been started in a browser, and a zero clock reports no estimate at
 * all rather than a wrong one.
 */
function useNow(active: boolean, override: number | undefined): number {
  const [now, setNow] = React.useState(0)

  React.useEffect(() => {
    if (override !== undefined || !active) return

    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1_000)

    return () => clearInterval(id)
  }, [active, override])

  return override ?? now
}

export { JobCard, cardVariants as jobCardVariants, STATUS as JOB_STATUS_LABELS }
