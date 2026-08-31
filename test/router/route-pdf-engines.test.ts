// @vitest-environment node
//
// Deliberately not jsdom. `route()` runs during SSR, inside a Web Worker and in
// the browser, and it is only allowed to look at the three arguments it is
// handed, so a `window` or `document` read inside it must throw here rather
// than pass quietly. `route-purity.test.ts` closes the remaining gap.
//
// The real pdf-lib and pdf.js descriptors against the measured memory model —
// the counterpart CLAUDE.md §5.4 requires for the suites that run on fakes.

import { describe, expect, it, vi } from 'vitest'

import { descriptor as realPdfjs } from '@/lib/engines/pdfjs'
import { descriptor as realPdflib } from '@/lib/engines/pdflib'
import { route } from '@/lib/router/route'
import type { ConversionTask } from '@/lib/router/types'

import {
  chosen,
  desktop,
  ios,
  MB,
  pdfMerge,
  refused,
  register,
  resetRegistryBetweenTests,
} from './support/route-harness'

// `vi.mock` is hoisted to the top of the file, so the call cannot be shared —
// only the replacement module it returns, which the harness builds.
vi.mock('@/lib/engines/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engines/registry')>()

  return (await import('./support/route-harness')).mockedRegistry(actual)
})

resetRegistryBetweenTests()

describe('route — the PDF engines against the measured model', () => {
  const pdfToJpg: ConversionTask = { from: 'pdf', to: 'jpg', op: 'convert' }

  it('merges twenty ordinary documents and refuses twenty large scans', () => {
    register(realPdflib)

    const reports = Array.from({ length: 20 }, () => 4 * MB)
    const scans = Array.from({ length: 20 }, () => 40 * MB)

    expect(chosen(route(pdfMerge, reports, desktop)).engine).toBe('pdflib')
    expect(refused(route(pdfMerge, scans, desktop)).code).toBe('FILE_TOO_LARGE')
  })

  it('leaves a phone enough of its budget to merge two ordinary PDFs', () => {
    register(realPdflib)

    // (90 MB − 32 MB) / 4 = 14.5 MB across the whole job on an iPhone.
    expect(chosen(route(pdfMerge, [6 * MB, 6 * MB], ios)).engine).toBe('pdflib')
    expect(refused(route(pdfMerge, [6 * MB, 12 * MB], ios)).code).toBe('DEVICE_TOO_WEAK')
  })

  it('routes PDF to text to pdf.js, on a browser that could not render a page', () => {
    register(realPdfjs)

    // Reading text draws nothing, so the `OffscreenCanvas` gate that governs the
    // raster targets does not apply to it — and a browser without one can still
    // pull the words out of a document.
    const bare = { ...desktop, offscreenCanvas: false }

    expect(chosen(route({ from: 'pdf', to: 'txt', op: 'convert' }, MB, bare)).engine).toBe('pdfjs')
    expect(refused(route(pdfToJpg, MB, bare)).code).toBe('UNSUPPORTED_PAIR')
  })

  it('reserves the render canvas before it spends the budget on the document', () => {
    register(realPdfjs)

    // The 32 MB reserve is the page canvas and the parse baseline, neither of
    // which the PDF's own size predicts, so it comes off the top: 292 MB of
    // document on a desktop rather than the 300 MB a bare 4× factor would give.
    expect(chosen(route(pdfToJpg, 292 * MB, desktop)).engine).toBe('pdfjs')

    const result = refused(route(pdfToJpg, 300 * MB, desktop))

    expect(result.code).toBe('FILE_TOO_LARGE')
    expect(result.message).toContain('292 MB')
  })
})
