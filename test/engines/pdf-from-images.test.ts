// @vitest-environment node
//
// pdf-lib is plain JavaScript and this operation touches no browser API beyond
// `Blob`, so the tests run without a DOM — and every assertion below is made
// against a document parsed back out of the bytes the engine produced, rather
// than against a spy on the calls it made.

import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'

import { imagesToPdf, POINTS_PER_PIXEL } from '@/lib/engines/pdf-from-images'
import type { PdfLayoutOptions } from '@/lib/engines/pdf-options'
import { createRunner } from '@/lib/engines/pdflib'
import type { EngineInput } from '@/lib/engines/types'
import type { ConversionTask } from '@/lib/router/types'

import { jpegBytes, pngBytes } from './synthetic-images'

import { PDF_SUITE_TIMEOUT_MS } from '../support/timeouts'

// Real documents, real parsing: see the module this number lives in.
vi.setConfig({ testTimeout: PDF_SUITE_TIMEOUT_MS })

const A4 = { width: 595.28, height: 841.89 }
const task: ConversionTask = { from: 'png', to: 'pdf', op: 'convert' }
const nothing = () => {}

const png = (width: number, height: number, name = 'photo.png') =>
  new File([pngBytes(width, height)], name)

const jpeg = (width: number, height: number, name = 'photo.jpg') =>
  new File([jpegBytes(width, height)], name)

function input(
  files: readonly Blob[],
  layout?: PdfLayoutOptions,
  budgetBytes?: number,
): EngineInput {
  return { task, files, pdf: layout === undefined ? undefined : { layout }, budgetBytes }
}

const build = (files: readonly Blob[], layout?: PdfLayoutOptions, budgetBytes?: number) =>
  imagesToPdf(input(files, layout, budgetBytes), new AbortController().signal, nothing)

describe('the pixels-to-points assumption', () => {
  it('maps one image pixel to one PDF point, which is 72 dpi', () => {
    // PDF user space is defined as 1/72 inch, so this is the identity mapping:
    // no resampling on the way in, and a 72 dpi render on the way back out
    // returns the original pixel grid. Changing this number changes the
    // physical size of every document the engine has ever produced.
    expect(POINTS_PER_PIXEL).toBe(1)
  })
})

