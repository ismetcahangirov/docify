/**
 * Adding a password to a PDF: AES-256, revision 6, and nothing older.
 *
 * ## Why only one scheme
 *
 * PDF's standard security handler has four live revisions and this writes
 * exactly one of them. `./pdf-crypt-legacy` can *read* the others because files
 * from 2008 exist; producing a new document with 40-bit RC4 — or with 128-bit
 * RC4, or with the MD5-derived AES-128 of revision 4 — would be handing someone a
 * file that looks protected and is not. Revision 6 is what Acrobat, LibreOffice
 * and every current library write, and every reader from Acrobat X onwards opens
 * it.
 *
 * ## Why pdf-lib serialises it
 *
 * Encryption changes the length of every string and stream, so the file's byte
 * offsets all move and the cross-reference table has to be rebuilt. pdf-lib
 * already does that on every save. The work here is therefore to mutate the
 * object graph *before* the save — encrypt each value in place — and hand the
 * writer a document it will lay out correctly on its own. `./pdf-unlock` cannot
 * take the same route, and its module header says why.
 *
 * `useObjectStreams: false` is load-bearing rather than a preference: an object
 * stream would take the values we have just encrypted and compress them into a
 * single stream, which a reader would then decrypt once and find full of
 * ciphertext.
 */

import {
  PDFArray,
  type PDFContext,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
} from 'pdf-lib'

import { throwIfAborted } from '@/lib/abort'

import { openPdf } from './pdf-open'
import type { PdfOperation } from './pdflib'
import { randomBytes } from './pdf-crypt-aes'
import { buildPasswordEntry, buildPerms, newFileKey } from './pdf-crypt-r6'
import { encryptValue, type SecuritySpec } from './pdf-crypt-standard'

/**
 * The permission bits written into every protected document: everything
 * allowed.
 *
 * `0xFFFFFFFC` — every bit set except the two the specification reserves as
 * zero. This tool exists so that a file needs a password to *open*, which is a
 * confidentiality question; the permission bits are a different thing entirely,
 * are advisory, and are honoured only by readers that choose to. Offering them
 * as a feature would be selling a lock that every reader is free to ignore.
 */
const ALL_PERMISSIONS = -4

/** How often the encryption loop looks at the abort signal, in objects. */
const CANCEL_INTERVAL = 64

const PARSED = 0.15
const ENCRYPTED = 0.85

