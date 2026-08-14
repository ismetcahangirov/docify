// @vitest-environment node
//
// The copy the user actually reads, asserted directly rather than through
// `route()`. CLAUDE.md §2.5 makes both fields a merge blocker, and "the
// suggestion is longer than ten characters" is not a test of that — these cases
// assert the sentences.

import { describe, expect, it } from 'vitest'

import type { EngineDescriptor } from '@/lib/engines/types'
import { jobInput } from '@/lib/router/job'
import { codecUnavailable, emptyInput, tooLarge, unsupportedPair } from '@/lib/router/rejections'
import type { Capabilities, ConversionTask, EngineId } from '@/lib/router/types'

const MB = 1024 * 1024

const desktop: Capabilities = {
  crossOriginIsolated: true,
  wasmSimd: true,
  deviceMemoryGb: 8,
  cores: 8,
  webCodecsVideo: true,
  webCodecsAudio: true,
  offscreenCanvas: true,
  createImageBitmap: true,
  platform: 'desktop',
  browser: 'chromium',
}

const ios: Capabilities = { ...desktop, deviceMemoryGb: 2, platform: 'ios', browser: 'safari' }

const merge: ConversionTask = { from: 'pdf', to: 'pdf', op: 'merge' }
const jpgToPng: ConversionTask = { from: 'jpg', to: 'png', op: 'convert' }

/** A descriptor is only a carrier here — `tooLarge` reads its `id`, nothing else. */
function engine(id: EngineId): EngineDescriptor {
  return { id, label: id, loadCost: 0, priority: 50, supports: () => true }
}

/** `pdflib` holds every file at once; `canvas` takes them one at a time. */
const allAtOnce = engine('pdflib')
const oneAtATime = engine('canvas')

describe('emptyInput', () => {
  it('says there are no files when the list is empty', () => {
    const result = emptyInput(jobInput([]))

    expect(result.code).toBe('EMPTY_INPUT')
    expect(result.message).toContain('No files were given')
    expect(result.message).not.toContain('this file is empty')
    expect(result.suggestion).toMatch(/choose at least one file/i)
  })

  it('blames the one file when there is only one', () => {
    const result = emptyInput(jobInput(0))

    expect(result.message).toContain('this file is empty')
    expect(result.suggestion).toMatch(/re-export/i)
  })

  it('counts the files when one of several is empty', () => {
    const result = emptyInput(jobInput([2 * MB, 0, 2 * MB]))

    expect(result.message).toContain('One of these 3 files is empty')
    expect(result.suggestion).toMatch(/remove the empty file/i)
  })
})

describe('unsupportedPair and codecUnavailable', () => {
  it('names both formats in upper case', () => {
    const result = unsupportedPair({ from: 'jpg', to: 'tiff', op: 'convert' })

    expect(result.code).toBe('UNSUPPORTED_PAIR')
    expect(result.message).toContain('JPG')
    expect(result.message).toContain('TIFF')
    expect(result.suggestion).toMatch(/chrome|edge/i)
  })

  it('lists every missing API, in both the message and the suggestion', () => {
    const result = codecUnavailable(jpgToPng, ['OffscreenCanvas', 'createImageBitmap'])

    expect(result.code).toBe('CODEC_UNAVAILABLE')
    expect(result.message).toContain('OffscreenCanvas and createImageBitmap')
    expect(result.suggestion).toContain('OffscreenCanvas and createImageBitmap')
  })

  it('still says something concrete when no API could be named', () => {
    // Reached only if `missingCapability` and the viability filter disagree,
    // which is a routing bug — but the user must not see a blank noun.
    const result = codecUnavailable(jpgToPng, [])

    expect(result.message).toContain('a browser API')
    expect(result.suggestion.length).toBeGreaterThan(10)
  })
})