describe('images to PDF', () => {
  it('makes one page per image, in the order the user gave them', async () => {
    const pages = await placements(await build([png(120, 80), png(200, 50), jpeg(60, 300)]))

    expect(pages.map((page) => page.page)).toEqual([
      { width: 120, height: 80 },
      { width: 200, height: 50 },
      { width: 60, height: 300 },
    ])
  })

  it('gives a fitted page the image own dimensions, with nothing around it', async () => {
    const [page] = await placements(await build([png(120, 80)]))

    expect(page.page).toEqual({ width: 120, height: 80 })
    expect(page.image).toEqual({ x: 0, y: 0, width: 120, height: 80 })
  })

  it('defaults to fitting, so an album keeps every photo at its own size', async () => {
    const [page] = await placements(await build([png(120, 80)], { margin: 0 }))

    expect(page.page).toEqual({ width: 120, height: 80 })
  })

  it('scales an oversized image onto a named page without distorting it', async () => {
    const [page] = await placements(await build([png(1200, 800)], { pageSize: 'a4' }))

    expect(page.page.width).toBeCloseTo(A4.width, 1)
    expect(page.page.height).toBeCloseTo(A4.height, 1)
    // 1200 × 800 is 3:2, and it stays 3:2 — the scale is one number, not two.
    expect(page.image.width / page.image.height).toBeCloseTo(1200 / 800, 5)
    // Constrained by the width, so it touches both side edges and is centred
    // vertically in what is left.
    expect(page.image.width).toBeCloseTo(A4.width, 1)
    expect(page.image.x).toBeCloseTo(0, 5)
    expect(page.image.y).toBeCloseTo((A4.height - page.image.height) / 2, 5)
  })

  it('swaps the page in landscape and leaves the image undistorted', async () => {
    const [page] = await placements(
      await build([png(800, 1200)], { pageSize: 'a4', orientation: 'landscape' }),
    )

    expect(page.page.width).toBeCloseTo(A4.height, 1)
    expect(page.page.height).toBeCloseTo(A4.width, 1)
    expect(page.image.width / page.image.height).toBeCloseTo(800 / 1200, 5)
    expect(page.image.height).toBeCloseTo(A4.width, 1)
  })

  it('offers every named size the options type promises', async () => {
    const sizes = ['a3', 'a4', 'a5', 'letter', 'legal'] as const
    const widths: number[] = []

    for (const pageSize of sizes) {
      const [page] = await placements(await build([png(20, 20)], { pageSize }))
      widths.push(Math.round(page.page.width))
    }

    expect(widths).toEqual([842, 595, 420, 612, 612])
  })

  it('never enlarges a small image, so no page is filled with invented detail', async () => {
    // Upscaling a 60 px thumbnail to A4 would be a 10× blur presented as a
    // document. Centring it at its natural size is the honest answer.
    const [page] = await placements(await build([png(60, 40)], { pageSize: 'a4' }))

    expect(page.image.width).toBeCloseTo(60, 5)
    expect(page.image.height).toBeCloseTo(40, 5)
    expect(page.image.x).toBeCloseTo((A4.width - 60) / 2, 1)
    expect(page.image.y).toBeCloseTo((A4.height - 40) / 2, 1)
  })

  it('insets the image by the margin on a named page', async () => {
    const [page] = await placements(await build([png(1200, 800)], { pageSize: 'a4', margin: 50 }))

    expect(page.image.x).toBeCloseTo(50, 5)
    expect(page.image.width).toBeCloseTo(A4.width - 100, 1)
    expect(page.image.width / page.image.height).toBeCloseTo(1200 / 800, 5)
  })

  it('grows a fitted page to make room for the margin rather than cropping', async () => {
    const [page] = await placements(await build([png(120, 80)], { margin: 20 }))

    expect(page.page).toEqual({ width: 160, height: 120 })
    expect(page.image).toEqual({ x: 20, y: 20, width: 120, height: 80 })
  })

  it('refuses a margin that leaves no page left, and says what would fit', async () => {
    await expect(build([png(120, 80)], { pageSize: 'a5', margin: 400 })).rejects.toThrow(
      /400 pt margin[\s\S]*below 209 pt/,
    )
  })

  it('refuses a margin that is not a distance', async () => {
    await expect(build([png(120, 80)], { margin: -10 })).rejects.toThrow(/-10 pt is not a distance/)
  })

  it('reads the bytes rather than the declared format', async () => {
    // `supports()` gates on `task.from`, which comes from the file extension, so
    // a JPEG named ".png" reaches this engine claiming to be a PNG. Believing
    // the label would hand it to the PNG decoder and fail on a valid image.
    const [page] = await placements(await build([jpeg(200, 100, 'mislabelled.png')]))

    expect(page.page).toEqual({ width: 200, height: 100 })
  })

  it('names the file it cannot embed and says what to do with it', async () => {
    const notAnImage = new File([new Uint8Array(64).fill(0x49)], 'scan.tiff')

    await expect(build([png(10, 10), notAnImage])).rejects.toThrow(
      /"scan\.tiff" is not a JPEG or a PNG[\s\S]*convert it to PNG/,
    )
  })

  it('falls back to the position when the file has no name to quote', async () => {
    const notAnImage = new Blob([new Uint8Array(64).fill(0x49)])

    await expect(build([png(10, 10), notAnImage])).rejects.toThrow(/Image 2 is not a JPEG/)
  })

  it('needs at least one image', async () => {
    await expect(build([])).rejects.toThrow(/at least one image/)
  })
})

describe('the decoded-pixel ceiling', () => {
  /**
   * A PNG whose IHDR claims `width × height` while its IDAT holds ten by ten.
   *
   * The mismatch is the assertion: pdf-lib would decode this and either fail or
   * allocate the full bitmap, so an error that quotes the *claimed* dimensions
   * can only have come from a guard that read the header and stopped there —
   * which is what "before any bitmap is allocated" means.
   */
  function oversizedPng(width: number, height: number, name: string): File {
    const bytes = pngBytes(10, 10)
    const fields = new DataView(bytes.buffer)

    fields.setUint32(16, width)
    fields.setUint32(20, height)

    return new File([bytes], name)
  }

  /**
   * A budget under which one `flat` image below fits and four do not.
   *
   * 400 × 400 is 160 000 pixels, so at 8 bytes each a 4 MB budget admits
   * 500 000 — three of them, not four.
   */
  const TIGHT_BUDGET_BYTES = 4_000_000
  const flat = (index: number) => new File([pngBytes(400, 400)], `shot-${index}.png`)

  it('refuses one image whose pixels cannot fit, before it is decoded', async () => {
    await expect(build([oversizedPng(20_000, 20_000, 'poster.png')])).rejects.toThrow(
      /"poster\.png" is 20000 × 20000 pixels[\s\S]*400\.0 megapixels[\s\S]*resize tool/,
    )
  })

  it('counts the images already embedded, not just the one in hand', async () => {
    // The case the router structurally cannot see, and the one the issue was
    // filed for. Every one of these four is real, decodable and comfortably
    // inside the ceiling on its own; together they are not. A guard that charged
    // the largest image rather than the running total would pass all four.
    await expect(
      build([flat(1), flat(2), flat(3), flat(4)], undefined, TIGHT_BUDGET_BYTES),
    ).rejects.toThrow(
      /"shot-4\.png" is 400 × 400 pixels and brings this job to 0\.6 megapixels[\s\S]*fewer images/,
    )
  })

  it('admits the images that fit before the one that does not', async () => {
    const pages = await placements(
      await build([flat(1), flat(2), flat(3)], undefined, TIGHT_BUDGET_BYTES),
    )

    expect(pages).toHaveLength(3)
  })

  it('takes the budget from the job rather than assuming a device', async () => {
    // The same four images the tight budget refuses. `budgetBytes` is what the
    // main thread already computed with `budgetBytes(caps)` when it routed.
    const out = await build([flat(1), flat(2), flat(3), flat(4)], undefined, 400_000_000)

    expect(out.type).toBe('application/pdf')
  })

  it('charges a JPEG nothing, because pdf-lib never decodes one', async () => {
    // `embedJpg` reads SOF0 and copies the bytes into a `DCTDecode` stream, so a
    // 400 megapixel JPEG costs its bytes and not its pixels. Charging it pixels
    // would refuse a camera panorama that converts in a few megabytes.
    const [page] = await placements(await build([jpeg(20_000, 20_000)]))

    expect(page.page).toEqual({ width: 20_000, height: 20_000 })
  })

  it('lets an ordinary page-sized image through untouched', async () => {
    const [page] = await placements(await build([png(1240, 1754)]))

    expect(page.page).toEqual({ width: 1240, height: 1754 })
  })
})

