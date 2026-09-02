'use client'

import * as React from 'react'

import { queueAnnouncement } from '@/lib/queue/announcements'
import type { QueuedJob } from '@/lib/queue/queue'
import { cn } from '@/lib/utils'

/*
 * The queue, out loud (issue #63).
 *
 * A conversion is a long, silent operation that finishes while the user is
 * looking somewhere else. On screen the list rewrites itself and that is enough;
 * to somebody using a screen reader a list quietly rewriting itself produces no
 * announcement at all, and the page simply never says the file is ready.
 *
 * ## One region for the whole queue
 *
 * Not one per card. Twenty cards would be twenty live regions competing for the
 * same voice, and — worse — the card's status line contains a countdown, so each
 * region would re-announce itself once a second for as long as its job ran. This
 * is the single region, and `lib/queue/announcements.ts` decides its one
 * sentence per change.
 *
 * ## Why the text is state and not derived during render
 *
 * The sentence is a function of the *previous* list as well as the current one,
 * and comparing against a ref during render would read a value React is free to
 * have discarded. The comparison happens in an effect, where the render it is
 * comparing against is the one that was committed.
 *
 * ## Why it is visually hidden rather than absent
 *
 * `sr-only`, not `hidden` and not conditional rendering. A live region has to be
 * in the accessible tree *before* its text changes: one that is added to the
 * document already containing the message is, in most screen readers, not
 * announced at all. So it renders empty and stays.
 */

export type QueueAnnouncerProps = Omit<React.ComponentProps<'p'>, 'children'> & {
  jobs: readonly QueuedJob[]
}

function QueueAnnouncer({ className, jobs, ...props }: QueueAnnouncerProps) {
  const [message, setMessage] = React.useState('')
  const previous = React.useRef<readonly QueuedJob[]>(jobs)

  React.useEffect(() => {
    const said = queueAnnouncement(previous.current, jobs)
    previous.current = jobs

    // `null` means nothing worth saying happened — a progress tick, an engine
    // loading. The last sentence is left standing rather than cleared: clearing
    // is itself a change, and a region that empties reads as a second event.
    if (said !== null) setMessage(said)
  }, [jobs])

  return (
    <p
      data-slot="queue-announcer"
      // `status` carries an implicit `aria-live="polite"`; both are written out
      // because the implicit value is what varies between screen readers.
      role="status"
      aria-live="polite"
      // The sentence is one thought and is read as one. Without this, a reader
      // announces only the changed words, which turns "2 of 5 done" into "5".
      aria-atomic="true"
      className={cn('sr-only', className)}
      {...props}
    >
      {message}
    </p>
  )
}

export { QueueAnnouncer }
