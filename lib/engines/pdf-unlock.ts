/**
 * Removing a PDF's password, in place, without moving a byte.
 *
 * ## Why this cannot go through pdf-lib
 *
 * `./pdf-protect` mutates a parsed document and lets pdf-lib lay the file out
 * again. Decryption cannot: pdf-lib has to *parse* the file first, and it cannot
 * parse an encrypted one. Any document written since PDF 1.5 keeps most of its
 * objects in compressed object streams, pdf-lib inflates those during parsing,
 * and inflating ciphertext fails. `ignoreEncryption` does not help — it only
 * suppresses the check, not the inflate.
 *
 * So the decryption happens on the bytes, before any parser is involved.
 *
 * ## Why the file's layout is preserved exactly
 *
 * Rewriting a PDF properly means rebuilding its cross-reference table, and
 * rebuilding *that* means knowing which objects live inside which object stream —
 * back to needing a parser. There is a way around it that needs none:
 *
 * **Decryption never produces more bytes than it consumed.** RC4 produces
 * exactly as many; AES consumes a 16-byte initialisation vector and up to 16
 * bytes of padding that the plaintext does not carry. So every object can be
 * rewritten *inside its own span*, padded back to its original length with
 * spaces — and PDF allows whitespace between tokens, after a dictionary, and
 * before `endobj`. Every byte offset in the file therefore stays valid, the
 * cross-reference table keeps pointing at the right places, and object streams
 * are never opened at all: their payload is decrypted as opaque bytes, exactly
 * like any other stream.
 *
 * The one thing that must be edited is `/Encrypt` in the trailer, and blanking
 * it with spaces is also length-preserving.
 *
 * ## Where it gives up
 *
 * A decrypted string is re-encoded in the shorter of PDF's two spellings, and in
 * rare cases that is still longer than the encrypted form it replaces — a
 * carriage-return-heavy string in an RC4 document, where the ciphertext was
 * exactly as long as the plaintext. Rather than write a file whose offsets have
 * silently shifted, the job fails and says which object could not be rewritten.
 */

import { throwIfAborted } from '@/lib/abort'

import {
  fromLatin1,
  latin1,
  type RawObject,
  scanObjects,
  scanStrings,
  writeString,
} from './pdf-raw-scan'
import { type CryptMethod, decryptValue, fileKeyFor, type SecuritySpec } from './pdf-crypt-standard'
import type { PdfOperation } from './pdflib'

/** How often the rewriting loop looks at the abort signal, in objects. */
const CANCEL_INTERVAL = 64

const SCANNED = 0.2
const REWRITTEN = 0.95

export const unlockPdf: PdfOperation = async (input, signal, onProgress) => {
  throwIfAborted(signal)
  onProgress(0)

  const source = onlyFile(input)
  const bytes = new Uint8Array(await source.arrayBuffer())
  const text = latin1(bytes)
  throwIfAborted(signal)

  const objects = scanObjects(text)
  const spec = readSecuritySpec(text, objects)
  onProgress(SCANNED)

  const fileKey = await fileKeyFor(spec, input.pdf?.unlock?.password ?? '')
  if (fileKey === null) throw wrongPassword(input.pdf?.unlock?.password)
  throwIfAborted(signal)

  let output = text
  const encryptObject = encryptionObjectNumber(text)

  for (const [index, object] of objects.entries()) {
    if (index % CANCEL_INTERVAL === 0) throwIfAborted(signal)
    if (object.number === encryptObject) continue

    output = await rewriteObject(output, object, spec, fileKey)
    onProgress(SCANNED + ((REWRITTEN - SCANNED) * (index + 1)) / objects.length)
  }

  const unlocked = fromLatin1(blankEncryptReference(output, objects))
  throwIfAborted(signal)
  onProgress(1)

  return new Blob([unlocked], { type: 'application/pdf' })
}

