// @vitest-environment node

/**
 * Rendering PDF pages to images.
 *
 * Three layers, deliberately separated. The arithmetic in `pdf-render-plan.ts`
 * is pure and tested directly. The engine is driven against the fake pdf.js in
 * `./pdfjs-fake`, which is what makes cancellation and resource release
 * observable. And the last block opens fixtures built here with pdf-lib using
 * the *real* pdf.js, which is the only way to know that the resolution the user
 * picks corresponds to the pixels pdf.js actually reports.
 */

import { unzipSync } from 'fflate'
import { PDFDocument, rgb } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'

import { JPEG_QUALITY } from '@/lib/engines/bitmap'
import { MAX_CANVAS_SIDE } from '@/lib/engines/canvas-limits'
import {
  canvasSize,
  DEFAULT_RENDER_DPI,
  encodingFor,
  MAX_RENDER_DPI,
  pageEntryName,
  PDF_USER_SPACE_DPI,
  renderDpi,
  renderScale,
  selectedPages,
} from '@/lib/engines/pdf-render-plan'
import { renderPdfPages } from '@/lib/engines/pdf-render'
import type { PdfRenderOptions } from '@/lib/engines/pdf-options'
import { loadPdfDocument } from '@/lib/engines/pdfjs-runtime'
import type { EngineInput } from '@/lib/engines/types'
import type { ConversionTask, FormatId } from '@/lib/router/types'

import { fakePdfjs, type FakePdfjs } from './pdfjs-fake'

const LETTER = { width: 612, height: 792 }

const task = (to: FormatId): ConversionTask => ({ from: 'pdf', to, op: 'convert' })

const input = (to: FormatId, render?: PdfRenderOptions): EngineInput => ({
  task: task(to),
  files: [new Blob([new Uint8Array([37, 80, 68, 70])])],
  pdf: render === undefined ? undefined : { render },
})

const nothing = () => {}

const run = (fake: FakePdfjs, engineInput: EngineInput, signal = new AbortController().signal) =>
  renderPdfPages(engineInput, signal, nothing, {
    load: fake.load,
    createCanvas: fake.createCanvas,
  })

const namesIn = async (archive: Blob): Promise<string[]> =>
  Object.keys(unzipSync(new Uint8Array(await archive.arrayBuffer())))

describe('the resolution the user picks', () => {
  it('defaults to 150 dpi, which is legible without being a print run', () => {
    expect(renderDpi(undefined)).toBe(DEFAULT_RENDER_DPI)
    expect(renderDpi({})).toBe(DEFAULT_RENDER_DPI)
  })

  it('renders 1:1 at 72 dpi, because that is what a PDF point is', () => {
    expect(renderScale({ dpi: PDF_USER_SPACE_DPI })).toBe(1)
    expect(renderScale({ dpi: 144 })).toBe(2)
  })

  it('refuses a resolution outside what a canvas can carry, before anything downloads', () => {
    expect(() => renderDpi({ dpi: 0 })).toThrow(/between/)
    expect(() => renderDpi({ dpi: -300 })).toThrow(/between/)
    expect(() => renderDpi({ dpi: MAX_RENDER_DPI + 1 })).toThrow(/between/)
    expect(() => renderDpi({ dpi: Number.NaN })).toThrow(/between/)
  })
})

describe('which pages are rendered', () => {
  it('takes every page when no range was given', () => {
    expect(selectedPages(undefined, 3)).toEqual([0, 1, 2])
    expect(selectedPages({ pages: '   ' }, 3)).toEqual([0, 1, 2])
  })

  it('honours a range, deduplicated and in document order', () => {
    expect(selectedPages({ pages: '3, 1-2, 3' }, 4)).toEqual([0, 1, 2])
    expect(selectedPages({ pages: '3-' }, 4)).toEqual([2, 3])
  })

  it('reports a range that names a page the document does not have', () => {
    expect(() => selectedPages({ pages: '9' }, 4)).toThrow(/9.*4 pages/)
  })
})

