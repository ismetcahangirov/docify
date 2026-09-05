// @vitest-environment node

/**
 * The queue reducer (issue #57).
 *
 * Two properties are worth as much as the behaviour itself and are asserted
 * throughout: nothing is ever mutated, and an action that changes nothing hands
 * back the *same array*. The second is not tidiness — progress ticks arrive
 * several times a second per job, and the ones aimed at a job that has already
 * finished are exactly the ones that must cost no render.
 */

import { describe, expect, it } from 'vitest'

import type { QueuedJob } from '@/lib/queue/queue'
import { createJob, queueReducer } from '@/lib/queue/queue'
import type { JobEvent } from '@/lib/queue/state'

const file = (name = 'holiday.mov') => new File(['x'], name, { type: 'video/quicktime' })

const NOW = 1_700_000_000_000

const one = (over: Partial<QueuedJob> = {}): readonly QueuedJob[] => [
  { ...createJob('a', file()), ...over },
]

const at = (jobs: readonly QueuedJob[], id = 'a') => {
  const found = jobs.find((job) => job.id === id)
  if (found === undefined) throw new Error(`no job ${id}`)

  return found
}

describe('createJob', () => {
  it('starts queued, with nothing known about it yet', () => {
    const job = createJob('a', file())

    expect(job).toMatchObject({ id: 'a', state: 'queued', progress: null })
    expect(job.engine).toBeUndefined()
    expect(job.startedAt).toBeUndefined()
  })
})

describe('add', () => {
  it('appends in the order the files were offered', () => {
    const jobs = queueReducer([], {
      type: 'add',
      jobs: [createJob('a', file('a.mov')), createJob('b', file('b.mov'))],
    })

    expect(jobs.map((job) => job.id)).toEqual(['a', 'b'])
  })

  it('keeps what was already there', () => {
    const first = queueReducer([], { type: 'add', jobs: [createJob('a', file())] })
    const second = queueReducer(first, { type: 'add', jobs: [createJob('b', file())] })

    expect(second.map((job) => job.id)).toEqual(['a', 'b'])
    expect(first.map((job) => job.id)).toEqual(['a'])
  })

  it('hands back the same list for an empty drop', () => {
    const jobs = one()

    expect(queueReducer(jobs, { type: 'add', jobs: [] })).toBe(jobs)
  })
})

describe('advance', () => {
  it('moves a job along and records what the step produced', () => {
    const jobs = queueReducer(one({ state: 'routing' }), {
      type: 'advance',
      id: 'a',
      event: 'routed',
      at: NOW,
      patch: { engine: 'webcodecs', reason: 'Hardware-accelerated (WebCodecs)' },
    })

    expect(at(jobs)).toMatchObject({
      state: 'loading-engine',
      engine: 'webcodecs',
      reason: 'Hardware-accelerated (WebCodecs)',
    })
  })

  it('ignores a move the table does not allow, and does not re-render for it', () => {
    // The late message the state table exists for: a result that arrives after
    // the user has already cancelled.
    const jobs = one({ state: 'queued' })

    expect(queueReducer(jobs, { type: 'advance', id: 'a', event: 'succeed', at: NOW })).toBe(jobs)
  })

  it('ignores an id that is not in the list', () => {
    const jobs = one()

    expect(queueReducer(jobs, { type: 'advance', id: 'gone', event: 'start', at: NOW })).toBe(jobs)
  })

  it('stamps the start, which is the clock an ETA runs on', () => {
    const jobs = queueReducer(one(), { type: 'advance', id: 'a', event: 'start', at: NOW })

    expect(at(jobs)).toMatchObject({ state: 'routing', startedAt: NOW })
  })

  it('stamps the end on both ways of finishing', () => {
    const done = queueReducer(one({ state: 'processing' }), {
      type: 'advance',
      id: 'a',
      event: 'succeed',
      at: NOW,
    })
    const failed = queueReducer(one({ state: 'processing' }), {
      type: 'advance',
      id: 'a',
      event: 'fail',
      at: NOW,
    })

    expect(at(done).endedAt).toBe(NOW)
    expect(at(failed).endedAt).toBe(NOW)
  })

  it('clears the last run when a job is started again', () => {
    // A stale failure under a moving bar is worse than no explanation at all.
    const finished = one({
      state: 'failed',
      progress: 1,
      endedAt: NOW,
      failure: { message: 'That did not work.' },
      engine: 'ffmpeg',
    })

    const retried = queueReducer(finished, { type: 'advance', id: 'a', event: 'retry', at: NOW })
    const restarted = queueReducer(retried, {
      type: 'advance',
      id: 'a',
      event: 'start',
      at: NOW + 10,
    })

    expect(at(restarted)).toMatchObject({ state: 'routing', progress: null, startedAt: NOW + 10 })
    expect(at(restarted).failure).toBeUndefined()
    expect(at(restarted).engine).toBeUndefined()
    expect(at(restarted).endedAt).toBeUndefined()
  })

  it('forgets the outcome the moment a job is retried, not only when it restarts', () => {
    // A retried job can wait in `queued` behind whatever is running (issue
    // #263), and a "Waiting" card that still says "could not convert" reads as
    // a retry that did nothing.
    const finished = one({
      state: 'failed',
      progress: 1,
      startedAt: NOW - 10,
      endedAt: NOW,
      failure: { message: 'That did not work.' },
      engine: 'ffmpeg',
      reason: 'Fallback',
      warnings: [],
    })

    const retried = queueReducer(finished, { type: 'advance', id: 'a', event: 'retry', at: NOW })

    expect(at(retried)).toMatchObject({ state: 'queued', progress: null })
    expect(at(retried).failure).toBeUndefined()
    expect(at(retried).result).toBeUndefined()
    expect(at(retried).engine).toBeUndefined()
    expect(at(retried).reason).toBeUndefined()
    expect(at(retried).warnings).toBeUndefined()
    expect(at(retried).startedAt).toBeUndefined()
    expect(at(retried).endedAt).toBeUndefined()
    expect(at(retried).file).toBeDefined()
  })

  it('forgets the run when a job is cancelled', () => {
    const running = one({
      state: 'processing',
      progress: 0.4,
      startedAt: NOW,
      engine: 'ffmpeg',
    })

    const cancelled = queueReducer(running, { type: 'advance', id: 'a', event: 'cancel', at: NOW })

    expect(at(cancelled)).toMatchObject({ state: 'queued', progress: null })
    expect(at(cancelled).startedAt).toBeUndefined()
    // The file is still in the list, which is the whole reason a cancel is not
    // a dead end.
    expect(at(cancelled).file).toBeDefined()
  })

  it('marks a cancelled job, because `queued` alone cannot say nobody will start it', () => {
    // The scheduler leaves a cancelled job in its `started` set so it does not
    // restart itself, which makes it indistinguishable from a fresh drop by
    // state alone — and a card with no control on it (issue #278).
    const running = one({ state: 'processing', progress: 0.4, startedAt: NOW })

    const cancelled = queueReducer(running, { type: 'advance', id: 'a', event: 'cancel', at: NOW })

    expect(at(cancelled).cancelled).toBe(true)
  })

  it('leaves a job that has run all the way through unmarked', () => {
    // Only a stop earns the mark. A job that started, routed and finished must
    // never carry it, or every settled card would offer to start itself.
    const added = queueReducer([], { type: 'add', jobs: one() })
    const events: JobEvent[] = ['start', 'routed', 'loaded', 'succeed']

    const finished = events.reduce(
      (jobs, event) => queueReducer(jobs, { type: 'advance', id: 'a', event, at: NOW }),
      added,
    )

    expect(at(finished).state).toBe('done')
    expect(at(finished).cancelled).toBeUndefined()
  })

  it('clears the mark when a cancelled job is asked to go again', () => {
    // `retry` from `queued` moves nothing, and exists for exactly this: the
    // job is in the line again, so the card stops offering to start it.
    const cancelled = one({ state: 'queued', cancelled: true })

    const requeued = queueReducer(cancelled, {
      type: 'advance',
      id: 'a',
      event: 'retry',
      at: NOW,
    })

    expect(at(requeued)).toMatchObject({ state: 'queued' })
    expect(at(requeued).cancelled).toBeUndefined()
    expect(at(requeued).file).toBeDefined()
  })

  it('clears the mark when the scheduler starts a cancelled job', () => {
    const cancelled = one({ state: 'queued', cancelled: true })

    const started = queueReducer(cancelled, { type: 'advance', id: 'a', event: 'start', at: NOW })

    expect(at(started)).toMatchObject({ state: 'routing' })
    expect(at(started).cancelled).toBeUndefined()
  })

  it('never mutates the job it replaces', () => {
    const before = one({ state: 'routing' })
    queueReducer(before, { type: 'advance', id: 'a', event: 'routed', at: NOW })

    expect(before[0].state).toBe('routing')
  })
})