/**
 * Replaces one object's span with its decrypted equivalent, padded back to the
 * same length.
 *
 * The padding goes at the end of the value — before `stream`, or before
 * `endobj` — where PDF allows any amount of whitespace.
 */
async function rewriteObject(
  text: string,
  object: RawObject,
  spec: SecuritySpec,
  fileKey: Uint8Array,
): Promise<string> {
  const original = text.slice(object.start, object.end)
  const body = text.slice(object.bodyStart, object.bodyEnd)
  const decryptedBody = await decryptStrings(body, spec, fileKey, object)

  const rebuilt =
    object.stream === undefined
      ? `${text.slice(object.start, object.bodyStart)}${decryptedBody}endobj`
      : await rebuildStream(text, object, decryptedBody, spec, fileKey)

  if (rebuilt.length > original.length) {
    throw new Error(
      `Object ${object.number} of this PDF could not be rewritten without moving the rest of ` +
        'the file, so the password was not removed. Please report this file — it uses a ' +
        'combination this tool has not seen.',
    )
  }

  return text.slice(0, object.start) + pad(rebuilt, original.length) + text.slice(object.end)
}

/**
 * A stream object rebuilt around its decrypted payload, with `/Length` corrected.
 *
 * The new length is always smaller, so writing it over the old number and
 * padding with spaces keeps the dictionary the same size. An indirect `/Length`
 * is left alone: the number it points at is now too large, which readers
 * tolerate because `endstream` is authoritative, and rewriting another object
 * from inside this one would break the single-pass rewrite.
 */
async function rebuildStream(
  text: string,
  object: RawObject,
  body: string,
  spec: SecuritySpec,
  fileKey: Uint8Array,
): Promise<string> {
  const { stream } = object
  if (stream === undefined) throw new Error('not a stream')

  const payload = fromLatin1(text.slice(stream.dataStart, stream.dataEnd))
  const method = streamMethod(spec, body)
  const decrypted = await decryptValue(
    spec,
    fileKey,
    method,
    object.number,
    object.generation,
    payload,
  )

  // Everything except the dictionary and the payload is copied verbatim, down to
  // the end-of-line after `stream`. Rewriting those separators in a canonical
  // form would add a byte here and there — enough, on an RC4 document whose
  // payload does not shrink at all, to push the object past its own span.
  const header = text.slice(object.start, object.bodyStart)
  const opening = text.slice(object.bodyEnd, stream.dataStart)
  const closing = text.slice(stream.dataEnd, object.end)

  return `${header}${withLength(body, decrypted.length)}${opening}${latin1(decrypted)}${closing}`
}

/** Every string in one object's value, decrypted and written back. */
async function decryptStrings(
  body: string,
  spec: SecuritySpec,
  fileKey: Uint8Array,
  object: RawObject,
): Promise<string> {
  if (spec.stringMethod === 'identity') return body

  const strings = scanStrings(body)
  if (strings.length === 0) return body

  let out = ''
  let at = 0

  for (const found of strings) {
    const plain = await decryptValue(
      spec,
      fileKey,
      spec.stringMethod,
      object.number,
      object.generation,
      found.bytes,
    )
    out += body.slice(at, found.start) + writeString(plain)
    at = found.end
  }

  return out + body.slice(at)
}

/**
 * Which filter a stream's payload was encrypted with.
 *
 * Two exemptions, both from the specification rather than from caution: a
 * cross-reference stream is never encrypted, because a reader has to find the
 * objects before it can ask for a password; and the metadata stream is left in
 * the clear when `/EncryptMetadata` is false, which is a supported setting so
 * that search indexers can read a document's title.
 */
function streamMethod(spec: SecuritySpec, dictionary: string): CryptMethod {
  if (/\/Type[\s]*\/XRef\b/.test(dictionary)) return 'identity'
  if (!spec.encryptMetadata && /\/Type[\s]*\/Metadata\b/.test(dictionary)) return 'identity'

  return spec.streamMethod
}