describe('how a page is encoded', () => {
  it('attaches a JPEG quality, defaulting to the one the raster engines use', () => {
    expect(encodingFor('jpg', undefined)).toEqual({
      type: 'image/jpeg',
      extension: '.jpg',
      quality: JPEG_QUALITY,
    })
    expect(encodingFor('jpg', { quality: 0.4 }).quality).toBe(0.4)
  })

  it('clamps a quality outside 0..1 rather than refusing the job over it', () => {
    expect(encodingFor('jpg', { quality: 92 }).quality).toBe(1)
    expect(encodingFor('jpg', { quality: -1 }).quality).toBe(0)
  })

  it('leaves quality off PNG, which is lossless and would ignore it', () => {
    expect(encodingFor('png', { quality: 0.4 })).toEqual({
      type: 'image/png',
      extension: '.png',
    })
  })

  it('refuses a target no canvas can write', () => {
    expect(() => encodingFor('tiff', undefined)).toThrow(/cannot write/)
  })
})

describe('the canvas a page is given', () => {
  it('rounds, so a 96 dpi Letter page is 816 px rather than 815', () => {
    expect(canvasSize({ width: 816.0000000000001, height: 1056 }, 1, 96)).toEqual({
      width: 816,
      height: 1056,
    })
  })

  it('never asks for a zero-pixel surface', () => {
    expect(canvasSize({ width: 0.2, height: 0.2 }, 1, 12)).toEqual({ width: 1, height: 1 })
  })

  it('refuses a page past the canvas limits, naming the page and the way out', () => {
    expect(() => canvasSize({ width: MAX_CANVAS_SIDE + 1, height: 10 }, 7, 1200)).toThrow(
      /Page 7.*lower resolution/s,
    )
    // Inside the per-axis limit on both axes, past the total area.
    expect(() => canvasSize({ width: 16_000, height: 16_000 }, 2, 1200)).toThrow(/Page 2/)
  })
})

describe('what a page is called in the archive', () => {
  it('is padded to the width of the document, so 2 sorts before 10', () => {
    expect(pageEntryName(2, 12, '.jpg')).toBe('page-02.jpg')
    expect(pageEntryName(10, 12, '.jpg')).toBe('page-10.jpg')
    expect(pageEntryName(3, 3, '.png')).toBe('page-3.png')
  })

  it('numbers by the page in the document, not by its place in the selection', () => {
    expect(pageEntryName(9, 100, '.png')).toBe('page-009.png')
  })
})

