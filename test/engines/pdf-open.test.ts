// @vitest-environment node
//
// The guard under test is the one thing every pdf-lib operation has to get
// right before it can do anything at all, so it is tested here once — on the
// two failure shapes that matter — rather than three times over from inside
// merge, split and organize.

import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { openPdf } from '@/lib/engines/pdf-open'

const encrypted = 'This PDF is locked. Unlock it first.'
const damaged = (detail: string) => `This file could not be read as a PDF: ${detail}`

/** A document of `pageCount` pages, as the bytes an operation would hand over. */
async function fixture(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create()

  for (let page = 1; page <= pageCount; page += 1) document.addPage([200, 800])

  return new Uint8Array(await document.save())
}

/**
 * A document that declares `/Encrypt` in its trailer.
 *
 * Written out by hand because pdf-lib can read encryption but not write it, and
 * splicing the entry into a generated file would corrupt the compressed streams
 * around it.
 */
function locked(): Uint8Array {
  return new TextEncoder().encode(
    [
      '%PDF-1.7',
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>\nendobj',
      '4 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -1 >>\nendobj',
      'trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R >>',
      '%%EOF',
    ].join('\n'),
  )
}

describe('opening a document that can be read', () => {
  it('hands back whatever the caller read out of it', async () => {
    const pageCount = await openPdf(await fixture(3), {
      read: (source) => source.getPageCount(),
      encrypted,
      damaged,
    })

    expect(pageCount).toBe(3)
  })

  it('awaits a read that is asynchronous, as copying pages is', async () => {
    const into = await PDFDocument.create()

    const pages = await openPdf(await fixture(2), {
      read: (source) => into.copyPages(source, source.getPageIndices()),
      encrypted,
      damaged,
    })

    expect(pages).toHaveLength(2)
  })

  it('passes its load options through to pdf-lib', async () => {
    // `ignoreEncryption` is the observable one: it turns the failure below into
    // a successful open, which nothing else in this helper could do.
    const pageCount = await openPdf(locked(), {
      load: { ignoreEncryption: true },
      read: (source) => source.getPageCount(),
      encrypted,
      damaged,
    })

    expect(pageCount).toBe(1)
  })
})

describe('opening a document that cannot be read', () => {
  it('answers an encrypted document with the caller’s own wording', async () => {
    await expect(
      openPdf(locked(), { read: (source) => source.getPageCount(), encrypted, damaged }),
    ).rejects.toThrow(encrypted)
  })

  it('catches the failure pdf-lib defers to the first structural read', async () => {
    // `PDFDocument.load` is lenient: these bytes resolve, and the failure lands
    // on the page tree as a bare "Cannot read properties of undefined (reading
    // 'Pages')". Reading inside the guard is the whole point of the helper.
    const failure = openPdf(new TextEncoder().encode('%PDF-1.7'), {
      read: (source) => source.getPageCount(),
      encrypted,
      damaged,
    })

    await expect(failure).rejects.toThrow(/could not be read as a PDF/i)
    await expect(failure).rejects.toThrow(/Pages/)
  })

  it('catches a read that rejects rather than throws', async () => {
    // Merge's read is `copyPages`, which returns a promise. Handing that promise
    // back instead of awaiting it inside the guard would let pdf-lib's own words
    // reach the user with no file name attached — the failure this module
    // exists to prevent.
    await expect(
      openPdf(await fixture(1), {
        read: () => Promise.reject(new Error('deferred by the page tree')),
        encrypted,
        damaged,
      }),
    ).rejects.toThrow(/could not be read as a PDF: deferred by the page tree/)
  })

  it('keeps the parser’s own words inside the caller’s sentence', async () => {
    // "Expected instance of PDFDict" alone tells the user nothing, but it is
    // what distinguishes a truncated download from a file that is not a PDF.
    await expect(
      openPdf(new TextEncoder().encode('not a PDF at all'), {
        read: (source) => source.getPageCount(),
        encrypted,
        damaged: (detail) => `prefix: ${detail}`,
      }),
    ).rejects.toThrow(/^prefix: .+/)
  })

  it('survives a thrown value that is not an Error', async () => {
    await expect(
      openPdf(await fixture(1), {
        read: () => {
          throw 'no stack, no message'
        },
        encrypted,
        damaged,
      }),
    ).rejects.toThrow(/no stack, no message/)
  })
})
