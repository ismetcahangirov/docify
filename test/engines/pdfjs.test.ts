// @vitest-environment node

import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createRunner, descriptor, PDFJS_LOAD_COST } from '@/lib/engines/pdfjs'
import type { Capabilities, ConversionTask } from '@/lib/router/types'

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

const pdfToJpg: ConversionTask = { from: 'pdf', to: 'jpg', op: 'convert' }

describe('the pdfjs descriptor', () => {
  it('claims rendering a PDF to a raster image', () => {
    expect(descriptor.supports(pdfToJpg, desktop)).toBe(true)
    expect(descriptor.supports({ from: 'pdf', to: 'png', op: 'convert' }, desktop)).toBe(true)
  })

  it('refuses to rasterise without OffscreenCanvas, which is where it draws', () => {
    // The runner lives on the worker thread and has no `document`. Without
    // OffscreenCanvas there is no surface to render onto, and being chosen
    // would surface as a crash rather than as a routed rejection.
    expect(descriptor.supports(pdfToJpg, { ...desktop, offscreenCanvas: false })).toBe(false)
  })

  it('refuses the structural edits that belong to pdf-lib', () => {
    expect(descriptor.supports({ from: 'pdf', to: 'pdf', op: 'merge' }, desktop)).toBe(false)
    expect(descriptor.supports({ from: 'pdf', to: 'pdf', op: 'split' }, desktop)).toBe(false)
  })

  it('refuses to write a PDF, which it cannot do at all', () => {
    expect(descriptor.supports({ from: 'jpg', to: 'pdf', op: 'convert' }, desktop)).toBe(false)
  })

  it('carries routing numbers the registry can order it by', () => {
    expect(descriptor.id).toBe('pdfjs')
    expect(descriptor.label.length).toBeGreaterThan(0)
    expect(descriptor.loadCost).toBe(PDFJS_LOAD_COST)
    expect(descriptor.priority).toBe(30)
  })

  it('costs more to download than pdf-lib, so a tie would fall the other way', () => {
    expect(descriptor.loadCost).toBeGreaterThan(500_000)
  })
})

describe('the load cost the router prices pdf.js with', () => {
  const buildDir = dirname(
    createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs'),
  )
  const bytesOf = (file: string): number => statSync(join(buildDir, file)).size

  it('is the measured size of both halves of the legacy build', () => {
    // Measured rather than remembered: an upgrade that changes the download
    // fails here instead of quietly making the router's cost model wrong. Both
    // halves, because the API entry alone cannot open a document and Docify
    // loads the worker module itself — see `lib/engines/pdfjs-runtime.ts`.
    expect(PDFJS_LOAD_COST).toBe(bytesOf('pdf.min.mjs') + bytesOf('pdf.worker.min.mjs'))
  })

  it('stays under the 8 MB LARGE_DOWNLOAD threshold', () => {
    expect(PDFJS_LOAD_COST).toBeLessThan(8 * 1024 * 1024)
  })
})

describe('the pdfjs runner', () => {
  const nothing = () => {}

  it('refuses a task it never claims, rather than downloading pdf.js to find out', async () => {
    // Only reachable when `supports()` and the runner disagree, which is a
    // routing bug — but one that must not cost the user 1.8 MB to discover.
    await expect(
      createRunner().run(
        { task: { from: 'pdf', to: 'pdf', op: 'merge' }, files: [new Blob(['%PDF-1.7'])] },
        new AbortController().signal,
        nothing,
      ),
    ).rejects.toThrow(/JPG, PNG or text/)
  })

  it('honours a signal that is already aborted before doing any work', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      createRunner().run(
        { task: pdfToJpg, files: [new Blob(['%PDF-1.7'])] },
        controller.signal,
        nothing,
      ),
    ).rejects.toThrow(/cancel/i)
  })
})
