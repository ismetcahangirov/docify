// @vitest-environment node
//
// The guard under test is the one thing every pdf-lib operation has to get
// right before it can do anything at all, so it is tested here once — on the
// failure shapes that matter: encrypted, unparseable, and the cancellation it
// must not mistake for either — rather than three times over from inside merge,
// split and organize.

import { EncryptedPDFError, PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { openPdf } from '@/lib/engines/pdf-open'

import { lockedPdfBytes, rewordEncryptedRefusal } from '../support/pdf-lib'

const encrypted = 'This PDF is locked. Unlock it first.'
const damaged = (detail: string) => `This file could not be read as a PDF: ${detail}`

/** A document of `pageCount` pages, as the bytes an operation would hand over. */
async function fixture(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create()

  for (let page = 1; page <= pageCount; page += 1) document.addPage([200, 800])

  return new Uint8Array(await document.save())
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
    const pageCount = await openPdf(await lockedPdfBytes(), {
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
      openPdf(await lockedPdfBytes(), {
        read: (source) => source.getPageCount(),
        encrypted,
        damaged,
      }),
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

describe('opening a document for a job that is being cancelled', () => {
  it('lets the AbortError a read throws through untouched', async () => {
    // A read that checks its signal is the whole reason this matters: the guard
    // wraps the caller's callback, so without an exemption a cancel would come
    // back to the user as "this file is damaged" and be debugged as an engine
    // fault rather than a guard one.
    const cancelled = new DOMException('The conversion was cancelled.', 'AbortError')

    const failure = openPdf(await fixture(1), {
      read: () => {
        throw cancelled
      },
      encrypted,
      damaged,
    })

    // Identity, not shape: rewrapping would preserve the name and still lose the
    // cause chain the worker attaches when it reports the cancellation.
    await expect(failure).rejects.toBe(cancelled)
  })

  it('recognises an abort by name rather than by type', async () => {
    // `lib/worker/errors.ts` throws a plain `Error` subclass named `AbortError`
    // because a `DOMException` does not survive the worker boundary. Matching on
    // `instanceof DOMException` here would translate that one into the damaged
    // wording, which is the same bug wearing the other shape.
    const cancelled = Object.assign(new Error('The conversion was cancelled.'), {
      name: 'AbortError',
    })

    const failure = openPdf(await fixture(1), {
      read: () => Promise.reject(cancelled),
      encrypted,
      damaged,
    })

    await expect(failure).rejects.toBe(cancelled)
  })

  it('holds the exemption to that one name', async () => {
    // The pair above would stay green if the check were loosened to anything
    // matching /abort/i. It must not be: pdf.js calls its cancellation
    // `AbortException`, and a guard that waves through every error with "abort"
    // in the name would hand pdf-lib's raw words to the user the first time one
    // of those names collided — the CLAUDE.md §2.5 failure this helper prevents.
    const impostor = Object.assign(new Error('the operation was aborted'), {
      name: 'AbortException',
    })

    await expect(
      openPdf(await fixture(1), { read: () => Promise.reject(impostor), encrypted, damaged }),
    ).rejects.toThrow(/could not be read as a PDF: the operation was aborted/)
  })
})

describe('what says a document is encrypted', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is not the type, which is dead for the pinned pdf-lib', () => {
    // Measured, not reasoned about. pdf-lib 1.17.1 transpiles its error classes
    // to ES5 with `_this = _super.call(this, msg) || this`; native
    // `Error.call(this, msg)` returns a fresh object rather than initialising
    // `this`, so the prototype chain never connects. If a pdf-lib upgrade ever
    // fixes this, this test fails and the helper can be told about it.
    const raised = new EncryptedPDFError()

    expect(raised instanceof EncryptedPDFError).toBe(false)
    expect(raised.name).toBe('Error')
  })

  it('classifies a locked document whose failure never says the word', async () => {
    // The text match cannot help here: nothing thrown mentions encryption. If
    // it is all that holds the classification up, the user is told their file
    // is damaged and goes looking for a corrupted download.
    rewordEncryptedRefusal()

    await expect(
      openPdf(await lockedPdfBytes(), {
        read: (source) => source.getPageCount(),
        encrypted,
        damaged,
      }),
    ).rejects.toThrow(encrypted)
  })

  it('classifies one that opened and then failed further in', async () => {
    // The case the old comment reserved for the text fallback: loaded with
    // `ignoreEncryption`, so pdf-lib never raises its encrypted error at all,
    // and the failure arrives from the page tree instead.
    await expect(
      openPdf(await lockedPdfBytes(), {
        load: { ignoreEncryption: true },
        read: () => {
          throw new Error("Cannot read properties of undefined (reading 'Pages')")
        },
        encrypted,
        damaged,
      }),
    ).rejects.toThrow(encrypted)
  })

  it('still calls a damaged file damaged', async () => {
    // The structural check must not answer everything: a file that is not a PDF
    // has no trailer to read, and "unlock it first" is advice nobody can follow.
    await expect(
      openPdf(new TextEncoder().encode('not a PDF at all'), {
        read: (source) => source.getPageCount(),
        encrypted,
        damaged,
      }),
    ).rejects.toThrow(/could not be read as a PDF/)
  })
})

describe('the locked fixture the four pdf-lib suites share', () => {
  // It is one document in one place now (#180), so a silent change to it would
  // surface as four confusing failures elsewhere rather than as one here.
  it('is a well-formed document that happens to declare /Encrypt', async () => {
    const relaxed = await PDFDocument.load(await lockedPdfBytes(3), { ignoreEncryption: true })

    expect(relaxed.isEncrypted).toBe(true)
    expect(relaxed.getPageCount()).toBe(3)
  })

  it('is refused by a plain load, which is what every suite leans on', async () => {
    await expect(PDFDocument.load(await lockedPdfBytes())).rejects.toThrow(/encrypt/i)
  })
})
