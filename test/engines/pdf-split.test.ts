// @vitest-environment node
//
// Fixtures are built here with pdf-lib rather than committed as binaries: a
// checked-in PDF is opaque in review, and every page it holds has to be
// described in a comment anyway.
//
// Pages are told apart by their *width*. Asserting on rendered text would need
// a rasteriser this engine deliberately does not have, while page geometry
// survives `copyPages` untouched and reads as a plain number — so page N is
// 100 + N points wide, and "the right pages in the right document" becomes an
// array comparison.

import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { splitPdf } from '@/lib/engines/pdf-split'
import type { PdfSplitOptions } from '@/lib/engines/pdf-options'
import type { EngineInput } from '@/lib/engines/types'
import type { ConversionTask } from '@/lib/router/types'

import { lockedPdfBlob, rewordEncryptedRefusal } from '../support/pdf-lib'

const task: ConversionTask = { from: 'pdf', to: 'pdf', op: 'split' }

const nothing = () => {}

/**
 * `document` as a blob the engine can be handed.
 *
 * The copy exists only to satisfy `BlobPart`, which accepts a view over a plain
 * `ArrayBuffer` while pdf-lib types `save()` as a view over any buffer at all.
 */
async function blobOf(document: PDFDocument): Promise<Blob> {
  return new Blob([new Uint8Array(await document.save())], { type: 'application/pdf' })
}

/** A document of `pageCount` pages, where page N is `100 + N` points wide. */
async function fixture(pageCount: number): Promise<Blob> {
  const document = await PDFDocument.create()

  for (let page = 1; page <= pageCount; page += 1) document.addPage([100 + page, 800])

  return blobOf(document)
}

function input(source: Blob, split?: PdfSplitOptions): EngineInput {
  return { task, files: [source], pdf: split === undefined ? undefined : { split } }
}

/** The archive's entries, in the order they were written into it. */
async function entriesOf(archive: Blob): Promise<[string, Uint8Array][]> {
  return Object.entries(unzipSync(new Uint8Array(await archive.arrayBuffer())))
}

