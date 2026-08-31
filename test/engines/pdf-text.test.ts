// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { extractPdfText, PAGE_SEPARATOR } from '@/lib/engines/pdf-text'
import type { PdfTextItem } from '@/lib/engines/pdf-text-layout'
import type { EngineInput } from '@/lib/engines/types'

import { fakePdfjs } from './pdfjs-fake'

const nothing = () => {}
const running = () => new AbortController().signal

const job = (pdf?: EngineInput['pdf']): EngineInput => ({
  task: { from: 'pdf', to: 'txt', op: 'convert' },
  files: [new Blob(['%PDF-1.7'])],
  pdf,
})

/** One line of text on a page, positioned the way pdf.js reports it. */
function line(text: string, y: number): PdfTextItem {
  return {
    str: text,
    transform: [10, 0, 0, 10, 72, y],
    width: text.length * 5,
    height: 10,
    hasEOL: true,
  }
}

const textOf = async (blob: Blob) => blob.text()

describe('extractPdfText', () => {
  it('reads every page and separates them with a form feed', async () => {
    const fake = fakePdfjs([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ])
    fake.textFor = (page) => [line(`Page ${page}`, 700)]

    const output = await extractPdfText(job(), running(), nothing, { load: fake.load })

    expect(await textOf(output)).toBe(`Page 1\n${PAGE_SEPARATOR}\nPage 2`)
  })

  it('labels the result as text, so a browser shows it rather than saving it blind', async () => {
    const fake = fakePdfjs()
    fake.textFor = () => [line('anything', 700)]

    const output = await extractPdfText(job(), running(), nothing, { load: fake.load })

    expect(output.type).toBe('text/plain;charset=utf-8')
  })

  it('reads only the pages that were asked for', async () => {
    const fake = fakePdfjs([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ])
    fake.textFor = (page) => [line(`Page ${page}`, 700)]

    const output = await extractPdfText(job({ text: { pages: '3' } }), running(), nothing, {
      load: fake.load,
    })

    expect(await textOf(output)).toBe('Page 3')
  })

  it('explains a scan instead of handing back an empty file', async () => {
    // A photograph of a page carries no text objects at all. An empty `.txt` is
    // indistinguishable from a broken converter, so this names the cause and
    // points at the tool that would actually help.
    const fake = fakePdfjs()

    await expect(extractPdfText(job(), running(), nothing, { load: fake.load })).rejects.toThrow(
      /most likely a scan/,
    )
  })

  it('releases every page it read, and the document with them', async () => {
    const fake = fakePdfjs([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ])
    fake.textFor = () => [line('words', 700)]

    await extractPdfText(job(), running(), nothing, { load: fake.load })

    // A page holds its operator list and font references until it is cleaned up;
    // a two hundred page document would otherwise hold all of them at once.
    expect(fake.pages.map((page) => page.cleanups)).toEqual([1, 1])
    expect(fake.destroys).toBe(1)
  })

  it('releases the document even when a page fails', async () => {
    const fake = fakePdfjs()
    fake.textFor = () => {
      throw new Error('this content stream is broken')
    }

    await expect(extractPdfText(job(), running(), nothing, { load: fake.load })).rejects.toThrow(
      /content stream/,
    )
    expect(fake.destroys).toBe(1)
  })

  it('opens indeterminate, then climbs to one as the pages are read', async () => {
    const fake = fakePdfjs([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ])
    fake.textFor = () => [line('words', 700)]
    const seen: number[] = []

    await extractPdfText(job(), running(), (progress) => seen.push(progress), {
      load: fake.load,
    })

    expect(seen[0]).toBe(-1)
    expect(seen.at(-1)).toBe(1)
    expect(seen.slice(1)).toEqual([...seen.slice(1)].sort((a, b) => a - b))
  })

  it('refuses a job that was cancelled before it started', async () => {
    const fake = fakePdfjs()
    const controller = new AbortController()
    controller.abort()

    await expect(
      extractPdfText(job(), controller.signal, nothing, { load: fake.load }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(fake.loads).toEqual([])
  })

  it('reads one document at a time, and says so', async () => {
    const fake = fakePdfjs()

    await expect(
      extractPdfText(
        { ...job(), files: [new Blob(['%PDF']), new Blob(['%PDF'])] },
        running(),
        nothing,
        { load: fake.load },
      ),
    ).rejects.toThrow(/one document at a time/)
  })
})
