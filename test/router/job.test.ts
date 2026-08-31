// @vitest-environment node
//
// The job shape is the router's view of the *input side* of a conversion, and
// like the rest of the router it is a pure function of its arguments. No DOM in
// scope, so a stray environment read fails here rather than during SSR.

import { describe, expect, it } from 'vitest'

import { isMeasurable, jobInput } from '@/lib/router/job'

const MB = 1024 * 1024

describe('jobInput', () => {
  it('reads a single number as a one-file job', () => {
    expect(jobInput(3 * MB)).toEqual({
      totalBytes: 3 * MB,
      largestBytes: 3 * MB,
      smallestBytes: 3 * MB,
      fileCount: 1,
      totalPixels: 0,
      largestPixels: 0,
    })
  })

  it('sums a list, and remembers its extremes', () => {
    // Deliberately unsorted: the order is the user's and must not be assumed.
    expect(jobInput([5 * MB, MB, 3 * MB])).toEqual({
      totalBytes: 9 * MB,
      largestBytes: 5 * MB,
      smallestBytes: MB,
      fileCount: 3,
      totalPixels: 0,
      largestPixels: 0,
    })
  })

  it('describes an empty list as a job with nothing in it', () => {
    expect(jobInput([])).toEqual({
      totalBytes: 0,
      largestBytes: 0,
      smallestBytes: 0,
      fileCount: 0,
      totalPixels: 0,
      largestPixels: 0,
    })
  })

  it('treats a one-element list exactly like the bare number', () => {
    expect(jobInput([7 * MB])).toEqual(jobInput(7 * MB))
  })

  it('does not mutate the array it is handed', () => {
    const sizes = [5 * MB, MB, 3 * MB]

    jobInput(sizes)

    expect(sizes).toEqual([5 * MB, MB, 3 * MB])
  })

  it('carries an unreadable size through rather than hiding it', () => {
    // Repairing a NaN here would let it reach the budget arithmetic, where it
    // silently makes every comparison false. `isMeasurable` is the gate.
    expect(jobInput(Number.NaN).totalBytes).toBeNaN()
    expect(jobInput([MB, Number.NaN]).totalBytes).toBeNaN()
  })
})

describe('isMeasurable', () => {
  it('accepts a job whose every file has bytes in it', () => {
    expect(isMeasurable(jobInput(MB))).toBe(true)
    expect(isMeasurable(jobInput([MB, 2 * MB, 3 * MB]))).toBe(true)
  })

  it('refuses a job with no files at all', () => {
    expect(isMeasurable(jobInput([]))).toBe(false)
  })

  it('refuses a job in which any single file is empty', () => {
    // A merge of nine real PDFs and one zero-byte file fails at the parser
    // after the download; refusing before it is the whole point of the check.
    expect(isMeasurable(jobInput(0))).toBe(false)
    expect(isMeasurable(jobInput([MB, 0, MB]))).toBe(false)
  })

  it('refuses negative, infinite and unreadable sizes', () => {
    expect(isMeasurable(jobInput(-1))).toBe(false)
    expect(isMeasurable(jobInput(Number.NaN))).toBe(false)
    expect(isMeasurable(jobInput(Number.POSITIVE_INFINITY))).toBe(false)
    expect(isMeasurable(jobInput([MB, Number.NaN]))).toBe(false)
    expect(isMeasurable(jobInput([MB, -MB]))).toBe(false)
  })
})

describe('jobInput, on files that carry a pixel count', () => {
  it('keeps both totals, so either scope can be budgeted', () => {
    const job = jobInput([
      { bytes: MB, pixels: 2_000_000 },
      { bytes: 3 * MB, pixels: 1_000_000 },
    ])

    expect(job).toEqual({
      totalBytes: 4 * MB,
      largestBytes: 3 * MB,
      smallestBytes: MB,
      fileCount: 2,
      totalPixels: 3_000_000,
      largestPixels: 2_000_000,
    })
  })

  it('reports the largest pixel count, not the pixels of the largest file', () => {
    // The two are different images and the difference is the whole point: a
    // flat screenshot is smaller in bytes than a photograph a quarter its size,
    // and it is the screenshot that decides whether the decode fits.
    const job = jobInput([
      { bytes: 20 * MB, pixels: 2_000_000 },
      { bytes: MB, pixels: 24_000_000 },
    ])

    expect(job.largestBytes).toBe(20 * MB)
    expect(job.largestPixels).toBe(24_000_000)
  })

  it('treats a file with no pixel count as saying nothing, not as saying zero', () => {
    const job = jobInput([{ bytes: MB, pixels: 5_000_000 }, { bytes: MB }])

    expect(job.totalPixels).toBe(5_000_000)
    expect(job.largestPixels).toBe(5_000_000)
    expect(job.fileCount).toBe(2)
  })

  it('answers the same as a plain list when no file carries pixels', () => {
    expect(jobInput([{ bytes: 5 * MB }, { bytes: MB }])).toEqual(jobInput([5 * MB, MB]))
  })
})