describe('tooLarge — the six shapes of the sentence', () => {
  // pdflib on a desktop: (1200 − 32) / 4 = 292 MB across the job.
  // canvas on a desktop: 1200 / 6 = 200 MB for one image.

  it('one file, an engine that holds it alone, on a desktop', () => {
    const result = tooLarge(jpgToPng, jobInput(300 * MB), desktop, [oneAtATime])

    expect(result.code).toBe('FILE_TOO_LARGE')
    expect(result.message).toBe(
      'This file is 300 MB. The largest JPG file this device can convert safely is 200 MB.',
    )
    expect(result.suggestion).toMatch(/split the file/i)
  })

  it('one file, an engine that holds every file at once, on a desktop', () => {
    // A single-file job reads the same either way: there is no total to
    // distinguish from the largest member.
    const result = tooLarge(merge, jobInput(400 * MB), desktop, [allAtOnce])

    expect(result.message).toBe(
      'This file is 400 MB. The largest PDF file this device can convert safely is 292 MB.',
    )
  })

  it('several files, an engine that holds them all, on a desktop', () => {
    const hundredScans = jobInput(Array.from({ length: 100 }, () => 50 * MB))
    const result = tooLarge(merge, hundredScans, desktop, [allAtOnce])

    expect(result.code).toBe('FILE_TOO_LARGE')
    expect(result.message).toBe(
      'These 100 files are 4.9 GB together. In one job this device can handle 292 MB of PDF across every file.',
    )
    expect(result.suggestion).toMatch(/smaller batches/i)
  })

  it('several files, an engine that takes them one at a time, on a desktop', () => {
    const result = tooLarge(jpgToPng, jobInput([10 * MB, 300 * MB]), desktop, [oneAtATime])

    // The largest file, not the 310 MB total: that is what has to fit.
    expect(result.message).toBe(
      'The largest of these 2 files is 300 MB. The largest JPG file this device can convert safely is 200 MB.',
    )
    expect(result.suggestion).toMatch(/split the file/i)
  })

  it('a phone is told to change device, never to split the file', () => {
    // 90 MB iOS budget: (90 − 32) / 4 = 14.5 MB for pdflib, 90 / 6 = 15 MB for canvas.
    const one = tooLarge(jpgToPng, jobInput(300 * MB), ios, [oneAtATime])
    const many = tooLarge(merge, jobInput([20 * MB, 20 * MB]), ios, [allAtOnce])

    expect(one.code).toBe('DEVICE_TOO_WEAK')
    expect(many.code).toBe('DEVICE_TOO_WEAK')
    expect(one.message).toContain('15 MB')
    expect(many.message).toContain('40 MB together')
    expect(many.message).toContain('15 MB of PDF across every file')

    for (const result of [one, many]) {
      expect(result.suggestion).toMatch(/desktop computer/i)
      expect(result.suggestion).not.toMatch(/split|batch/i)
    }
  })

  it('quotes the candidate that would cost this job the least, not the first one', () => {
    // canvas holds 6× and vips 4× of the same single image, so vips is the
    // engine whose ceiling the user should hear about.
    const result = tooLarge(jpgToPng, jobInput(900 * MB), desktop, [oneAtATime, engine('vips')])

    expect(result.message).toContain('300 MB')
    expect(result.message).not.toContain('200 MB')
  })

  it('compares engines by what the job costs them, not by ceilings in different units', () => {
    // pdflib's ceiling (292 MB) is on the job total; canvas's (200 MB) is on one
    // file. For four 60 MB files, pdflib peaks at 992 MB and canvas at 360 MB,
    // so canvas is the roomier of the two even though its ceiling is smaller.
    const fourFiles = jobInput(Array.from({ length: 4 }, () => 60 * MB))
    const result = tooLarge(jpgToPng, fourFiles, desktop, [allAtOnce, oneAtATime])

    expect(result.message).toContain('The largest of these 4 files is 60 MB')
    expect(result.message).toContain('200 MB')
  })

  it('never returns a rejection missing either half of its explanation', () => {
    const rejections = [
      emptyInput(jobInput([])),
      emptyInput(jobInput(0)),
      emptyInput(jobInput([MB, 0])),
      unsupportedPair(jpgToPng),
      codecUnavailable(jpgToPng, ['OffscreenCanvas']),
      tooLarge(jpgToPng, jobInput(900 * MB), desktop, [oneAtATime]),
      tooLarge(merge, jobInput([50 * MB, 900 * MB]), ios, [allAtOnce]),
    ]

    for (const rejection of rejections) {
      expect(rejection.ok).toBe(false)
      expect(rejection.message.length).toBeGreaterThan(10)
      expect(rejection.suggestion.length).toBeGreaterThan(10)
      expect(rejection.message).not.toMatch(/something went wrong|undefined|NaN/i)
      expect(rejection.suggestion).not.toMatch(/try again|something went wrong/i)
    }
  })
})