describe('progress', () => {
  it('records a tick while the engine is working', () => {
    const jobs = queueReducer(one({ state: 'processing' }), {
      type: 'progress',
      id: 'a',
      progress: 0.25,
    })

    expect(at(jobs).progress).toBe(0.25)
  })

  it('keeps indeterminate as indeterminate', () => {
    // `-1` and `null` are different things: something is happening and cannot
    // say how far along, against nothing has happened yet.
    const jobs = queueReducer(one({ state: 'processing' }), {
      type: 'progress',
      id: 'a',
      progress: -1,
    })

    expect(at(jobs).progress).toBe(-1)
  })

  it('clamps a fraction slightly over one rather than failing the job', () => {
    const jobs = queueReducer(one({ state: 'processing' }), {
      type: 'progress',
      id: 'a',
      progress: 1.0001,
    })

    expect(at(jobs).progress).toBe(1)
  })

  it('drops a tick for a job that is not processing', () => {
    for (const state of ['queued', 'routing', 'loading-engine', 'done', 'failed'] as const) {
      const jobs = one({ state })

      expect(queueReducer(jobs, { type: 'progress', id: 'a', progress: 0.5 })).toBe(jobs)
    }
  })

  it('does not re-render for a tick that says the same thing', () => {
    const jobs = one({ state: 'processing', progress: 0.5 })

    expect(queueReducer(jobs, { type: 'progress', id: 'a', progress: 0.5 })).toBe(jobs)
  })
})

describe('remove and clearFinished', () => {
  it('drops one job by id', () => {
    const jobs = [createJob('a', file()), createJob('b', file())]

    expect(queueReducer(jobs, { type: 'remove', id: 'a' }).map((job) => job.id)).toEqual(['b'])
  })

  it('hands back the same list for an id that is not there', () => {
    const jobs = one()

    expect(queueReducer(jobs, { type: 'remove', id: 'gone' })).toBe(jobs)
  })

  it('clears what has finished and keeps what is still running', () => {
    const jobs: QueuedJob[] = [
      { ...createJob('a', file()), state: 'done' },
      { ...createJob('b', file()), state: 'processing' },
      { ...createJob('c', file()), state: 'failed' },
      { ...createJob('d', file()), state: 'queued' },
    ]

    expect(queueReducer(jobs, { type: 'clearFinished' }).map((job) => job.id)).toEqual(['b', 'd'])
  })

  it('hands back the same list when nothing has finished', () => {
    const jobs = one({ state: 'processing' })

    expect(queueReducer(jobs, { type: 'clearFinished' })).toBe(jobs)
  })
})