describe('the produced file', () => {
  it('labels the output as a PDF', async () => {
    const out = await build([png(10, 10)])

    expect(out.type).toBe('application/pdf')
    expect(out.size).toBeGreaterThan(0)
  })

  it('reports progress across the images and finishes at 1', async () => {
    const seen: number[] = []

    await imagesToPdf(
      input([png(10, 10), png(10, 10), png(10, 10)]),
      new AbortController().signal,
      (progress) => seen.push(progress),
    )

    expect(seen).toEqual([0, 1 / 3, 2 / 3, 1])
  })

  it('refuses a job that was cancelled before it started', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      imagesToPdf(input([png(10, 10)]), controller.signal, nothing),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stops between images when the signal fires mid-run', async () => {
    const controller = new AbortController()
    const seen: number[] = []

    await expect(
      imagesToPdf(input([png(10, 10), png(10, 10), png(10, 10)]), controller.signal, (progress) => {
        seen.push(progress)
        if (progress > 0) controller.abort()
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    // Stopped at the second image, and never claimed to have finished.
    expect(seen).toEqual([0, 1 / 3])
  })
})

describe('the pdflib engine wiring', () => {
  it('reaches this operation for a convert task, and only through a dynamic import', async () => {
    // The assertion that matters is that the runner resolves at all: the engine
    // dispatches on `task.op` through `await import()`, so a wrong specifier or
    // a renamed export fails here rather than in production, and the import
    // stays out of the initial bundle (CLAUDE.md §2.3).
    const out = await createRunner().run(
      input([png(10, 10)]),
      new AbortController().signal,
      nothing,
    )

    expect(out.type).toBe('application/pdf')
  })
})

/** Where the image ended up on each page, in PDF points. */
interface Placement {
  page: { width: number; height: number }
  image: { x: number; y: number; width: number; height: number }
}

type Matrix = readonly [number, number, number, number, number, number]

const CONCAT_MATRIX = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g

/**
 * Parses the produced PDF and reports, per page, the page box and the rectangle
 * the image occupies.
 *
 * pdf-lib draws an image by concatenating a translate and a scale onto the
 * current transformation matrix and painting the unit square, so composing every
 * `cm` in the page's content stream gives back exactly the rectangle that was
 * asked for. Reading it out of the serialised document rather than spying on
 * `drawImage` is the difference between testing the file and testing the code.
 */
async function placements(blob: Blob): Promise<Placement[]> {
  const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()))

  return doc.getPages().map((page) => {
    // A page's /Contents is a single stream or an array of them, and pdf-lib
    // splits ours in two — one for the page setup it writes itself, one for the
    // drawing. Concatenating is what the PDF spec says a reader must do.
    const contents = page.node.Contents()
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents]
    const content = refs
      .map((ref) => {
        const stream = doc.context.lookup(ref)
        if (!(stream instanceof PDFRawStream)) throw new Error('expected a content stream')
        return new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode())
      })
      .join('\n')
    const [width, , , height, x, y] = compose(content)

    return { page: page.getSize(), image: { x, y, width, height } }
  })
}

function compose(content: string): Matrix {
  let composed: Matrix = [1, 0, 0, 1, 0, 0]

  for (const match of content.matchAll(CONCAT_MATRIX)) {
    const [a, b, c, d, e, f] = match.slice(1).map(Number)
    composed = [
      a * composed[0] + b * composed[2],
      a * composed[1] + b * composed[3],
      c * composed[0] + d * composed[2],
      c * composed[1] + d * composed[3],
      e * composed[0] + f * composed[2] + composed[4],
      e * composed[1] + f * composed[3] + composed[5],
    ]
  }

  return composed
}
