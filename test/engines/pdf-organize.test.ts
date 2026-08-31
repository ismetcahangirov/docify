// @vitest-environment node
//
// pdf-lib is plain JavaScript with no DOM dependency, and the operation is
// driven directly rather than through the engine, so there is nothing here a
// browser is needed for.
//
// Every fixture is built with pdf-lib in the test rather than committed as a
// binary. A checked-in PDF would be opaque in review — nobody can see that page
// three carries a 90° rotation by looking at the diff — and four EPIC 5 branches
// adding fixtures at once would collide over the same directory.

import { degrees, PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { organizePages } from '@/lib/engines/pdf-organize'
import type { PdfOrganizeOptions } from '@/lib/engines/pdf-options'
import type { EngineInput } from '@/lib/engines/types'
import type { Operation } from '@/lib/router/types'

import { lockedPdfBlob, rewordEncryptedRefusal } from '../support/pdf-lib'

interface PageSpec {
  /** Doubles as the page's identity: source page `n` is 100 + n points tall. */
  height: number
  rotation?: number
}

/** Source page `n` is `100 + n` points tall, so page order survives read-back. */
const ladder = (count: number): PageSpec[] =>
  Array.from({ length: count }, (_, index) => ({ height: 101 + index }))

/** Re-wraps so the view is one over a plain `ArrayBuffer`, which is all `Blob` takes. */
const asBlob = (bytes: Uint8Array): Blob =>
  new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })

async function makePdf(pages: readonly PageSpec[], title?: string): Promise<Blob> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  if (title !== undefined) doc.setTitle(title)

  for (const spec of pages) {
    const page = doc.addPage([200, spec.height])
    if (spec.rotation !== undefined) page.setRotation(degrees(spec.rotation))
  }

  return asBlob(await doc.save())
}

/** A document whose pages carry enough content that dropping one is measurable. */
async function makeFatPdf(pageCount: number): Promise<Blob> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  const font = await doc.embedFont(StandardFonts.Helvetica)

  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([600, 800]).drawText(`page ${index} `.repeat(400), { font, size: 6, x: 5, y: 700 })
  }

  return asBlob(await doc.save())
}

async function read(blob: Blob) {
  const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), {
    updateMetadata: false,
  })

  return {
    title: doc.getTitle(),
    /** Source page numbers, recovered from the heights `ladder` assigned. */
    order: doc.getPages().map((page) => Math.round(page.getSize().height) - 100),
    rotations: doc.getPages().map((page) => page.getRotation().angle),
  }
}

const input = (
  files: readonly Blob[],
  organize?: PdfOrganizeOptions,
  op: Operation = 'organize',
): EngineInput => ({ task: { from: 'pdf', to: 'pdf', op }, files, pdf: { organize } })

const nothing = () => {}
const live = () => new AbortController().signal

afterEach(() => {
  vi.restoreAllMocks()
})

describe('organising PDF pages', () => {
  it('keeps every page as it is when no settings are given', async () => {
    const source = await makePdf(ladder(3))

    const out = await organizePages(input([source]), live(), nothing)

    expect(await read(out)).toMatchObject({ order: [1, 2, 3], rotations: [0, 0, 0] })
    expect(out.type).toBe('application/pdf')
  })

  it('reorders the pages to the order it was given', async () => {
    const source = await makePdf(ladder(4))

    const out = await organizePages(input([source], { order: [4, 1, 3, 2] }), live(), nothing)

    expect((await read(out)).order).toEqual([4, 1, 3, 2])
  })

  it('deletes pages by leaving them out of the order', async () => {
    // Deletion is absence rather than a second list, so "keep 1 and 4" and
    // "delete 2 and 3" cannot disagree about a page named in both.
    const source = await makePdf(ladder(5))

    const out = await organizePages(input([source], { order: [1, 4] }), live(), nothing)

    expect((await read(out)).order).toEqual([1, 4])
  })

  it('leaves no trace of a deleted page in the output', async () => {
    // The reason a delete rebuilds the document instead of removing pages from
    // the one it loaded: pdf-lib's page-tree removal unlinks a page but never
    // collects it, so an in-place delete writes every dropped page back out and
    // the user's "shrink this PDF" produces a file the same size.
    const source = await makeFatPdf(12)

    const out = await organizePages(input([source], { order: [1] }), live(), nothing)

    expect(out.size).toBeLessThan(source.size / 2)
  })
})

