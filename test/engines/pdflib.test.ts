// @vitest-environment node
//
// The descriptor is a pure function of its two arguments and runs during SSR as
// readily as in a worker, so it is tested without a DOM. Anything the engine
// needs from the browser must arrive through `Capabilities`.

import { describe, expect, it } from 'vitest'

import { createRunner, descriptor, PDFLIB_LOAD_COST } from '@/lib/engines/pdflib'
import type { Capabilities, ConversionTask, Operation } from '@/lib/router/types'

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

/**
 * The weakest device we support, and the point of the test: pdf-lib is plain
 * JavaScript with no WASM, no SIMD requirement and no `SharedArrayBuffer`, so
 * an old iPhone in a non-isolated document must still route here.
 */
const oldPhone: Capabilities = {
  ...desktop,
  crossOriginIsolated: false,
  wasmSimd: false,
  deviceMemoryGb: 1,
  cores: 2,
  offscreenCanvas: false,
  createImageBitmap: false,
  platform: 'ios',
  browser: 'safari',
}

const pdfToPdf = (op: Operation): ConversionTask => ({ from: 'pdf', to: 'pdf', op })

describe('the pdflib descriptor', () => {
  it('claims the structural PDF operations', () => {
    for (const op of ['merge', 'split', 'organize', 'rotate'] as const) {
      expect(descriptor.supports(pdfToPdf(op), desktop)).toBe(true)
    }
  })

  it('claims images to PDF, which is a convert rather than a PDF-to-PDF edit', () => {
    expect(descriptor.supports({ from: 'jpg', to: 'pdf', op: 'convert' }, desktop)).toBe(true)
    expect(descriptor.supports({ from: 'png', to: 'pdf', op: 'convert' }, desktop)).toBe(true)
  })

  it('refuses to render a PDF, which needs a rasteriser it does not have', () => {
    expect(descriptor.supports({ from: 'pdf', to: 'jpg', op: 'convert' }, desktop)).toBe(false)
    expect(descriptor.supports({ from: 'pdf', to: 'png', op: 'convert' }, desktop)).toBe(false)
  })

  it('refuses work that has nothing to do with PDF', () => {
    expect(descriptor.supports({ from: 'jpg', to: 'png', op: 'convert' }, desktop)).toBe(false)
    expect(descriptor.supports({ from: 'mp4', to: 'mp3', op: 'extract' }, desktop)).toBe(false)
  })

  it('refuses an image format it cannot embed', () => {
    // pdf-lib embeds JPEG and PNG and nothing else. Routing a TIFF here would
    // fail several seconds in, with the file already read.
    expect(descriptor.supports({ from: 'tiff', to: 'pdf', op: 'convert' }, desktop)).toBe(false)
    expect(descriptor.supports({ from: 'heic', to: 'pdf', op: 'convert' }, desktop)).toBe(false)
  })

  it('runs on a device with no SIMD, no isolation and no OffscreenCanvas', () => {
    expect(descriptor.supports(pdfToPdf('merge'), oldPhone)).toBe(true)
    expect(descriptor.supports({ from: 'jpg', to: 'pdf', op: 'convert' }, oldPhone)).toBe(true)
  })

  it('carries routing numbers the registry can order it by', () => {
    expect(descriptor.id).toBe('pdflib')
    expect(descriptor.label.length).toBeGreaterThan(0)
    expect(descriptor.loadCost).toBe(PDFLIB_LOAD_COST)
    expect(descriptor.priority).toBe(20)
  })
})

describe('the pdflib runner', () => {
  const input = (task: ConversionTask) => ({ task, files: [new Blob(['%PDF-1.7'])] })
  const nothing = () => {}

  it('names the operation and its issue when it has not been implemented yet', async () => {
    // A scaffold that answered with an empty PDF would look like a successful
    // conversion. Until an operation lands, the only honest result is a throw
    // that says which one is missing. Whichever operation this names is simply
    // one that has not landed yet, so the issue that implements it moves this
    // assertion to another arm rather than deleting it.
    await expect(
      createRunner().run(input(pdfToPdf('organize')), new AbortController().signal, nothing),
    ).rejects.toThrow(/organize/)
  })

  it('dispatches split to the module that implements it', async () => {
    // The eight-byte stub above is not a readable document, so a throw is the
    // only possible outcome — what matters is that it comes from the splitter
    // rather than from the placeholder this arm used to hold.
    await expect(
      createRunner().run(input(pdfToPdf('split')), new AbortController().signal, nothing),
    ).rejects.toThrow(/could not be read as a PDF/i)
  })

  it('refuses an operation this engine never claimed', async () => {
    await expect(
      createRunner().run(
        input({ from: 'mp4', to: 'mp3', op: 'extract' }),
        new AbortController().signal,
        nothing,
      ),
    ).rejects.toThrow(/extract/)
  })

  it('honours a signal that is already aborted before doing any work', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      createRunner().run(input(pdfToPdf('merge')), controller.signal, nothing),
    ).rejects.toThrow(/cancel/i)
  })
})
