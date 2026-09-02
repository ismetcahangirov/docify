import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { QueueAnnouncer } from '@/components/converter/queue-announcer'
import { createJob, type QueuedJob } from '@/lib/queue/queue'
import type { JobState } from '@/lib/queue/state'

/*
 * The queue's live region (issue #63).
 *
 * What is asserted here is the plumbing, not the wording — the sentences belong
 * to `lib/queue/announcements.ts` and are tested there. The plumbing is the half
 * that fails silently: a region that is added to the document already holding
 * its message is, in most screen readers, never announced.
 */

const job = (id: string, state: JobState, name = `${id}.heic`): QueuedJob => ({
  ...createJob(id, new File(['x'], name)),
  state,
})

const region = () => screen.getByRole('status')

describe('QueueAnnouncer', () => {
  it('is in the document from the start, and empty', () => {
    render(<QueueAnnouncer jobs={[]} />)

    expect(region()).toBeInTheDocument()
    expect(region()).toBeEmptyDOMElement()
  })

  it('is polite and read as one thought', () => {
    render(<QueueAnnouncer jobs={[]} />)

    expect(region()).toHaveAttribute('aria-live', 'polite')
    expect(region()).toHaveAttribute('aria-atomic', 'true')
  })

  it('is available to a screen reader and to nothing else', () => {
    render(<QueueAnnouncer jobs={[]} />)

    expect(region().className).toContain('sr-only')
    expect(region()).not.toHaveAttribute('hidden')
    expect(region()).not.toHaveAttribute('aria-hidden')
  })

  it('says nothing about the list it was mounted with', () => {
    render(<QueueAnnouncer jobs={[job('a', 'queued')]} />)

    expect(region()).toBeEmptyDOMElement()
  })

  it('speaks when a job finishes', () => {
    const { rerender } = render(<QueueAnnouncer jobs={[job('a', 'processing', 'beach.heic')]} />)

    rerender(<QueueAnnouncer jobs={[job('a', 'done', 'beach.heic')]} />)

    expect(region().textContent).toBe('beach.heic is ready to download.')
  })

  /*
   * Clearing is itself a change, and a region that empties is announced as a
   * second event — a pause where the user is told nothing twice.
   */
  it('leaves the last sentence standing when nothing new has happened', () => {
    const { rerender } = render(<QueueAnnouncer jobs={[job('a', 'processing', 'beach.heic')]} />)

    rerender(<QueueAnnouncer jobs={[job('a', 'done', 'beach.heic')]} />)
    rerender(<QueueAnnouncer jobs={[{ ...job('a', 'done', 'beach.heic'), progress: 1 }]} />)

    expect(region().textContent).toBe('beach.heic is ready to download.')
  })
})