export const protectPdf: PdfOperation = async (input, signal, onProgress) => {
  throwIfAborted(signal)
  onProgress(0)

  const source = onlyFile(input)
  const password = requiredPassword(input.pdf?.protect?.password)
  const ownerPassword = input.pdf?.protect?.ownerPassword ?? password
  const bytes = new Uint8Array(await source.arrayBuffer())
  throwIfAborted(signal)

  const document = await openPdf(bytes, {
    read: (parsed) => {
      // Touches the page tree, which is what turns "pdf-lib resolved" into "this
      // file is really a PDF" — see `./pdf-open` for why the two differ.
      parsed.getPageCount()

      return parsed
    },
    encrypted:
      'This PDF already has a password. Remove the existing one first, then add the new ' +
      'password to the unlocked file.',
    damaged: (detail) =>
      `This PDF could not be opened, so it cannot be protected (${detail}). If it was ` +
      'downloaded, check that the download completed.',
  })
  onProgress(PARSED)

  const { spec, fileKey } = await buildSecurity(password, ownerPassword)
  throwIfAborted(signal)

  const { context } = document
  const objects = context.enumerateIndirectObjects()

  for (const [index, [ref, object]] of objects.entries()) {
    if (index % CANCEL_INTERVAL === 0) throwIfAborted(signal)

    await encryptObject(context, ref, object, spec, fileKey)
    onProgress(PARSED + ((ENCRYPTED - PARSED) * (index + 1)) / objects.length)
  }

  // After the walk, deliberately: neither the encryption dictionary nor the
  // document id may itself be encrypted, and the simplest way to guarantee that
  // is for neither to exist while the walk is running.
  context.trailerInfo.Encrypt = context.register(await encryptionDictionary(context, spec, fileKey))
  context.trailerInfo.ID = context.obj([documentId(), documentId()])

  const saved = await document.save({ useObjectStreams: false })
  throwIfAborted(signal)
  onProgress(1)

  return new Blob([saved as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}

/** A fresh file key, and the `/U`, `/O`, `/UE` and `/OE` values that wrap it. */
async function buildSecurity(
  password: string,
  ownerPassword: string,
): Promise<{ spec: SecuritySpec; fileKey: Uint8Array }> {
  const fileKey = newFileKey()
  const encoder = new TextEncoder()

  const user = await buildPasswordEntry(encoder.encode(password), fileKey, new Uint8Array(0))
  // The owner entry hashes the finished `/U` alongside its own password, which
  // is what binds the two to one document.
  const owner = await buildPasswordEntry(encoder.encode(ownerPassword), fileKey, user.value)

  return {
    fileKey,
    spec: {
      revision: 6,
      keyBytes: 32,
      permissions: ALL_PERMISSIONS,
      encryptMetadata: true,
      id0: new Uint8Array(0),
      user: user.value,
      owner: owner.value,
      userWrappedKey: user.wrappedKey,
      ownerWrappedKey: owner.wrappedKey,
      stringMethod: 'aesv3',
      streamMethod: 'aesv3',
    },
  }
}

/** The `/Encrypt` dictionary a reader needs in order to ask for the password. */
async function encryptionDictionary(
  context: PDFContext,
  spec: SecuritySpec,
  fileKey: Uint8Array,
): Promise<PDFDict> {
  return context.obj({
    Filter: PDFName.of('Standard'),
    V: 5,
    R: spec.revision,
    // In bits, and the one number in this dictionary that is decorative: from
    // revision 5 the key is 256 bits by definition and readers ignore it.
    Length: 256,
    P: spec.permissions,
    O: hexString(spec.owner),
    U: hexString(spec.user),
    OE: hexString(spec.ownerWrappedKey),
    UE: hexString(spec.userWrappedKey),
    Perms: hexString(await buildPerms(fileKey, spec.permissions, spec.encryptMetadata)),
    CF: {
      StdCF: { CFM: PDFName.of('AESV3'), AuthEvent: PDFName.of('DocOpen'), Length: 32 },
    },
    StmF: PDFName.of('StdCF'),
    StrF: PDFName.of('StdCF'),
    EncryptMetadata: spec.encryptMetadata,
  })
}

/**
 * Encrypts every string and stream reachable *directly* from one indirect
 * object.
 *
 * References are not followed: every object is visited from the top level
 * anyway, so following them would encrypt shared values twice — and a PDF's
 * object graph has cycles, so it would also not terminate.
 */
async function encryptObject(
  context: PDFContext,
  ref: PDFRef,
  object: unknown,
  spec: SecuritySpec,
  fileKey: Uint8Array,
): Promise<void> {
  const number = ref.objectNumber
  const generation = ref.generationNumber

  if (object instanceof PDFRawStream) {
    await encryptContainer(object.dict, spec, fileKey, number, generation)
    const encrypted = await encryptValue(
      spec,
      fileKey,
      spec.streamMethod,
      number,
      generation,
      object.contents,
    )
    // A fresh stream rather than an assignment: pdf-lib declares `contents` as
    // read-only, and replacing the object is what its own API is for. `/Length`
    // is recomputed by the writer from the new contents.
    context.assign(ref, PDFRawStream.of(object.dict, new Uint8Array(encrypted)))

    return
  }

  if (object instanceof PDFDict || object instanceof PDFArray) {
    await encryptContainer(object, spec, fileKey, number, generation)
  }
}

/** Walks a dictionary or array, replacing every string it holds. */
async function encryptContainer(
  container: PDFDict | PDFArray,
  spec: SecuritySpec,
  fileKey: Uint8Array,
  number: number,
  generation: number,
): Promise<void> {
  const entries: [PDFName | number, unknown][] =
    container instanceof PDFDict
      ? container.entries()
      : container.asArray().map((value, index) => [index, value])

  for (const [key, value] of entries) {
    if (value instanceof PDFString || value instanceof PDFHexString) {
      const encrypted = await encryptValue(
        spec,
        fileKey,
        spec.stringMethod,
        number,
        generation,
        value.asBytes(),
      )
      // Always hex on the way out. A literal string would have to escape the
      // parentheses, backslashes and carriage returns that ciphertext is full
      // of, and every producer writes encrypted strings as hex for that reason.
      setEntry(container, key, hexString(encrypted))

      continue
    }

    if (value instanceof PDFDict || value instanceof PDFArray) {
      await encryptContainer(value, spec, fileKey, number, generation)
    }
  }
}

function setEntry(container: PDFDict | PDFArray, key: PDFName | number, value: PDFHexString): void {
  if (container instanceof PDFDict) {
    container.set(key as PDFName, value)

    return
  }

  container.set(key as number, value)
}

/**
 * A document identifier: sixteen random bytes, written twice.
 *
 * The two halves are the file's original and current identities, equal for a
 * document nobody has updated incrementally. Readers use it to recognise a file
 * across saves, and revision 6 — unlike the revisions before it — does not feed
 * it into the key, so a fresh one costs nothing.
 */
function documentId(): PDFHexString {
  return hexString(randomBytes(16))
}

function hexString(bytes: Uint8Array): PDFHexString {
  return PDFHexString.of([...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''))
}

function requiredPassword(password: string | undefined): string {
  if (password === undefined || password.length === 0) {
    throw new Error(
      'Protecting a PDF needs a password. Type the password the document should ask for ' +
        'when it is opened.',
    )
  }

  return password
}

function onlyFile(input: { files: readonly Blob[] }): Blob {
  if (input.files.length !== 1) {
    throw new Error(
      `Adding a password works on one document at a time, but ${input.files.length} were given.`,
    )
  }

  return input.files[0]
}