/** The page widths of one output document, rounded — the pages it actually holds. */
async function widthsOf(bytes: Uint8Array | Blob): Promise<number[]> {
  const source = bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : bytes
  const document = await PDFDocument.load(source)

  return document.getPages().map((page) => Math.round(page.getWidth()))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('splitting into individual pages', () => {
  it('emits one document per page, in page order', async () => {
    const archive = await splitPdf(
      input(await fixture(3), { mode: 'every-page' }),
      new AbortController().signal,
      nothing,
    )

    const entries = await entriesOf(archive)

    expect(entries.map(([name]) => name)).toEqual(['page-1.pdf', 'page-2.pdf', 'page-3.pdf'])
    expect(await Promise.all(entries.map(([, bytes]) => widthsOf(bytes)))).toEqual([
      [101],
      [102],
      [103],
    ])
  })

  it('is what a job with no settings at all asks for', async () => {
    // `PdfOptions` is entirely optional by design, so "split this" has to mean
    // something on its own. One document per page is the only reading that
    // needs no further input from the user.
    const archive = await splitPdf(input(await fixture(2)), new AbortController().signal, nothing)

    expect((await entriesOf(archive)).map(([name]) => name)).toEqual(['page-1.pdf', 'page-2.pdf'])
  })

  it('ignores a range spec, because `every-page` was asked for explicitly', async () => {
    const archive = await splitPdf(
      input(await fixture(3), { mode: 'every-page', ranges: '1-2' }),
      new AbortController().signal,
      nothing,
    )

    expect(await entriesOf(archive)).toHaveLength(3)
  })

  it('pads page numbers to the width of the last one, so a file manager sorts them', async () => {
    // Unpadded, `page-10.pdf` sorts between `page-1.pdf` and `page-2.pdf` in
    // every file browser that orders names lexically — which is most of them.
    const archive = await splitPdf(
      input(await fixture(12), { mode: 'every-page' }),
      new AbortController().signal,
      nothing,
    )

    const names = (await entriesOf(archive)).map(([name]) => name)

    expect(names[0]).toBe('page-01.pdf')
    expect(names[11]).toBe('page-12.pdf')
  })
})

describe('splitting by page range', () => {
  it('keeps each listed span as one document, holding exactly its pages', async () => {
    const archive = await splitPdf(
      input(await fixture(5), { mode: 'ranges', ranges: '1-2, 4' }),
      new AbortController().signal,
      nothing,
    )

    const entries = await entriesOf(archive)

    expect(entries.map(([name]) => name)).toEqual(['pages-1-2.pdf', 'page-4.pdf'])
    expect(await Promise.all(entries.map(([, bytes]) => widthsOf(bytes)))).toEqual([
      [101, 102],
      [104],
    ])
  })

  it('infers the mode from the presence of a range', async () => {
    const archive = await splitPdf(
      input(await fixture(4), { ranges: '2-3, 4' }),
      new AbortController().signal,
      nothing,
    )

    expect((await entriesOf(archive)).map(([name]) => name)).toEqual([
      'pages-2-3.pdf',
      'page-4.pdf',
    ])
  })

  it('reads an open-ended range against the real page count', async () => {
    const archive = await splitPdf(
      input(await fixture(4), { ranges: '1, 3-' }),
      new AbortController().signal,
      nothing,
    )

    const entries = await entriesOf(archive)

    expect(entries.map(([name]) => name)).toEqual(['page-1.pdf', 'pages-3-4.pdf'])
    expect(await widthsOf(entries[1][1])).toEqual([103, 104])
  })

  it('keeps the order and the repeats the user wrote, under names that stay distinct', async () => {
    // `parsePageSpans` preserves both on purpose; a split that deduplicated
    // would silently drop a document the user asked for, and a ZIP keyed by
    // name would silently drop the second copy of it.
    const archive = await splitPdf(
      input(await fixture(5), { ranges: '3, 1-2, 3' }),
      new AbortController().signal,
      nothing,
    )

    const entries = await entriesOf(archive)

    expect(entries.map(([name]) => name)).toEqual(['page-3.pdf', 'pages-1-2.pdf', 'page-3-2.pdf'])
    expect(await Promise.all(entries.map(([, bytes]) => widthsOf(bytes)))).toEqual([
      [103],
      [101, 102],
      [103],
    ])
  })
})

describe('a split that produces a single document', () => {
  it('hands back the PDF itself rather than an archive holding one file', async () => {
    // What the user downloads is the whole argument: a one-entry ZIP costs a
    // save, a locate and an unpack before they can open the thing they asked
    // for, and buys nothing — there is no second file to keep apart from it.
    const result = await splitPdf(
      input(await fixture(5), { ranges: '2-3' }),
      new AbortController().signal,
      nothing,
    )

    expect(result.type).toBe('application/pdf')
    expect(await widthsOf(result)).toEqual([102, 103])
  })

  it('applies to a one-page document split into its pages, too', async () => {
    const result = await splitPdf(
      input(await fixture(1), { mode: 'every-page' }),
      new AbortController().signal,
      nothing,
    )

    expect(result.type).toBe('application/pdf')
    expect(await widthsOf(result)).toEqual([101])
  })

  it('still writes an archive as soon as there are two documents', async () => {
    const result = await splitPdf(
      input(await fixture(5), { ranges: '2-3, 5' }),
      new AbortController().signal,
      nothing,
    )

    expect(result.type).toBe('application/zip')
  })
})

describe('progress', () => {
  it('opens indeterminate, then ticks once per output document and ends at 1', async () => {
    // The parse is one synchronous pass through pdf-lib with no way to measure
    // it, and the span count is unknown until it finishes — so -1 is the honest
    // opening state. Everything after it is a real fraction of real documents.
    const seen: number[] = []

    await splitPdf(
      input(await fixture(4), { mode: 'every-page' }),
      new AbortController().signal,
      (progress) => seen.push(progress),
    )

    expect(seen).toEqual([-1, 0, 0.25, 0.5, 0.75, 1])
  })

  it('reaches 1 only once the finished blob exists', async () => {
    const seen: number[] = []

    await splitPdf(
      input(await fixture(2), { mode: 'every-page' }),
      new AbortController().signal,
      (progress) => seen.push(progress),
    )

    expect(seen[seen.length - 1]).toBe(1)
    expect(seen.slice(0, -1)).not.toContain(1)
  })
})

describe('cancellation', () => {
  it('refuses a job that was already cancelled, before reading the file', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      splitPdf(input(await fixture(3), { mode: 'every-page' }), controller.signal, nothing),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stops between documents and produces nothing at all', async () => {
    const controller = new AbortController()
    const seen: number[] = []

    await expect(
      splitPdf(input(await fixture(8), { mode: 'every-page' }), controller.signal, (progress) => {
        seen.push(progress)
        if (progress >= 0.25) controller.abort()
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    // The tick that triggered the abort is the last one: no further document
    // was built, and no partial archive was handed back as if it were a result.
    expect(seen).toEqual([-1, 0, 0.125, 0.25])
  })
})

describe('errors that have to explain themselves', () => {
  it('says which page the document does not have', async () => {
    await expect(
      splitPdf(input(await fixture(3), { ranges: '9' }), new AbortController().signal, nothing),
    ).rejects.toThrow(/page 9.*3 pages/)
  })

  it('asks for the range that `ranges` mode is missing', async () => {
    await expect(
      splitPdf(input(await fixture(3), { mode: 'ranges' }), new AbortController().signal, nothing),
    ).rejects.toThrow(/range/i)
  })

  it('names the file count when handed more than one document', async () => {
    const source = await fixture(2)

    await expect(
      splitPdf({ task, files: [source, source] }, new AbortController().signal, nothing),
    ).rejects.toThrow(/one document at a time.*2 files/)
  })

  it('says the file is not a readable PDF rather than leaking a parser message', async () => {
    await expect(
      splitPdf(
        { task, files: [new Blob(['%PDF-1.7 and then nothing useful'])] },
        new AbortController().signal,
        nothing,
      ),
    ).rejects.toThrow(/could not be read as a PDF/i)
  })

  it('tells the user a password-protected document has to be unlocked first', async () => {
    // pdf-lib refuses an encrypted document outright; without this the user
    // would see "Input document to `PDFDocument.load` is encrypted", which
    // names an API rather than a next step.
    const locked = await lockedPdfBlob(2)

    await expect(
      splitPdf({ task, files: [locked] }, new AbortController().signal, nothing),
    ).rejects.toThrow(/password/i)

    // #176: and still with the word taken out of pdf-lib's refusal. Split,
    // merge and organize share `openPdf`, so all three fail or hold together.
    rewordEncryptedRefusal()

    await expect(
      splitPdf({ task, files: [locked] }, new AbortController().signal, nothing),
    ).rejects.toThrow(/password/i)
  })
})
