/**
 * The seam between routing a job and running it.
 *
 * `ConvertRequest` carries two fields the caller cannot invent: the engine
 * `route()` chose, and the memory this device may spend. Both are optional-
 * looking on a plain interface, so a hand-assembled literal can omit either and
 * still compile — and omitting `budgetBytes` is silent, which is what #177 was
 * filed for. The second half of this file therefore drives a real job through a
 * real worker and a real engine, and asserts the same conversion is refused on
 * a phone and accepted on a desktop.
 */

import { describe, expect, it, vi } from 'vitest'

import { IOS_BUDGET_BYTES, budgetBytes } from '@/lib/router/budget'
import type { Capabilities, ConversionTask, RouteSuccess } from '@/lib/router/types'
import { route } from '@/lib/router/route'
import type { EngineInput } from '@/lib/engines/types'
import { createConversionApi } from '@/lib/worker/api'
import { conversionRequest } from '@/lib/worker/request'

import { installFakeWorker } from './fake-worker'
import { PDF_SUITE_TIMEOUT_MS } from '../support/timeouts'
import { pngBytes } from '../engines/synthetic-images'

// One job here embeds a twelve-megapixel image with pdf-lib. See the module the
// number lives in.
vi.setConfig({ testTimeout: PDF_SUITE_TIMEOUT_MS })

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

const phone: Capabilities = {
  ...desktop,
  crossOriginIsolated: false,
  deviceMemoryGb: 2,
  cores: 4,
  platform: 'ios',
  browser: 'safari',
}

const imagesToPdf: ConversionTask = { from: 'png', to: 'pdf', op: 'convert' }

const routed: RouteSuccess = {
  ok: true,
  engine: 'pdflib',
  reason: 'Runs anywhere (pdf-lib)',
  loadCost: 0,
  warnings: [],
}

describe('assembling a request from a routing decision', () => {
  it('carries the engine the router chose', () => {
    const request = conversionRequest(routed, desktop, { task: imagesToPdf, files: [] })

    expect(request.engine).toBe('pdflib')
  })

  it('carries the budget of the device it was routed against', () => {
    const request = conversionRequest(routed, phone, { task: imagesToPdf, files: [] })

    expect(request.budgetBytes).toBe(budgetBytes(phone))
    expect(request.budgetBytes).toBe(IOS_BUDGET_BYTES)
  })

  it('gives two devices two different budgets', () => {
    // The whole point: before #177 nothing set the field, so every job on every
    // device fell back to the desktop floor.
    const onPhone = conversionRequest(routed, phone, { task: imagesToPdf, files: [] })
    const onDesktop = conversionRequest(routed, desktop, { task: imagesToPdf, files: [] })

    expect(onPhone.budgetBytes).toBeLessThan(onDesktop.budgetBytes ?? 0)
  })

  it('leaves the rest of the job alone', () => {
    const files = [new Blob(['x'])]
    const request = conversionRequest(routed, desktop, {
      task: imagesToPdf,
      files,
      pdf: { layout: { pageSize: 'a4' } },
      jobId: 'docify-job-7',
    })

    expect(request.task).toBe(imagesToPdf)
    expect(request.files).toBe(files)
    expect(request.pdf).toEqual({ layout: { pageSize: 'a4' } })
    expect(request.jobId).toBe('docify-job-7')
  })
})

describe('the budget crossing into the worker', () => {
  it('reaches the engine as the number the routed device was given', async () => {
    // The transport half. A recording runner rather than a real engine, because
    // what is being watched is the field surviving `postMessage` — jsdom's
    // structured clone is real here, and a number is the one thing it keeps
    // faithfully.
    let seen: number | undefined
    vi.resetModules()
    installFakeWorker(() =>
      createConversionApi(async () => ({
        run: (input: EngineInput) => {
          seen = input.budgetBytes

          return Promise.resolve(new Blob(['%PDF-1.7']))
        },
      })),
    )

    const { startConversion } = await import('@/lib/worker/jobs')
    await startConversion(
      conversionRequest(routed, phone, { task: imagesToPdf, files: [new Blob(['x'])] }),
    ).result

    expect(seen).toBe(IOS_BUDGET_BYTES)
  })
})

describe('the same job on two devices, through the real request path', () => {
  /**
   * 11.9 megapixels — over what the 90 MB iOS budget can decode at 8 bytes a
   * pixel (11.8 Mpx) and comfortably under the 140 MB desktop floor (18.4 Mpx).
   * Deliberately a real, decodable PNG: the desktop run has to reach pdf-lib and
   * come back with a document, not merely get past the guard.
   */
  const OVERSIZED = pngBytes(3444, 3444)

  /**
   * Route it, assemble the request, run it through the worker's own `convert`
   * and the real engine loader.
   *
   * Called on `createConversionApi()` rather than through `startConversion`,
   * and only because of jsdom: its structured clone strips a `Blob`'s methods,
   * so a file cannot survive the simulated `postMessage` at all. Everything the
   * budget touches is still real — the routing decision, the assembled request,
   * the dynamic engine import and `imagesToPdf`'s own ceiling. The crossing is
   * covered above, and the transport by `./jobs.test.ts`.
   */
  async function convertOn(caps: Capabilities): Promise<Blob> {
    const decision = route(imagesToPdf, [OVERSIZED.byteLength], caps)
    // The router sees bytes, not pixels: 41 kB of flat PNG is nothing to it, on
    // either device. That is exactly why the engine has to hold the second bound.
    expect(decision.ok).toBe(true)

    return createConversionApi().convert(
      conversionRequest(decision as RouteSuccess, caps, {
        task: imagesToPdf,
        files: [new File([OVERSIZED], 'panorama.png', { type: 'image/png' })],
      }),
    )
  }

  it('refuses it on a phone, naming the file and the ceiling', async () => {
    const refusal = convertOn(phone)

    // Three separate claims, because a refusal that names the file but not
    // the ceiling is not the sentence CLAUDE.md §2.5 asks for.
    await expect(refusal).rejects.toThrow('"panorama.png" is 3444 × 3444 pixels')
    await expect(refusal).rejects.toThrow('more than this device can decode at once')
    await expect(refusal).rejects.toThrow('90 MB of decoded image')
  })

  it('accepts the same job on a desktop, and comes back with a document', async () => {
    const out = await convertOn(desktop)

    expect(out.type).toBe('application/pdf')
    expect(out.size).toBeGreaterThan(0)
  })
})