describe('rendering a document', () => {
  it('delivers a ZIP with one readable entry per page', async () => {
    const fake = fakePdfjs([LETTER, LETTER, LETTER])

    const out = await run(fake, input('jpg'))

    expect(out.type).toBe('application/zip')
    expect(await namesIn(out)).toEqual(['page-1.jpg', 'page-2.jpg', 'page-3.jpg'])
  })

  it('delivers the image itself when the job comes to one page', async () => {
    // A ZIP holding a single JPG is a step the user has to undo before they can
    // look at what they asked for.
    const fake = fakePdfjs([LETTER])

    const out = await run(fake, input('jpg'))

    expect(out.type).toBe('image/jpeg')
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
  })

  it('renders only the pages the range names', async () => {
    const fake = fakePdfjs([LETTER, LETTER, LETTER, LETTER])

    const out = await run(fake, input('png', { pages: '2, 4' }))

    expect(await namesIn(out)).toEqual(['page-2.png', 'page-4.png'])
    expect(fake.pages.map((page) => page.number)).toEqual([2, 4])
  })

  it('reduces to a bare image when the range happens to name one page', async () => {
    const fake = fakePdfjs([LETTER, LETTER, LETTER])

    const out = await run(fake, input('png', { pages: '2' }))

    expect(out.type).toBe('image/png')
    expect(fake.pages.map((page) => page.number)).toEqual([2])
  })

  it('sizes the canvas from the resolution, which is the whole point of the dpi setting', async () => {
    const fake = fakePdfjs([LETTER])

    await run(fake, input('png', { dpi: 144 }))

    // 612 × 792 pt at twice user space.
    expect(fake.canvases.map((canvas) => canvas.requested)).toEqual([{ width: 1224, height: 1584 }])
  })

  it('sizes each page from its own geometry, not from the first page', async () => {
    const fake = fakePdfjs([LETTER, { width: 200, height: 100 }])

    await run(fake, input('png', { dpi: PDF_USER_SPACE_DPI }))

    expect(fake.canvases.map((canvas) => canvas.requested)).toEqual([
      { width: 612, height: 792 },
      { width: 200, height: 100 },
    ])
  })

  it('asks the canvas for the format and quality the job resolved to', async () => {
    const jpeg = fakePdfjs([LETTER])
    const png = fakePdfjs([LETTER])

    await run(jpeg, input('jpg', { quality: 0.5 }))
    await run(png, input('png', { quality: 0.5 }))

    expect(jpeg.canvases[0].encodings).toEqual([{ type: 'image/jpeg', quality: 0.5 }])
    expect(png.canvases[0].encodings).toEqual([{ type: 'image/png', quality: undefined }])
  })

  it('draws onto the surface it allocated for that page', async () => {
    const fake = fakePdfjs([LETTER, LETTER])

    await run(fake, input('png'))

    expect(fake.renderedOn).toEqual(fake.canvases)
  })

  it('renders one document at a time, and says so', async () => {
    const fake = fakePdfjs([LETTER])
    const two = { ...input('png'), files: [new Blob(['a']), new Blob(['b'])] }

    await expect(run(fake, two)).rejects.toThrow(/one document at a time.*2 files/)
    expect(fake.loads).toEqual([])
  })

  it('validates the resolution before it reads the file or loads pdf.js', async () => {
    const fake = fakePdfjs([LETTER])

    await expect(run(fake, input('png', { dpi: 0 }))).rejects.toThrow(/between/)
    expect(fake.loads).toEqual([])
  })
})

describe('progress', () => {
  it('opens indeterminate while the document is parsed, then counts pages', async () => {
    const fake = fakePdfjs([LETTER, LETTER, LETTER, LETTER])
    const seen: number[] = []

    await renderPdfPages(input('png'), new AbortController().signal, (p) => seen.push(p), {
      load: fake.load,
      createCanvas: fake.createCanvas,
    })

    expect(seen).toEqual([-1, 0, 0.25, 0.5, 0.75, 1])
  })

  it('counts the selection, not the document', async () => {
    const fake = fakePdfjs([LETTER, LETTER, LETTER, LETTER])
    const seen: number[] = []

    await renderPdfPages(
      input('png', { pages: '1-2' }),
      new AbortController().signal,
      (p) => seen.push(p),
      { load: fake.load, createCanvas: fake.createCanvas },
    )

    expect(seen).toEqual([-1, 0, 0.5, 1])
  })
})

