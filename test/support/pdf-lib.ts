/**
 * Standing in for a pdf-lib that describes an encrypted document differently.
 *
 * `lib/engines/pdf-open.ts` classifies a locked file from the document's own
 * trailer rather than from pdf-lib's sentence, because the type check that
 * would be the obvious way to do it — `reason instanceof EncryptedPDFError` —
 * is dead for the pinned version (#176). A test that hands the helper a real
 * locked document cannot tell the two apart: the message says "encrypted", so
 * the text fallback answers correctly whether the structural check works or
 * not.
 *
 * This takes the word away. Everything else is the real pdf-lib, including the
 * relaxed load the structural check makes — only the refusal is reworded, and
 * only for the call that actually raises it, which is the one where
 * `ignoreEncryption` is off.
 *
 * Restore it with `vi.restoreAllMocks()`.
 *
 * Test-support code, not shipped.
 */

import { PDFDocument } from 'pdf-lib'
import { vi } from 'vitest'

/** What the reworded pdf-lib says instead. Contains no form of "encrypt". */
export const REWORDED_REFUSAL = 'This document is protected.'

export function rewordEncryptedRefusal(): void {
  const real = PDFDocument.load.bind(PDFDocument)

  vi.spyOn(PDFDocument, 'load').mockImplementation(async (bytes, options) => {
    if (options?.ignoreEncryption !== true) {
      const document = await real(bytes as never, { ...options, ignoreEncryption: true })

      if (document.isEncrypted) throw new Error(REWORDED_REFUSAL)
    }

    return real(bytes as never, options)
  })
}

/**
 * A password-protected PDF, built the way the file's own generator builds one.
 *
 * A trailer that resolves `/Encrypt` is the whole of what `PDFDocument.load`
 * refuses on, so declaring one on a document pdf-lib generated itself leaves
 * everything an operation touches first — header at offset zero, catalog, page
 * tree, xref — genuinely well formed, and puts the fault exactly where a test
 * wants it.
 *
 * ## Why not the hand-written literal
 *
 * Three suites used to carry their own locked document and two of them wrote
 * it out by hand, each with a comment claiming that splicing `/Encrypt` into a
 * generated file "would corrupt the compressed streams around it". It does
 * not, which is why this function works and why those comments are gone
 * (#180). What the literal actually produced was a file with **no xref table**,
 * which passes on pdf-lib's tolerance rather than on being a PDF — a fixture
 * that is only accidentally the thing under test.
 *
 * ## The honest limit
 *
 * The streams behind the entry stay plaintext, which no real locked document's
 * would be. It does not matter for any caller here: `load` refuses the document
 * before pdf-lib decodes anything. The dictionary is filled in as a real one
 * would be so a test does not also depend on an empty `/Encrypt` being
 * tolerated.
 *
 * Test-support code, not shipped.
 */
export async function lockedPdfBytes(pageCount = 1): Promise<Uint8Array<ArrayBuffer>> {
  const document = await PDFDocument.create()

  for (let page = 1; page <= pageCount; page += 1) document.addPage([100, 200])

  document.context.trailerInfo.Encrypt = document.context.obj({
    Filter: 'Standard',
    V: 1,
    R: 2,
    P: -1,
  })

  return new Uint8Array(await document.save())
}

/** The same document as a `Blob`, which is what an `EngineInput` carries. */
export async function lockedPdfBlob(pageCount = 1): Promise<Blob> {
  return new Blob([await lockedPdfBytes(pageCount)], { type: 'application/pdf' })
}

/** And under a name an error message can quote. */
export async function lockedPdfFile(name: string, pageCount = 1): Promise<File> {
  return new File([await lockedPdfBytes(pageCount)], name, { type: 'application/pdf' })
}
