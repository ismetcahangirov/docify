import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Converter } from '@/components/converter/converter'
import { pairBySlug } from '@/lib/registry/pairs'

import { pngHeaderBytes } from '../../engines/synthetic-images'

/*
 * What is offered after a refusal, measured against the file that was refused
 * (issue #272).
 *
 * `lib/router/alternatives.ts` exists to make sure a suggestion is one the
 * browser has already agreed to, and it can only do that if it is handed the
 * same numbers the job was routed with. The converter passed the byte count
 * alone, so a picture whose *pixels* were the problem got suggestions that
 * would be refused on the next drop — the exact dead end the module was built
 * to prevent.
 *
 * The device here has no WASM SIMD, which is what makes the difference
 * visible: without it wasm-vips is out of the running, canvas is the only
 * raster engine left, and canvas is bound by decoded pixels rather than by
 * file size. On a machine with SIMD every alternative goes to vips and the
 * pixel count never decides anything.
 */

const pair = pairBySlug('png-to-jpg')!

vi.mock('@/lib/worker/jobs', () => ({
  startConversion: vi.fn(() => ({ jobId: 'worker-1', result: new Promise<Blob>(() => {}) })),
  cancelConversion: vi.fn(async () => true),
}))

vi.mock('@/lib/router/capabilities', () => ({
  probeCapabilities: () => ({
    crossOriginIsolated: true,
    wasmSimd: false,
    deviceMemoryGb: 8,
    cores: 8,
    webCodecsVideo: true,
    webCodecsAudio: true,
    offscreenCanvas: true,
    createImageBitmap: true,
    platform: 'desktop',
    browser: 'chromium',
  }),
}))

afterEach(() => {
  vi.clearAllMocks()
})

/** Half a megabyte of PNG whose header declares `width × height`. */
function poster(width: number, height: number): File {
  return new File([pngHeaderBytes(width, height), new Uint8Array(512 * 1024)], 'poster.png', {
    type: 'image/png',
  })
}

const drop = (file: File) => {
  fireEvent.change(screen.getByLabelText(/drop your png files here/i), {
    target: { files: [file] },
  })
}

/** The conversions the refusal panel is offering, by their link text. */
async function offered(): Promise<string[]> {
  const panel = await screen.findByRole('alert')

  return within(panel)
    .queryAllByRole('link')
    .map((link) => link.textContent ?? '')
}

describe('the alternatives under a refusal are measured against the refused file', () => {
  it('offers only what this browser would accept for a hundred-megapixel picture', async () => {
    render(<Converter pair={pair} />)

    // Ten thousand square: half a megabyte compressed, four hundred megabytes
    // decoded, and past every canvas ceiling there is.
    drop(poster(10_000, 10_000))

    // The alternatives arrive in an effect after the refusal is on screen —
    // `probeCapabilities()` reads `navigator` and cannot run during render —
    // so the list has to be waited for rather than read once.
    await screen.findByRole('link', { name: 'PNG to PDF' })

    // PDF survives because pdf-lib embeds the compressed bytes without ever
    // decoding them. WebP and BMP do not, and offering either would be a
    // second refusal found out with a second drop.
    expect(await offered()).toEqual(['PNG to PDF'])
  })

  it('says why, before it says what else', async () => {
    render(<Converter pair={pair} />)
    drop(poster(10_000, 10_000))

    const panel = await screen.findByRole('alert')

    expect(panel).toHaveAttribute('data-code', 'FILE_TOO_LARGE')
    expect(panel.querySelector('[data-slot="rejection-suggestion"]')?.textContent).toMatch(/\S/)
  })
})