/** The dictionary with `/Length` set to `length`, padded to its original width. */
function withLength(dictionary: string, length: number): string {
  return dictionary.replace(/\/Length[\s]+\d{1,10}(?![\s]*\d{1,5}[\s]+R)/, (whole) => {
    const replacement = `/Length ${length}`

    // Decryption only ever shrinks a payload, so the new number is never wider
    // than the old one. The guard is for the case that would corrupt the file
    // rather than merely mis-state it: leaving the old length is recoverable
    // because `endstream` is authoritative, overflowing the span is not.
    return replacement.length <= whole.length ? pad(replacement, whole.length) : whole
  })
}

/**
 * Reads `/Encrypt` into the shape `./pdf-crypt-standard` works from.
 *
 * A focused reader rather than a general one: the encryption dictionary holds
 * numbers, names, four strings and one nested dictionary of crypt filters, and
 * every value it can hold is fixed by the specification. Building a PDF object
 * parser to read eleven known keys would be a much larger thing to get wrong.
 */
function readSecuritySpec(text: string, objects: readonly RawObject[]): SecuritySpec {
  const dictionary = encryptionDictionary(text, objects)

  const version = number(dictionary, 'V') ?? 0
  const revision = number(dictionary, 'R') ?? 0
  if (revision < 2 || revision > 6) {
    throw new Error(
      revision === 0
        ? 'This PDF is not password-protected, so there is nothing to remove.'
        : `This PDF uses revision ${revision} of PDF encryption, which this tool does not ` +
            'know. Open it in the program that made it and save a copy without a password.',
    )
  }

  const method = cryptMethods(dictionary, version)

  return {
    revision,
    keyBytes: revision >= 5 ? 32 : Math.floor((number(dictionary, 'Length') ?? 40) / 8),
    permissions: number(dictionary, 'P') ?? 0,
    encryptMetadata: !/\/EncryptMetadata[\s]+false/.test(dictionary),
    id0: firstDocumentId(text),
    user: string(dictionary, 'U'),
    owner: string(dictionary, 'O'),
    userWrappedKey: string(dictionary, 'UE'),
    ownerWrappedKey: string(dictionary, 'OE'),
    ...method,
  }
}

/** The text of the `/Encrypt` dictionary, wherever the trailer points. */
function encryptionDictionary(text: string, objects: readonly RawObject[]): string {
  const objectNumber = encryptionObjectNumber(text)
  if (objectNumber === null) {
    throw new Error(
      'This PDF has no password on it, so there is nothing to remove. If a program is asking ' +
        'you for one, it may be asking for permission to edit rather than to open.',
    )
  }

  const object = objects.find((candidate) => candidate.number === objectNumber)
  if (object === undefined) {
    throw new Error(
      'This PDF says it is protected but its encryption settings are missing, so it cannot ' +
        'be unlocked. The file is damaged.',
    )
  }

  return text.slice(object.bodyStart, object.bodyEnd)
}

/** The object number the last `/Encrypt` reference names, or `null` for none. */
function encryptionObjectNumber(text: string): number | null {
  const matches = [...text.matchAll(/\/Encrypt[\s]+(\d{1,10})[\s]+\d{1,5}[\s]+R/g)]
  const last = matches.at(-1)

  return last === undefined ? null : Number(last[1])
}

/**
 * Blanks every `/Encrypt` reference in a trailer or cross-reference stream
 * dictionary, with spaces, so the file stays exactly as long.
 *
 * Deliberately not a global replace over the whole file: a byte pattern inside a
 * compressed stream can match, and overwriting it with spaces would corrupt a
 * page. Only the two places a reader looks for the key are touched.
 */
