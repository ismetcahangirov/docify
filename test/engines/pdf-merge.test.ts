// @vitest-environment node
//
// Merging is pure document surgery: no canvas, no WASM, nothing that needs a
// DOM. Running it without jsdom keeps the test honest about that — anything the
// operation reached for in `window` would fail here rather than in a worker.
//
// Every fixture is built with pdf-lib in-process rather than committed as a
// binary. A checked-in PDF is an opaque blob nobody can review, and four EPIC 5
// branches adding one each is four needless collisions.

import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { MAX_MERGE_FILES, mergePdfs } from '@/lib/engines/pdf-merge'
import { createRunner } from '@/lib/engines/pdflib'
import type { EngineInput, ProgressCallback } from '@/lib/engines/types'
import type { ConversionTask } from '@/lib/router/types'

const merge: ConversionTask = { from: 'pdf', to: 'pdf', op: 'merge' }

const nothing: ProgressCallback = () => {}

/**
 * A PDF whose pages are identifiable by width.
 *
 * Page count alone cannot show that order was preserved — three one-page files
 * merge to three pages whichever way round they went in. Giving every page a
 * distinct width makes the merged document spell out the order it was built in.
 */
async function pdf(widths: readonly number[], name?: string): Promise<Blob> {
  const document = await PDFDocument.create()
  for (const width of widths) document.addPage([width, 200])
  const bytes = new Uint8Array(await document.save())

  return name === undefined ? new Blob([bytes]) : new File([bytes], name)
}

/** The widths of every page in `blob`, in document order. */
async function widthsOf(blob: Blob): Promise<number[]> {
  const document = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()))

  return document.getPages().map((page) => Math.round(page.getWidth()))
}

const input = (files: readonly Blob[]): EngineInput => ({ task: merge, files })

const run = (
  files: readonly Blob[],
  signal: AbortSignal = new AbortController().signal,
  onProgress: ProgressCallback = nothing,
): Promise<Blob> => mergePdfs(input(files), signal, onProgress)

describe('merging PDFs', () => {
  it('joins every page of every document into one', async () => {
    const out = await run([await pdf([100, 101]), await pdf([200]), await pdf([300, 301, 302])])

    expect(await widthsOf(out)).toEqual([100, 101, 200, 300, 301, 302])
  })

  it('follows the order the files arrive in rather than imposing one', async () => {
    // `EngineInput.files` is the user's order — what drag-to-reorder will
    // rewrite in EPIC 7. Sorting here would silently overrule the user.
    const out = await run([await pdf([300]), await pdf([100]), await pdf([200])])

    expect(await widthsOf(out)).toEqual([300, 100, 200])
  })

  it('merges the full hundred documents the tool promises', async () => {
    const files = await Promise.all(
      Array.from({ length: MAX_MERGE_FILES }, (_, index) => pdf([100 + index])),
    )

    const out = await run(files)

    expect(await widthsOf(out)).toHaveLength(MAX_MERGE_FILES)
  })

  it('labels the result as a PDF', async () => {
    const out = await run([await pdf([100]), await pdf([200])])

    expect(out.type).toBe('application/pdf')
  })
})

