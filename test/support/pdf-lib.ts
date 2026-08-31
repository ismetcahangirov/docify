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