function blankEncryptReference(text: string, objects: readonly RawObject[]): string {
  const spans: [number, number][] = []

  for (const match of text.matchAll(/trailer[\s]*<<[\s\S]*?>>/g)) {
    spans.push([match.index, match.index + match[0].length])
  }
  for (const object of objects) {
    const dictionary = text.slice(object.bodyStart, object.bodyEnd)
    if (/\/Type[\s]*\/XRef\b/.test(dictionary)) spans.push([object.bodyStart, object.bodyEnd])
  }

  let out = text
  for (const [start, end] of spans) {
    const blanked = out
      .slice(start, end)
      .replace(/\/Encrypt[\s]+\d{1,10}[\s]+\d{1,5}[\s]+R/g, (whole) => ' '.repeat(whole.length))
    out = out.slice(0, start) + blanked + out.slice(end)
  }

  return out
}

/** `/StmF` and `/StrF` resolved through `/CF` into the two filters in force. */
function cryptMethods(
  dictionary: string,
  version: number,
): Pick<SecuritySpec, 'stringMethod' | 'streamMethod'> {
  // Before version 4 there is one algorithm and no choice about it.
  if (version < 4) return { stringMethod: 'rc4', streamMethod: 'rc4' }

  const named = (key: string): CryptMethod => {
    const filter = new RegExp(`/${key}[\\s]*/(\\w+)`).exec(dictionary)?.[1]
    if (filter === undefined || filter === 'Identity') return 'identity'

    const definition = new RegExp(`/${filter}[\\s]*<<([\\s\\S]*?)>>`).exec(dictionary)?.[1] ?? ''
    const algorithm = /\/CFM[\s]*\/(\w+)/.exec(definition)?.[1]

    if (algorithm === 'AESV3') return 'aesv3'
    if (algorithm === 'AESV2') return 'aesv2'
    if (algorithm === 'V2') return 'rc4'

    return 'identity'
  }

  return { stringMethod: named('StrF'), streamMethod: named('StmF') }
}

/**
 * The first element of the trailer's `/ID`, which revisions 2 to 4 hash into the
 * file key.
 *
 * Empty when the document has none, which is legal and means the key is derived
 * without it — the same thing the specification says.
 */
function firstDocumentId(text: string): Uint8Array<ArrayBuffer> {
  const match = /\/ID[\s]*\[[\s]*<([0-9a-fA-F\s]*)>/.exec(text)
  if (match === null) return new Uint8Array(0)

  const digits = match[1].replace(/[^0-9a-fA-F]/g, '')
  const out = new Uint8Array(Math.floor(digits.length / 2))
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16)
  }

  return out
}

function number(dictionary: string, key: string): number | null {
  const match = new RegExp(`/${key}[\\s]+(-?\\d+)`).exec(dictionary)

  return match === null ? null : Number(match[1])
}

/** A `/O`, `/U`, `/OE` or `/UE` value, in either of PDF's two string spellings. */
function string(dictionary: string, key: string): Uint8Array<ArrayBuffer> {
  const at = new RegExp(`/${key}[\\s]*(?=[(<])`).exec(dictionary)
  if (at === null) return new Uint8Array(0)

  const from = at.index + at[0].length
  const found = scanStrings(dictionary.slice(from))[0]

  return found?.bytes ?? new Uint8Array(0)
}

function pad(text: string, length: number): string {
  return text + ' '.repeat(length - text.length)
}

function wrongPassword(supplied: string | undefined): Error {
  if (supplied === undefined || supplied.length === 0) {
    return new Error(
      'This PDF needs a password to open. Type the password and try again — it never leaves ' +
        'your device.',
    )
  }

  return new Error(
    'That password does not open this PDF. Check for a different capitalisation, and note ' +
      'that the password to open a document is not always the one that lifts its ' +
      'restrictions — either will do here.',
  )
}

function onlyFile(input: { files: readonly Blob[] }): Blob {
  if (input.files.length !== 1) {
    throw new Error(
      `Removing a password works on one document at a time, but ${input.files.length} were given.`,
    )
  }

  return input.files[0]
}
