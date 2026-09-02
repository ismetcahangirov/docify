/**
 * What the queue says out loud.
 *
 * A conversion is a long silent operation that finishes while the user is
 * looking somewhere else, so the list changing is news — and to somebody using a
 * screen reader it is news that never arrives, because a list quietly rewriting
 * itself produces no announcement at all.
 *
 * This module decides the sentence; `components/converter/queue-announcer.tsx`
 * puts it in a live region. Splitting them is what lets the hard half — which
 * changes are worth interrupting somebody for, and which are noise — be asserted
 * without a DOM.
 *
 * ## Why one region and not one per card
 *
 * The obvious shape is `aria-live` on each card's status line, and it fails at
 * two files. Twenty cards is twenty live regions competing; worse, the ETA is
 * inside that line and updates once a second, so each card re-announces itself
 * every second for as long as it runs. One region, one sentence per change,
 * coalesced across the whole batch.
 *
 * ## What is deliberately never announced
 *
 * Progress, `routing`, and `loading-engine`. All three change several times a
 * second across a batch, and none is news: the user pressed convert and knows
 * it. The bar and the card carry them visually for anybody watching.
 */

import type { JobState } from './state'
import { isRunning } from './state'
import type { QueuedJob } from './queue'

/** Everything that changed between two snapshots, counted rather than listed. */
interface Changes {
  added: QueuedJob[]
  started: QueuedJob[]
  done: QueuedJob[]
  failed: QueuedJob[]
  cancelled: QueuedJob[]
}

/**
 * One sentence about what just happened to the list, or `null` when nothing
 * worth saying did.
 *
 * Coalesced: a dispatch that finishes four files produces one sentence about
 * four files, not four sentences. When a render carries more than one kind of
 * news the outcome wins — a job starting can be inferred from the list, a job
 * having failed cannot.
 */
export function queueAnnouncement(
  before: readonly QueuedJob[],
  after: readonly QueuedJob[],
): string | null {
  const changes = diff(before, after)

  const finished = finishedSentence(changes, after)
  if (finished !== null) return finished

  if (changes.cancelled.length > 0) return cancelledSentence(changes.cancelled)
  if (changes.started.length > 0) return startedSentence(changes.started)
  if (changes.added.length > 0) return addedSentence(changes.added, after)

  return null
}

/** Which jobs crossed which line between the two snapshots. */
function diff(before: readonly QueuedJob[], after: readonly QueuedJob[]): Changes {
  const was = new Map(before.map((job) => [job.id, job.state]))
  const changes: Changes = { added: [], started: [], done: [], failed: [], cancelled: [] }

  for (const job of after) {
    const previous = was.get(job.id)

    if (previous === undefined) {
      changes.added.push(job)
      continue
    }

    if (previous === job.state) continue

    if (job.state === 'done') changes.done.push(job)
    else if (job.state === 'failed') changes.failed.push(job)
    // Back to `queued` from a state that was running is the only way a cancel
    // shows up in the list — see the header of `./state` for why there is no
    // `cancelled` state to look for instead.
    else if (job.state === 'queued' && isRunning(previous)) changes.cancelled.push(job)
    else if (previous === 'queued' && isRunning(job.state)) changes.started.push(job)
  }

  return changes
}

/**
 * The outcome of whatever just finished, with the batch's running total.
 *
 * The total is not decoration. A screen reader skips a live region whose text
 * has not changed, so two identical batches finishing back to back would be
 * announced once; "2 of 5 done" then "4 of 5 done" is both more useful and
 * reliably different.
 */
function finishedSentence(changes: Changes, after: readonly QueuedJob[]): string | null {
  const { done, failed } = changes
  if (done.length === 0 && failed.length === 0) return null

  const single =
    done.length + failed.length === 1
      ? done.length === 1
        ? `${done[0].file.name} is ready to download.`
        : `${failed[0].file.name} could not be converted.`
      : null

  if (single !== null && after.length === 1) return single

  const parts: string[] = []
  if (done.length > 0) parts.push(`${count(done.length)} converted`)
  if (failed.length > 0)
    parts.push(`${done.length > 0 ? failed.length : count(failed.length)} could not be converted`)

  const outcome = single ?? `${parts.join(', ')}.`
  const settled = after.filter((job) => job.state === 'done' || job.state === 'failed').length

  return `${outcome} ${settled} of ${after.length} done.`
}

function cancelledSentence(cancelled: readonly QueuedJob[]): string {
  return cancelled.length === 1
    ? `Cancelled ${cancelled[0].file.name}. It is back in the queue.`
    : `Cancelled ${count(cancelled.length)}. They are back in the queue.`
}

function startedSentence(started: readonly QueuedJob[]): string {
  return started.length === 1
    ? `Converting ${started[0].file.name}.`
    : `Converting ${count(started.length)}.`
}

function addedSentence(added: readonly QueuedJob[], after: readonly QueuedJob[]): string {
  const what = added.length === 1 ? `${added[0].file.name} added` : `${count(added.length)} added`

  return `${what}. ${count(after.length)} in the queue.`
}

/** `1 file` / `4 files`, so no caller has to remember the plural. */
function count(n: number): string {
  return n === 1 ? '1 file' : `${n} files`
}

/** Re-exported for the announcer's own type, which is otherwise unreachable. */
export type { JobState }
