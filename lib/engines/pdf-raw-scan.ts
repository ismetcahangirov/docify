/**
 * Finding the indirect objects in a PDF's raw bytes, without parsing it.
 *
 * ## Why not pdf-lib
 *
 * Because pdf-lib cannot open the documents this is for. An encrypted PDF from
 * this century keeps most of its objects inside compressed *object streams*, and
 * pdf-lib decompresses those while parsing — on bytes that are still ciphertext.
 * It fails before `ignoreEncryption` gets a chance to matter. Probing the pinned
 * version confirms it: a document with one scrambled object stream fails to load
 * with `Cannot read properties of undefined (reading 'Pages')`.
 *
 * So decryption has to happen *before* any parser sees the file, which means
 * finding the objects in the bytes themselves. That is much less than parsing:
 * nothing here resolves a reference, follows the page tree, or looks inside an
 * object stream. It finds where each `N G obj … endobj` starts and stops, and
 * where a stream's payload sits inside that.
 *
 * ## Latin-1 as an index-preserving view
 *
 * Every byte maps to exactly one character in Latin-1 and back again, so a
 * string decoded that way can be searched with ordinary string and regular
 * expression machinery while every index still names the same byte. UTF-8 would
 * not: a multi-byte sequence collapses to one character and every index after it
 * shifts.
 *
 * ## What "without parsing" costs
 *
 * A `N G obj` pattern can occur inside a stream's compressed payload. The scan
 * defends against that by always jumping past an object's own `endobj` before
 * looking for the next one, so a false match can only be reached if the object
 * containing it was itself mis-measured. Stream payloads are measured from
 * `/Length` where it is a direct number and the bytes agree, and by searching
 * for `endstream` where it is not.
 */

/** One indirect object, as a span of bytes. */
export interface RawObject {
  number: number
  generation: number
  /** Where `N G obj` begins. */
  start: number
  /** Just past `endobj`. */
  end: number
  /** Just past `obj`: where the object's value begins. */
  bodyStart: number
  /** Where the value ends — at `stream` for a stream, at `endobj` otherwise. */
  bodyEnd: number
  /** Present only for a stream object. */
  stream?: RawStream
}

export interface RawStream {
  /** First byte of the payload, past the end-of-line after `stream`. */
  dataStart: number
  /** Just past the last payload byte, at the `endstream` keyword. */
  dataEnd: number
}

const OBJECT_HEADER = /(\d{1,10})[\s]+(\d{1,5})[\s]+obj\b/g

/**
 * The whole file as a string whose indices are byte offsets.
 *
 * Latin-1 rather than UTF-8: see the module header. Every caller that mixes text
 * searching with byte offsets has to go through this.
 */
export function latin1(bytes: Uint8Array): string {
  // Chunked because spreading a 50 MB array into `String.fromCharCode` exceeds
  // the argument limit on every engine.
  const chunks: string[] = []
  for (let at = 0; at < bytes.length; at += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + 0x8000)))
  }

  return chunks.join('')
}

/** The bytes of a Latin-1 string produced by {@link latin1}. */
export function fromLatin1(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff

  return out
}

/**
 * Every indirect object in the file, in the order they appear.
 *
 * An object whose end cannot be found is skipped rather than guessed at: a span
 * this is unsure of is one it must not rewrite, and leaving it alone costs at
 * worst one object's strings.
 */
export function scanObjects(text: string): RawObject[] {
  const objects: RawObject[] = []
  OBJECT_HEADER.lastIndex = 0

  let match = OBJECT_HEADER.exec(text)
  while (match !== null) {
    const object = readObject(text, match)
    if (object === null) {
      // Unmeasurable: step past this header and keep looking rather than
      // abandoning the rest of the file.
      OBJECT_HEADER.lastIndex = match.index + match[0].length
    } else {
      objects.push(object)
      // Past `endobj`, so a `N G obj` pattern inside the payload just read
      // cannot be mistaken for the next object.
      OBJECT_HEADER.lastIndex = object.end
    }

    match = OBJECT_HEADER.exec(text)
  }

  return objects
}

function readObject(text: string, match: RegExpExecArray): RawObject | null {
  const bodyStart = match.index + match[0].length
  const streamAt = text.indexOf('stream', bodyStart)
  const endObjAt = text.indexOf('endobj', bodyStart)

  if (endObjAt < 0) return null

  const base = {
    number: Number(match[1]),
    generation: Number(match[2]),
    start: match.index,
    bodyStart,
  }

  // `endstream` also contains "stream", so a hit that is part of one is not the
  // opening keyword; and a `stream` past `endobj` belongs to the next object.
  const opensStream =
    streamAt >= 0 && streamAt < endObjAt && !text.startsWith('endstream', streamAt - 3)
  if (!opensStream) {
    return { ...base, bodyEnd: endObjAt, end: endObjAt + 'endobj'.length }
  }

  const stream = readStream(text, bodyStart, streamAt)
  if (stream === null) return null

  const closing = text.indexOf('endobj', stream.dataEnd)
  if (closing < 0) return null

  return { ...base, bodyEnd: streamAt, end: closing + 'endobj'.length, stream }
}

