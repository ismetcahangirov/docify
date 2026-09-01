// @vitest-environment node

/**
 * The state table (issue #57), tested as a table.
 *
 * The acceptance criterion is "no impossible transitions", and a suite of
 * examples cannot say that: it says the moves someone thought of are legal.
 * What is asserted instead is the whole cross product — every state against
 * every event — so a move added by accident fails here rather than in front of
 * a user, as a bar moving on a job nobody is running.
 */

import { describe, expect, it } from 'vitest'

import type { JobEvent, JobState } from '@/lib/queue/state'
import { canTransition, isFinished, isRunning, TRANSITIONS, transition } from '@/lib/queue/state'

/** The six states the issue names, listed independently of the table. */
const STATES: readonly JobState[] = [
  'queued',
  'routing',
  'loading-engine',
  'processing',
  'done',
  'failed',
]

const EVENTS: readonly JobEvent[] = [
  'start',
  'routed',
  'loaded',
  'succeed',
  'fail',
  'cancel',
  'retry',
]

/** Every move that is meant to exist, written out rather than derived. */
const LEGAL: readonly (readonly [JobState, JobEvent, JobState])[] = [
  ['queued', 'start', 'routing'],
  ['routing', 'routed', 'loading-engine'],
  ['routing', 'fail', 'failed'],
  ['routing', 'cancel', 'queued'],
  ['loading-engine', 'loaded', 'processing'],
  ['loading-engine', 'fail', 'failed'],
  ['loading-engine', 'cancel', 'queued'],
  ['processing', 'succeed', 'done'],
  ['processing', 'fail', 'failed'],
  ['processing', 'cancel', 'queued'],
  ['done', 'retry', 'queued'],
  ['failed', 'retry', 'queued'],
]

const key = (state: JobState, event: JobEvent) => `${state}/${event}`
const legal = new Map(LEGAL.map(([state, event, next]) => [key(state, event), next]))

describe('the state table', () => {
  it('covers exactly the six states the queue renders', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...STATES].sort())
  })

  it('allows every move that is meant to exist, and nothing else', () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        expect([state, event, transition(state, event)]).toEqual([
          state,
          event,
          legal.get(key(state, event)) ?? null,
        ])
      }
    }
  })

  it('never leaves a state that is not one of the six', () => {
    for (const state of STATES) {
      for (const next of Object.values(TRANSITIONS[state])) {
        expect(STATES).toContain(next)
      }
    }
  })
})

describe('transition', () => {
  it('answers null for a move that does not exist, rather than throwing', () => {
    // A result that arrives after a cancel is not a bug to crash over; it is the
    // ordinary consequence of the worker being on another thread.
    expect(transition('queued', 'succeed')).toBeNull()
    expect(transition('done', 'fail')).toBeNull()
    expect(transition('failed', 'succeed')).toBeNull()
  })

  it('cannot restart a running job', () => {
    // Two workers on one file, two results, and a list that shows whichever
    // arrived last.
    expect(transition('routing', 'start')).toBeNull()
    expect(transition('loading-engine', 'start')).toBeNull()
    expect(transition('processing', 'start')).toBeNull()
  })

  it('cannot skip the middle of a run', () => {
    expect(transition('queued', 'loaded')).toBeNull()
    expect(transition('routing', 'succeed')).toBeNull()
    expect(transition('queued', 'routed')).toBeNull()
  })

  it('cannot cancel what is not running', () => {
    expect(transition('queued', 'cancel')).toBeNull()
    expect(transition('done', 'cancel')).toBeNull()
    expect(transition('failed', 'cancel')).toBeNull()
  })

  it('sends a cancelled job back to the queue, with the file still in the list', () => {
    // A dead end would make the user drop the file a second time.
    expect(transition('processing', 'cancel')).toBe('queued')
    expect(transition('loading-engine', 'cancel')).toBe('queued')
  })

  it('retries from the beginning, because the device may have changed', () => {
    expect(transition('failed', 'retry')).toBe('queued')
    expect(transition('done', 'retry')).toBe('queued')
  })

  it('agrees with canTransition on every pair', () => {
    for (const state of STATES) {
      for (const event of EVENTS) {
        expect(canTransition(state, event)).toBe(transition(state, event) !== null)
      }
    }
  })
})

describe('isFinished and isRunning', () => {
  it('call exactly the two terminal states finished', () => {
    expect(STATES.filter(isFinished)).toEqual(['done', 'failed'])
  })

  it('call exactly the three working states running', () => {
    expect(STATES.filter(isRunning)).toEqual(['routing', 'loading-engine', 'processing'])
  })

  it('never call the same state both', () => {
    for (const state of STATES) {
      expect(isFinished(state) && isRunning(state)).toBe(false)
    }
  })
})