describe('cancellation', () => {
  it('refuses a job that was cancelled before it started', async () => {
    const fake = fakePdfjs([LETTER])
    const controller = new AbortController()
    controller.abort()

    await expect(run(fake, input('png'), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fake.loads).toEqual([])
  })

  it('stops between pages and renders no more of them', async () => {
    const fake = fakePdfjs([LETTER, LETTER, LETTER])
    const controller = new AbortController()
    fake.duringRender = (page) => {
      if (page.number === 1) controller.abort()
    }

    await expect(run(fake, input('png'), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fake.pages.map((page) => page.number)).toEqual([1])
  })

  it('tears down the render already in flight rather than waiting it out', async () => {
    // A single 300 dpi page is seconds of work. Waiting for it to finish before
    // honouring the click is indistinguishable from ignoring the click.
    const fake = fakePdfjs([LETTER])
    const controller = new AbortController()
    fake.duringRender = () => controller.abort()

    await expect(run(fake, input('png'), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fake.pages[0].cancels).toBe(1)
  })

  it('stops listening on the signal once a page is done', async () => {
    const fake = fakePdfjs([LETTER, LETTER])
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')

    await run(fake, input('png'), controller.signal)

    // Every page adds a listener; none of them may outlive its render, or a
    // long document ends up holding one closure per page it has finished.
    expect(remove).toHaveBeenCalledTimes(2)
  })
})

describe('what a render leaves behind', () => {
  it('releases every canvas it allocated', async () => {
    const fake = fakePdfjs([LETTER, LETTER, LETTER])

    await run(fake, input('png'))

    expect(fake.canvases).toHaveLength(3)
    expect(fake.canvases.every((canvas) => canvas.released)).toBe(true)
  })

  it('cleans up every page and destroys the document', async () => {
    const fake = fakePdfjs([LETTER, LETTER])

    await run(fake, input('png'))

    expect(fake.pages.map((page) => page.cleanups)).toEqual([1, 1])
    expect(fake.destroys).toBe(1)
  })

  it('releases just as thoroughly when a page fails mid-render', async () => {
    const fake = fakePdfjs([LETTER, LETTER])
    fake.duringRender = () => {
      throw new Error('corrupt content stream')
    }

    await expect(run(fake, input('png'))).rejects.toThrow('corrupt content stream')

    expect(fake.canvases.every((canvas) => canvas.released)).toBe(true)
    expect(fake.pages.map((page) => page.cleanups)).toEqual([1])
    expect(fake.destroys).toBe(1)
  })

  it('holds one canvas at a time, so page count does not drive memory', async () => {
    const fake = fakePdfjs(Array.from({ length: 40 }, () => LETTER))

    await run(fake, input('png'))

    const live = fake.canvases.filter((canvas) => !canvas.released)
    expect(fake.canvases).toHaveLength(40)
    expect(live).toEqual([])
  })
})

/**
 * The real library, on real documents, stopping short of the canvas.
 *
 * Everything above this point would still pass if `getViewport` meant something
 * other than what this engine assumes. These fixtures are parsed by pdf.js
 * itself, which is what makes "144 dpi gives 1224 px" a fact rather than a
 * restatement of the fake.
 */
describe('pdf.js itself, on a document built here', () => {
  const fixture = async (sizes: readonly [number, number][]): Promise<Uint8Array> => {
    const document = await PDFDocument.create()

    for (const [width, height] of sizes) {
      const page = document.addPage([width, height])
      page.drawRectangle({ x: 20, y: 20, width: 80, height: 40, color: rgb(0, 0, 0) })
    }

    return document.save()
  }

  /**
   * These fixtures are rectangles: no text, no fonts, no character maps, and so
   * nothing for pdf.js to fetch. Saying that explicitly is what lets them run
   * outside a browser — `loadPdfDocument` otherwise resolves the vendored asset
   * directories against an origin the node environment does not have. Which
   * face pdf.js draws with is `./pdfjs-assets.test.ts`' subject, not this one's.
   */
  const open = (data: Uint8Array) => loadPdfDocument(data, {})

  it('opens a document without spawning a worker of its own', async () => {
    const loading = await open(
      await fixture([
        [612, 792],
        [595, 842],
        [200, 100],
      ]),
    )

    try {
      expect((await loading.promise).numPages).toBe(3)
    } finally {
      await loading.destroy()
    }
  })

  it('reports the pixel size the dpi setting is built on', async () => {
    const loading = await open(await fixture([[612, 792]]))

    try {
      const page = await (await loading.promise).getPage(1)
      const viewport = page.getViewport({ scale: renderScale({ dpi: 150 }) })

      expect(canvasSize(viewport, 1, 150)).toEqual({ width: 1275, height: 1650 })
      page.cleanup()
    } finally {
      await loading.destroy()
    }
  })

  it('keeps the geometry of each page rather than of the first', async () => {
    const loading = await open(
      await fixture([
        [612, 792],
        [200, 100],
      ]),
    )

    try {
      const document = await loading.promise
      const scale = renderScale({ dpi: PDF_USER_SPACE_DPI })
      const sizes = []

      for (const number of [1, 2]) {
        const page = await document.getPage(number)
        sizes.push(canvasSize(page.getViewport({ scale }), number, PDF_USER_SPACE_DPI))
        page.cleanup()
      }

      expect(sizes).toEqual([
        { width: 612, height: 792 },
        { width: 200, height: 100 },
      ])
    } finally {
      await loading.destroy()
    }
  })
})