/**
 * Where a stream's payload starts and stops.
 *
 * `/Length` is trusted only when the bytes agree with it — a document that has
 * been edited by hand, or written by a producer that got it wrong, is exactly
 * the kind that ends up in front of a repair tool. When they disagree, the
 * `endstream` keyword decides.
 */
function readStream(text: string, bodyStart: number, streamAt: number): RawStream | null {
  // The specification requires CRLF or LF after the keyword, never a bare CR.
  let dataStart = streamAt + 'stream'.length
  if (text.startsWith('\r\n', dataStart)) dataStart += 2
  else if (text[dataStart] === '\n') dataStart += 1

  const declared = directLength(text.slice(bodyStart, streamAt))
  if (declared !== null) {
    const at = dataStart + declared
    if (/^[\s]*endstream/.test(text.slice(at, at + 20))) return { dataStart, dataEnd: at }
  }

  const found = text.indexOf('endstream', dataStart)
  if (found < 0) return null

  // Back off the end-of-line that belongs to the keyword rather than the data.
  let dataEnd = found
  if (text.startsWith('\r\n', dataEnd - 2)) dataEnd -= 2
  else if (text[dataEnd - 1] === '\n' || text[dataEnd - 1] === '\r') dataEnd -= 1

  return { dataStart, dataEnd }
}

/** `/Length 1234` where the value is written out, or `null` for a reference. */
function directLength(dictionary: string): number | null {
  const match = /\/Length[\s]+(\d{1,10})(?![\s]+\d{1,5}[\s]+R)/.exec(dictionary)

  return match === null ? null : Number(match[1])
}

/** One string literal or hex string inside an object's value, as a span. */
export interface RawString {
  start: number
  end: number
  bytes: Uint8Array<ArrayBuffer>
}

/**
 * Every string in `text`, which must be one object's value and not a stream
 * payload.
 *
 * Both PDF spellings are recognised. A `<` that opens a dictionary is not a
 * string, and neither is a `(` inside one — literal strings nest their
 * parentheses and escape them with a backslash, and both are handled here rather
 * than by a regular expression, which cannot count.
 */
export function scanStrings(text: string): RawString[] {
  const found: RawString[] = []

  for (let at = 0; at < text.length; at += 1) {
    const character = text[at]

    if (character === '(') {
      const literal = readLiteral(text, at)
      if (literal === null) return found

      found.push(literal)
      at = literal.end - 1
      continue
    }

    if (character === '<') {
      // `<<` opens a dictionary. Both characters have to be stepped over, or the
      // second one reads as a hex string that swallows the dictionary's contents.
      if (text[at + 1] === '<') {
        at += 1
        continue
      }

      const closing = text.indexOf('>', at)
      if (closing < 0) return found

      found.push({ start: at, end: closing + 1, bytes: fromHex(text.slice(at + 1, closing)) })
      at = closing
    }
  }

  return found
}

function readLiteral(text: string, start: number): RawString | null {
  const bytes: number[] = []
  let depth = 0

  for (let at = start; at < text.length; at += 1) {
    const character = text[at]

    if (character === '\\') {
      const escaped = text[at + 1]
      at += 1
      if (escaped === undefined) return null

      const octal = /^[0-7]{1,3}/.exec(text.slice(at, at + 3))
      if (octal !== null) {
        bytes.push(Number.parseInt(octal[0], 8) & 0xff)
        at += octal[0].length - 1
        continue
      }

      const simple: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 }
      // A backslash before a newline is a line continuation and contributes
      // nothing; anything else stands for itself.
      if (escaped === '\n') continue
      bytes.push(simple[escaped] ?? escaped.charCodeAt(0))
      continue
    }

    if (character === '(') {
      depth += 1
      if (depth > 1) bytes.push(0x28)
      continue
    }

    if (character === ')') {
      depth -= 1
      if (depth === 0) return { start, end: at + 1, bytes: new Uint8Array(bytes) }
      bytes.push(0x29)
      continue
    }

    bytes.push(character.charCodeAt(0) & 0xff)
  }

  return null
}

function fromHex(text: string): Uint8Array<ArrayBuffer> {
  const digits = text.replace(/[^0-9a-fA-F]/g, '')
  const padded = digits.length % 2 === 0 ? digits : `${digits}0`
  const out = new Uint8Array(padded.length / 2)

  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(padded.slice(index * 2, index * 2 + 2), 16)
  }

  return out
}

/**
 * A string written back in the shorter of PDF's two spellings.
 *
 * Which one matters because the rewrite has to fit inside the span the encrypted
 * string occupied — see `./pdf-unlock`. Hex costs two characters per byte and
 * literal costs one, plus an escape for each of the four characters that cannot
 * appear raw, so text is far shorter as a literal and random bytes are shorter
 * as hex.
 */
export function writeString(bytes: Uint8Array): string {
  const literal = writeLiteral(bytes)

  return literal.length <= 2 * bytes.length + 2 ? literal : writeHex(bytes)
}

function writeLiteral(bytes: Uint8Array): string {
  let out = '('

  for (const byte of bytes) {
    // A raw carriage return in a literal string is normalised to a line feed by
    // readers, so it has to be escaped to survive; `(`, `)` and `\` would change
    // the parse.
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`
    else if (byte === 0x0d) out += '\\r'
    else out += String.fromCharCode(byte)
  }

  return `${out})`
}

function writeHex(bytes: Uint8Array): string {
  return `<${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}>`
}
