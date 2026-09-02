// @vitest-environment node

/**
 * The finished half of the queue (issue #61).
 *
 * A pure projection: which jobs have a file to download, what each of those
 * files is called, and how much there is to download altogether. Kept out of the
 * panel that renders it so that the naming rules — including the collision rule
 * a ZIP depends on — can be asserted without a DOM.
 */

import { describe, expect, it } from 'vitest'

import { createJob, type QueuedJob } from '@/lib/queue/queue'
import { finishedResults, totalResultBytes } from '@/lib/queue/results'

const blob = (bytes: number) => new Blob(['x'.repeat(bytes)], { type: 'image/jpeg' })

const done = (id: string, name: string, bytes = 10): QueuedJob => ({
  ...createJob(id, new File(['y'], name)),
  state: 'done',
  result: blob(bytes),
})

describe('finishedResults', () => {
  it('is empty while nothing has finished', () => {
    expect(finishedResults([createJob('a', new File(['y'], 'a.heic'))], 'jpg')).toEqual([])
  })

  it('names each result after its source, with the target extension', () => {
    const results = finishedResults([done('a', 'IMG_4021.HEIC')], 'jpg')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: 'a', name: 'IMG_4021.jpg', bytes: 10 })
  })

  it('keeps the order the files were dropped in', () => {
    const results = finishedResults([done('a', 'a.heic'), done('b', 'b.heic')], 'jpg')

    expect(results.map((result) => result.id)).toEqual(['a', 'b'])
  })

  /*
   * Two files called `scan.heic` from two different folders convert to two
   * files called `scan.jpg`. In a ZIP the second silently replaces the first, so
   * the collision is settled here, once, and the same names are used for the
   * individual downloads — otherwise the archive and the list disagree.
   */
  it('makes colliding names distinct, in the order they arrived', () => {
    const results = finishedResults([done('a', 'scan.heic'), done('b', 'scan.heic')], 'jpg')

    expect(results.map((result) => result.name)).toEqual(['scan.jpg', 'scan-2.jpg'])
  })

  it('ignores a job that is still running, and one that failed', () => {
    const running: QueuedJob = { ...createJob('r', new File(['y'], 'r.heic')), state: 'processing' }
    const failed: QueuedJob = {
      ...createJob('f', new File(['y'], 'f.heic')),
      state: 'failed',
      failure: { message: 'no' },
    }

    expect(finishedResults([running, failed, done('a', 'a.heic')], 'jpg')).toHaveLength(1)
  })

  /*
   * `done` without a blob cannot happen through the reducer, but a result panel
   * that trusts the state alone renders a download link to nothing.
   */
  it('ignores a job marked done that carries no file', () => {
    const empty: QueuedJob = { ...createJob('a', new File(['y'], 'a.heic')), state: 'done' }

    expect(finishedResults([empty], 'jpg')).toEqual([])
  })
})

describe('totalResultBytes', () => {
  it('adds up what a download-all would weigh', () => {
    const results = finishedResults([done('a', 'a.heic', 100), done('b', 'b.heic', 250)], 'jpg')

    expect(totalResultBytes(results)).toBe(350)
  })

  it('is zero with nothing to download', () => {
    expect(totalResultBytes([])).toBe(0)
  })
})