describe('rotating PDF pages', () => {
  it('adds to the rotation the page already carries', async () => {
    // The acceptance criterion behind the additive rule: a sideways scan is
    // already at 90°, and a user who nudges it one more quarter turn in the
    // thumbnail expects 180 rather than the 90 an absolute set would leave.
    const source = await makePdf([{ height: 101, rotation: 90 }, { height: 102 }])

    const out = await organizePages(input([source], { rotate: { 1: 90 } }), live(), nothing)

    expect((await read(out)).rotations).toEqual([180, 0])
  })

  it('wraps past a full turn rather than writing an angle no reader accepts', async () => {
    const source = await makePdf([{ height: 101, rotation: 270 }])

    const out = await organizePages(input([source], { rotate: { 1: 180 } }), live(), nothing)

    expect((await read(out)).rotations).toEqual([90])
  })

  it('normalises a negative rotation left behind by the producing tool', async () => {
    const source = await makePdf([{ height: 101, rotation: -90 }])

    const out = await organizePages(input([source], { rotate: { 1: 90 } }), live(), nothing)

    expect((await read(out)).rotations).toEqual([0])
  })

  it('keys rotations by source page, not by the position in the output', async () => {
    // The thumbnail the user rotated is a source page. If this were keyed by
    // output position, dragging a page after rotating it would silently move the
    // rotation to whichever page landed there.
    const source = await makePdf(ladder(3))

    const out = await organizePages(
      input([source], { order: [3, 2, 1], rotate: { 1: 90 } }),
      live(),
      nothing,
    )

    expect(await read(out)).toMatchObject({ order: [3, 2, 1], rotations: [0, 0, 90] })
  })

  it('leaves pages the rotation map does not mention alone', async () => {
    const source = await makePdf([{ height: 101, rotation: 180 }, { height: 102 }])

    const out = await organizePages(input([source], { rotate: { 2: 90 } }), live(), nothing)

    expect((await read(out)).rotations).toEqual([180, 90])
  })

  it('ignores a rotation aimed at a page the order deletes', async () => {
    // A thumbnail grid keeps rotation state per page; deleting a page the user
    // had already turned leaves a stale entry behind. Rejecting that would fail
    // a job over a setting with nothing left to apply to.
    const source = await makePdf(ladder(3))

    const out = await organizePages(
      input([source], { order: [1, 3], rotate: { 2: 90 } }),
      live(),
      nothing,
    )

    expect(await read(out)).toMatchObject({ order: [1, 3], rotations: [0, 0] })
  })

  it('serves the rotate operation exactly as it serves organize', async () => {
    // Same options, same document: the operation label records what the user
    // opened, and must not become a hidden input that changes the output.
    const source = await makePdf(ladder(3))
    const options: PdfOrganizeOptions = { order: [2, 1, 3], rotate: { 2: 270 } }

    const organized = await organizePages(input([source], options, 'organize'), live(), nothing)
    const rotated = await organizePages(input([source], options, 'rotate'), live(), nothing)

    expect(await read(rotated)).toEqual(await read(organized))
  })
})

