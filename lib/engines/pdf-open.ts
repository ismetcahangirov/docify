/**
 * Opening a PDF with pdf-lib, and explaining it when that fails.
 *
 * ## Why loading needs a helper at all
 *
 * `PDFDocument.load` is lenient. Handed bytes with no usable catalog it resolves
 * happily and defers the failure to the first structural read, which then
 * surfaces as a bare `Cannot read properties of undefined (reading 'Pages')` —
 * thrown from inside pdf-lib, long after the call the user could be told about.
 * "Can this file be opened at all" is therefore only an answered question once
 * something has touched the page tree, so the load and that first read have to
 * sit inside one `try`. Every operation needs exactly that, and each one had
 * written its own copy of it.
 *
 * ## Why the read is the caller's
 *
 * The three operations reach for different things first: split and organize want
 * the page count, merge wants the pages themselves copied into the document it
 * is building. Making the helper choose would either force merge to parse the
 * page tree twice or force split to hold a copy it never wanted, so the caller
 * passes the read in and the guard closes around it.
 *
 * ## Why the wording is the caller's too
 *
 * CLAUDE.md §2.5 asks an error to name a next step, and the next step depends on
 * the job: a locked file in a merge list can be removed from the list, while a
 * locked file in a split is the whole job. A shared sentence would have to be
 * vague enough to fit all three, which is the failure mode the rule exists to
 * prevent.
 *
 * ## Loading
 *
 * pdf-lib is imported statically here and this module is reached only from the
 * operation modules, which `./pdflib` reaches only through `await import()`. It
 * therefore stays out of the initial bundle (CLAUDE.md §2.3).
 */

import { EncryptedPDFError, type LoadOptions, PDFDocument } from 'pdf-lib'

export interface PdfOpenOptions<T> {
  /** Handed straight to `PDFDocument.load`. */
  load?: LoadOptions

  /**
   * The first structural read, run inside the guard. Whatever it returns is
   * what `openPdf` resolves to.
   */
  read: (source: PDFDocument) => T | PromiseLike<T>

  /**
   * What to say when the document is encrypted. pdf-lib cannot decrypt, so this
   * is a dead end rather than a parse failure, and the two want different advice.
   */
  encrypted: string

  /**
   * What to say when the document could not be parsed. `detail` is pdf-lib's
   * own message, which the caller may keep or drop: alone it explains nothing,
   * but it is what distinguishes a truncated download from a file that was
   * never a PDF.
   */
  damaged: (detail: string) => string
}

/**
 * Parses `bytes`, performs the caller's first structural read, and turns any
 * failure in either into a sentence the user can act on.
 */
export async function openPdf<T>(bytes: Uint8Array, options: PdfOpenOptions<T>): Promise<T> {
  try {
    // `ignoreEncryption` is left to the caller and defaults to off: pdf-lib
    // cannot decrypt, and ignoring the flag would read unreadable streams into
    // a document that opens as noise.
    // `await` on the read is load-bearing, not stylistic: without it a read that
    // rejects rather than throws — merge's `copyPages` — settles outside this
    // guard and reaches the user as pdf-lib's own words.
    return await options.read(await PDFDocument.load(bytes, options.load))
  } catch (reason) {
    // A cancel is not a verdict on the file. The read is the caller's, and a
    // caller that checks its signal in there throws from inside this guard, so
    // without this line pressing cancel would tell the user their PDF is
    // damaged — a report that gets debugged as an engine fault rather than as
    // the guard overreaching.
    if (isAbort(reason)) throw reason

    const detail = reason instanceof Error ? reason.message : String(reason)

    // The type is the reliable signal and the text is the fallback: pdf-lib
    // raises `EncryptedPDFError` from `load`, but an encrypted document can
    // also fail further in, where all that survives is the message.
    if (reason instanceof EncryptedPDFError || /encrypt/i.test(detail)) {
      throw new Error(options.encrypted)
    }

    throw new Error(options.damaged(detail))
  }
}

/**
 * Whether a failure is a cancellation rather than something about the document.
 *
 * The name is the check and the type deliberately is not. The engines throw
 * `DOMException`, but `lib/worker/errors.ts` throws a plain `Error` subclass
 * named `AbortError` because a `DOMException` does not survive Comlink's error
 * path — so `instanceof DOMException` would recognise one caller's cancel and
 * translate the other's into "your file is damaged". `AbortSignal.reason` is
 * also whatever the aborting code passed, which need not be an `Error` at all.
 */
function isAbort(reason: unknown): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    (reason as { name?: unknown }).name === 'AbortError'
  )
}
