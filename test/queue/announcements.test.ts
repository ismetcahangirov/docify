// @vitest-environment node

/**
 * What the queue says out loud (issue #63).
 *
 * A pure function over two snapshots of the list, so the hard part — deciding
 * what is worth interrupting somebody for, and what is noise — can be asserted
 * without a DOM and without a screen reader.
 */

import { describe, expect, it } from 'vitest'

import { queueAnnouncement } from '@/lib/queue/announcements'
import { createJob, type QueuedJob } from '@/lib/queue/queue'
import type { JobState } from '@/lib/queue/state'

const job = (id: string, state: JobState, name = `${id}.heic`): QueuedJob => ({
  ...createJob(id, new File(['x'], name)),
  state,
})

describe('queueAnnouncement — silence', () => {
  it('says nothing about an unchanged list', () => {
    const jobs = [job('a', 'processing')]

    expect(queueAnnouncement(jobs, jobs)).toBeNull()
  })

  it('says nothing about a progress tick', () => {
    const before = [job('a', 'processing')]
    const after = [{ ...before[0], progress: 0.4 }]

    expect(queueAnnouncement(before, after)).toBeNull()
  })

  /*
   * Routing and engine loading change several times a second across a batch. A
   * region that read every one of them would be unusable, and none of them is
   * news: the user already knows they pressed convert.
   */
  it('says nothing about the steps between starting and working', () => {
    expect(queueAnnouncement([job('a', 'routing')], [job('a', 'loading-engine')])).toBeNull()
    expect(queueAnnouncement([job('a', 'loading-engine')], [job('a', 'processing')])).toBeNull()
  })

  it('says nothing about a job leaving the list', () => {
    expect(queueAnnouncement([job('a', 'done')], [])).toBeNull()
  })
})

describe('queueAnnouncement — files arriving', () => {
  it('names a single file', () => {
    expect(queueAnnouncement([], [job('a', 'queued', 'beach.heic')])).toBe(
      'beach.heic added. 1 file in the queue.',
    )
  })

  it('counts several', () => {
    const after = [job('a', 'queued'), job('b', 'queued'), job('c', 'queued')]

    expect(queueAnnouncement([], after)).toBe('3 files added. 3 files in the queue.')
  })
})

describe('queueAnnouncement — work starting', () => {
  it('names the file it has started on', () => {
    expect(
      queueAnnouncement([job('a', 'queued', 'beach.heic')], [job('a', 'routing', 'beach.heic')]),
    ).toBe('Converting beach.heic.')
  })

  it('counts a batch rather than reading out every name', () => {
    const before = [job('a', 'queued'), job('b', 'queued')]
    const after = [job('a', 'routing'), job('b', 'routing')]

    expect(queueAnnouncement(before, after)).toBe('Converting 2 files.')
  })
})

describe('queueAnnouncement — work finishing', () => {
  it('says a single file is ready, and where it stands', () => {
    const before = [job('a', 'processing', 'beach.heic')]
    const after = [job('a', 'done', 'beach.heic')]

    expect(queueAnnouncement(before, after)).toBe('beach.heic is ready to download.')
  })

  it('counts a batch, and says how much of it is finished', () => {
    const before = [job('a', 'processing'), job('b', 'processing'), job('c', 'queued')]
    const after = [job('a', 'done'), job('b', 'done'), job('c', 'queued')]

    expect(queueAnnouncement(before, after)).toBe('2 files converted. 2 of 3 done.')
  })

  it('names a failure as a failure', () => {
    const before = [job('a', 'processing', 'beach.heic')]
    const after = [job('a', 'failed', 'beach.heic')]

    expect(queueAnnouncement(before, after)).toBe('beach.heic could not be converted.')
  })

  it('reports both halves of a mixed batch', () => {
    const before = [job('a', 'processing'), job('b', 'processing')]
    const after = [job('a', 'done'), job('b', 'failed')]

    expect(queueAnnouncement(before, after)).toBe(
      '1 file converted, 1 could not be converted. 2 of 2 done.',
    )
  })

  /*
   * Screen readers skip a live region whose text has not changed. Two identical
   * batches finishing back to back would therefore be announced once — which is
   * why the running total is part of the sentence rather than an extra one.
   */
  it('differs between two identical batches finishing in a row', () => {
    const first = queueAnnouncement(
      [job('a', 'processing'), job('b', 'processing'), job('c', 'processing'), job('d', 'queued')],
      [job('a', 'done'), job('b', 'done'), job('c', 'processing'), job('d', 'queued')],
    )
    const second = queueAnnouncement(
      [job('a', 'done'), job('b', 'done'), job('c', 'processing'), job('d', 'processing')],
      [job('a', 'done'), job('b', 'done'), job('c', 'done'), job('d', 'done')],
    )

    expect(first).not.toBe(second)
  })
})

describe('queueAnnouncement — cancelling', () => {
  it('confirms the cancel, which the list alone does not', () => {
    const before = [job('a', 'processing', 'beach.heic')]
    const after = [job('a', 'queued', 'beach.heic')]

    expect(queueAnnouncement(before, after)).toBe('Cancelled beach.heic. It is back in the queue.')
  })

  it('counts several', () => {
    const before = [job('a', 'processing'), job('b', 'processing')]
    const after = [job('a', 'queued'), job('b', 'queued')]

    expect(queueAnnouncement(before, after)).toBe('Cancelled 2 files. They are back in the queue.')
  })
})

describe('queueAnnouncement — precedence', () => {
  /*
   * One render can carry more than one kind of news: a job finishes and the
   * next one starts in the same dispatch. The result is one sentence, and it is
   * about the outcome — a start can be inferred from the list, an outcome
   * cannot.
   */
  it('reports the outcome rather than the next job starting', () => {
    const before = [job('a', 'processing'), job('b', 'queued')]
    const after = [job('a', 'done'), job('b', 'routing')]

    expect(queueAnnouncement(before, after)).toBe('a.heic is ready to download. 1 of 2 done.')
  })

  it('reports work starting rather than files arriving', () => {
    const before = [job('a', 'queued')]
    const after = [job('a', 'routing'), job('b', 'queued')]

    expect(queueAnnouncement(before, after)).toBe('Converting a.heic.')
  })
})