describe('what organising refuses', () => {
  const source = () => makePdf(ladder(3))

  it('names a page the document does not have', async () => {
    await expect(
      organizePages(input([await source()], { order: [1, 9] }), live(), nothing),
    ).rejects.toThrow(/9.*3 pages/s)
  })

  it('names a page number below one, because pages are 1-based here', async () => {
    await expect(
      organizePages(input([await source()], { order: [0, 1] }), live(), nothing),
    ).rejects.toThrow(/"0"/)
  })

  it('names a page number that is not a whole number', async () => {
    await expect(
      organizePages(input([await source()], { order: [1.5] }), live(), nothing),
    ).rejects.toThrow(/"1.5"/)
  })

  it('names a page listed twice, rather than quietly duplicating it', async () => {
    // `rotate` is keyed by source page, so a page appearing twice in the output
    // has one rotation entry and two places to put it. Duplication is a feature
    // that has to re-key rotations first; until then it is a rejected request.
    await expect(
      organizePages(input([await source()], { order: [1, 2, 1] }), live(), nothing),
    ).rejects.toThrow(/page 1 twice/)
  })

  it('refuses an order that would keep nothing', async () => {
    await expect(
      organizePages(input([await source()], { order: [] }), live(), nothing),
    ).rejects.toThrow(/no pages/)
  })

  it('names a rotation that is not a quarter turn', async () => {
    await expect(
      organizePages(
        // Cast: the type forbids this, but the options cross a worker message
        // boundary and arrive as plain data, so the check has to exist at run time.
        input([await source()], { rotate: { 1: 45 } } as unknown as PdfOrganizeOptions),
        live(),
        nothing,
      ),
    ).rejects.toThrow(/45/)
  })

  it('names a rotation aimed at a page outside the document', async () => {
    await expect(
      organizePages(input([await source()], { rotate: { 7: 90 } }), live(), nothing),
    ).rejects.toThrow(/7.*3 pages/s)
  })

  it('names an out-of-spec rotation it found on the page itself', async () => {
    const skewed = await makePdf(ladder(1))
    const doc = await PDFDocument.load(new Uint8Array(await skewed.arrayBuffer()))
    // Written straight into the page dictionary, past pdf-lib's own quarter-turn
    // guard — which is exactly how a non-conforming producer leaves it.
    doc.getPages()[0].node.set(PDFName.of('Rotate'), doc.context.obj(45))
    const file = asBlob(await doc.save())

    await expect(
      organizePages(input([file], { rotate: { 1: 90 } }), live(), nothing),
    ).rejects.toThrow(/45/)
  })

  it('organises one document at a time, and says how many it was handed', async () => {
    await expect(organizePages(input([]), live(), nothing)).rejects.toThrow(/0 files/)
    await expect(
      organizePages(input([await source(), await source()]), live(), nothing),
    ).rejects.toThrow(/2 files/)
  })

  it('says a file is not a readable PDF instead of leaking the parser message', async () => {
    // `PDFDocument.load` is lenient: bytes with no usable catalog resolve, and
    // the failure lands on the first structural read as a bare "Cannot read
    // properties of undefined (reading 'Pages')", which explains nothing.
    await expect(organizePages(input([new Blob(['%PDF-1.7'])]), live(), nothing)).rejects.toThrow(
      /could not be read as a PDF/i,
    )
  })

  it('says so when the document is password-protected', async () => {
    const locked = await lockedPdfBlob()

    await expect(organizePages(input([locked]), live(), nothing)).rejects.toThrow(
      /password-protected/i,
    )

    // #176: and still, with the word taken out of pdf-lib's refusal — the
    // trailer is what answers, not the sentence.
    rewordEncryptedRefusal()

    await expect(organizePages(input([locked]), live(), nothing)).rejects.toThrow(
      /password-protected/i,
    )
  })
})

describe('progress and cancellation', () => {
  it('opens indeterminate, ticks once per page, and ends at 1', async () => {
    const file = await makePdf(ladder(4))
    const seen: number[] = []

    await organizePages(input([file]), live(), (progress) => seen.push(progress))

    // Parsing and serialising are single opaque pdf-lib calls, so -1 is the
    // honest opening state; the per-page pass is the only part that can tick.
    expect(seen[0]).toBe(-1)
    expect(seen).toContain(0.5)
    expect(seen.at(-1)).toBe(1)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('refuses a job that was cancelled before it started', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      organizePages(input([await makePdf(ladder(2))]), controller.signal, nothing),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stops part-way through and delivers nothing when cancelled mid-run', async () => {
    const controller = new AbortController()
    const seen: number[] = []

    await expect(
      organizePages(
        input([await makePdf(ladder(8))], { rotate: { 1: 90, 2: 90, 3: 90 } }),
        controller.signal,
        (progress) => {
          seen.push(progress)
          if (progress > 0) controller.abort()
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })

    // Cancelling means stopping, not finishing quietly and discarding the result:
    // one page of eight was reported, and the other seven ticks never came.
    expect(seen).toEqual([-1, 0.125])
  })
})

describe('what survives the operation', () => {
  it('keeps document metadata when only rotations change', async () => {
    const source = await makePdf(ladder(2), 'Scan of a contract')

    const out = await organizePages(input([source], { rotate: { 1: 90 } }), live(), nothing)

    expect((await read(out)).title).toBe('Scan of a contract')
  })

  it('keeps document metadata across the rebuild a deletion forces', async () => {
    const source = await makePdf(ladder(3), 'Scan of a contract')

    const out = await organizePages(input([source], { order: [2] }), live(), nothing)

    expect((await read(out)).title).toBe('Scan of a contract')
  })
})