describe('rejecting a merge that cannot work', () => {
  it('says how many files it got when there are too few to merge', async () => {
    await expect(run([await pdf([100])])).rejects.toThrow(/at least two.*only 1 file/is)
    await expect(run([])).rejects.toThrow(/at least two/i)
  })

  it('quotes the limit and the count when there are too many files', async () => {
    const one = await pdf([100])
    const files = Array.from({ length: MAX_MERGE_FILES + 1 }, () => one)

    await expect(run(files)).rejects.toThrow(
      new RegExp(`${MAX_MERGE_FILES}.*${MAX_MERGE_FILES + 1} files`, 's'),
    )
  })

  it('names the file that is not a PDF, and what to do about it', async () => {
    const notPdf = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'holiday.png')

    const failure = run([await pdf([100]), notPdf, await pdf([200])])

    await expect(failure).rejects.toThrow(/holiday\.png/)
    await expect(failure).rejects.toThrow(/not a PDF/i)
    // CLAUDE.md §2.5: naming the problem without naming a way out is half an
    // error message.
    await expect(failure).rejects.toThrow(/convert it to PDF/i)
  })

  it('falls back to the position when a file carries no name', async () => {
    // The worker receives `Blob`s; only the ones that came straight from a file
    // picker are `File`s with a name. Position is the only other handle a person
    // has on which file went wrong.
    const failure = run([await pdf([100]), new Blob([new Uint8Array([1, 2, 3])])])

    await expect(failure).rejects.toThrow(/file 2 of 2/i)
  })

  it('rejects a file it cannot read before it silently drops the pages', async () => {
    // A PDF header followed by rubbish is what a truncated download looks like.
    // pdf-lib answers it with an internal TypeError about a missing `Pages`
    // key — true, and useless to the person holding the file.
    const damaged = new File([new TextEncoder().encode('%PDF-1.7\nnot really')], 'scan.pdf')

    const failure = run([await pdf([100]), damaged])

    await expect(failure).rejects.toThrow(/scan\.pdf/)
    await expect(failure).rejects.toThrow(/could not be read|damaged/i)
  })

  it('accepts a document that carries junk before its header', async () => {
    // Readers scan the head of the file for `%PDF-`, and so does pdf-lib. A
    // check pinned to offset zero would reject files that open everywhere else.
    const good = new Uint8Array(await (await pdf([200])).arrayBuffer())
    const prefixed = new Uint8Array(good.length + 5)
    prefixed.set(new TextEncoder().encode('junk!'))
    prefixed.set(good, 5)

    const out = await run([await pdf([100]), new Blob([prefixed])])

    expect(await widthsOf(out)).toEqual([100, 200])
  })
})

describe('reporting progress', () => {
  it('reports a real fraction per file and finishes at exactly 1', async () => {
    const files = await Promise.all([pdf([100]), pdf([200]), pdf([300]), pdf([400])])
    const seen: number[] = []

    await run(files, new AbortController().signal, (progress) => seen.push(progress))

    // One file of four is a genuine quarter, so indeterminate mode would be a
    // lie here — see `ProgressCallback` in lib/engines/types.ts.
    expect(seen).not.toContain(-1)
    expect(seen.length).toBeGreaterThanOrEqual(files.length + 1)
    expect(seen.at(-1)).toBe(1)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  it('never runs backwards, and never claims completion before the file exists', async () => {
    const files = await Promise.all([pdf([100]), pdf([200]), pdf([300])])
    const seen: number[] = []

    await run(files, new AbortController().signal, (progress) => seen.push(progress))

    expect(seen[0]).toBe(0)
    // Serialising the merged document is the last real cost; showing 100% while
    // it runs would freeze a full bar in front of the user.
    expect(seen.slice(0, -1).every((progress) => progress < 1)).toBe(true)
  })
})

describe('cancelling a merge', () => {
  it('refuses a signal that was already aborted, before touching a file', async () => {
    const controller = new AbortController()
    controller.abort()

    // Rubbish input on purpose: if validation ran first the message would name
    // the file rather than the cancellation.
    const failure = run(
      [new Blob([new Uint8Array([1])]), new Blob([new Uint8Array([2])])],
      controller.signal,
    )

    await expect(failure).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stops between files, not merely at the start', async () => {
    const files = await Promise.all(
      Array.from({ length: 8 }, (_, index) => pdf([100 + index * 10])),
    )
    const controller = new AbortController()
    const seen: number[] = []

    // A timer, not a resolved promise: the worker learns about a cancellation
    // from a `cancel(jobId)` *message*, and a loop that only awaits microtasks
    // never lets the message loop run — so `signal.aborted` would stay false for
    // the whole merge. See the cancellation notes in lib/worker/types.ts.
    setTimeout(() => controller.abort(), 0)

    await expect(run(files, controller.signal, (progress) => seen.push(progress))).rejects.toThrow(
      /cancel/i,
    )

    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)).not.toBe(1)
    expect(seen.length).toBeLessThan(files.length)
  })
})

describe('the pdflib engine wiring', () => {
  it('routes a merge job to this operation', async () => {
    // The one line of `pdflib.ts` this issue owns. Loading the operation through
    // `await import()` is what keeps pdf-lib out of the initial bundle
    // (CLAUDE.md §2.3), so the runner is exercised rather than bypassed.
    const out = await createRunner().run(
      input([await pdf([100]), await pdf([200])]),
      new AbortController().signal,
      nothing,
    )

    expect(await widthsOf(out)).toEqual([100, 200])
  })
})
