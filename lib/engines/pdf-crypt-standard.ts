/**
 * The standard security handler, as one interface over four revisions.
 *
 * `./pdf-crypt-legacy` and `./pdf-crypt-r6` hold the two key-derivation designs;
 * this module is what the operations talk to. It answers two questions and
 * nothing else: *does this password open the document*, and *what are the real
 * bytes of this string or stream*.
 *
 * ## Why the per-object key exists, and why it stopped
 *
 * Revisions 2 to 4 encrypt every object under a key derived from the file key
 * *and the object's own number*, so that identical values in different objects do
 * not encrypt identically. Revision 6 achieves the same thing properly, with a
 * random initialisation vector per value, and uses the file key directly. The
 * `objectKey` branch below is therefore dead for anything this project writes and
 * live for everything it reads.
 *
 * ## Two crypt filters, not one
 *
 * From revision 4 a document may encrypt strings and streams differently, and
 * may exempt either entirely (`/Identity`). The pair is carried through every
 * call rather than collapsed, because a document that does exactly that is not
 * exotic: leaving the metadata stream in the clear so a search indexer can read
 * it is a supported configuration.
 */

import { aesDecryptContent, aesEncryptContent } from './pdf-crypt-aes'
import { legacyFileKey } from './pdf-crypt-legacy'
import { md5 } from './pdf-crypt-md5'
import { r6FileKey } from './pdf-crypt-r6'
import { rc4 } from './pdf-crypt-rc4'

/**
 * How one class of value is encrypted.
 *
 * `identity` means "not encrypted at all", which is a real setting and not an
 * absence: `/StmF /Identity` leaves every stream in the clear while strings stay
 * encrypted.
 */
export type CryptMethod = 'identity' | 'rc4' | 'aesv2' | 'aesv3'

/** Everything the handler needs, read from `/Encrypt` or built to write one. */
export interface SecuritySpec {
  /** `/R`. 2, 3 and 4 take the legacy path; 5 and 6 take the AES-256 one. */
  revision: number
  /** File key length in bytes. Ignored from revision 5, where it is always 32. */
  keyBytes: number
  /** `/P`, as the signed 32-bit integer the file declares. */
  permissions: number
  encryptMetadata: boolean
  /** The first element of the trailer's `/ID`, which revisions 2 to 4 hash. */
  id0: Uint8Array
  /** `/U`: 32 bytes before revision 5, 48 from it. */
  user: Uint8Array
  /** `/O`, on the same terms. */
  owner: Uint8Array
  /** `/UE`. Revision 5 and later only. */
  userWrappedKey: Uint8Array
  /** `/OE`. Revision 5 and later only. */
  ownerWrappedKey: Uint8Array
  stringMethod: CryptMethod
  streamMethod: CryptMethod
}

/** The `sAlT` suffix revision 4's AES key derivation appends, table 21. */
const AES_SALT = new Uint8Array([0x73, 0x41, 0x6c, 0x54])

/**
 * The file encryption key `password` opens this document with, or `null` when it
 * opens nothing.
 *
 * `null` is the answer for a wrong password and is not an error: it is the
 * commonest thing that happens to a person unlocking a PDF, and the caller turns
 * it into a sentence that says which document and offers the next step.
 */
export async function fileKeyFor(spec: SecuritySpec, password: string): Promise<Uint8Array | null> {
  if (spec.revision >= 5) {
    return r6FileKey(
      {
        revision: spec.revision,
        user: spec.user,
        userWrappedKey: spec.userWrappedKey,
        owner: spec.owner,
        ownerWrappedKey: spec.ownerWrappedKey,
      },
      utf8(password),
    )
  }

  return legacyFileKey(
    {
      revision: spec.revision,
      keyBytes: spec.keyBytes,
      owner: spec.owner,
      user: spec.user,
      permissions: spec.permissions,
      id0: spec.id0,
      encryptMetadata: spec.encryptMetadata,
    },
    latin1(password),
  )
}

/** The plaintext of one encrypted string or stream. */
export async function decryptValue(
  spec: SecuritySpec,
  fileKey: Uint8Array,
  method: CryptMethod,
  objectNumber: number,
  generation: number,
  data: Uint8Array,
): Promise<Uint8Array> {
  if (method === 'identity') return data

  const key = objectKey(spec, fileKey, method, objectNumber, generation)

  return method === 'rc4' ? rc4(key, data) : aesDecryptContent(key, data)
}

/** The ciphertext of one string or stream, as it should appear in the file. */
export async function encryptValue(
  spec: SecuritySpec,
  fileKey: Uint8Array,
  method: CryptMethod,
  objectNumber: number,
  generation: number,
  data: Uint8Array,
): Promise<Uint8Array> {
  if (method === 'identity') return data

  const key = objectKey(spec, fileKey, method, objectNumber, generation)

  return method === 'rc4' ? rc4(key, data) : aesEncryptContent(key, data)
}

/**
 * The key one object's values are encrypted under.
 *
 * The file key itself from revision 5. Before that, algorithm 1: hash the file
 * key with the object and generation numbers — three little-endian bytes and two
 * — plus a fixed salt for AES, and keep at most sixteen bytes.
 */
export function objectKey(
  spec: SecuritySpec,
  fileKey: Uint8Array,
  method: CryptMethod,
  objectNumber: number,
  generation: number,
): Uint8Array {
  if (spec.revision >= 5) return fileKey

  const extra = method === 'aesv2' ? AES_SALT.length : 0
  const material = new Uint8Array(fileKey.length + 5 + extra)
  material.set(fileKey)
  material.set(
    [
      objectNumber & 0xff,
      (objectNumber >> 8) & 0xff,
      (objectNumber >> 16) & 0xff,
      generation & 0xff,
      (generation >> 8) & 0xff,
    ],
    fileKey.length,
  )
  if (extra > 0) material.set(AES_SALT, fileKey.length + 5)

  return md5(material).subarray(0, Math.min(fileKey.length + 5, 16))
}

/**
 * Passwords before revision 5 are bytes in the document's own encoding, which
 * for everything a browser can type is Latin-1.
 *
 * A character outside it had no defined representation in those revisions, so a
 * password containing one could never have been set by a conforming producer;
 * the low byte is as close to a right answer as exists.
 */
function latin1(password: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(password.length)
  for (let index = 0; index < password.length; index += 1) {
    out[index] = password.charCodeAt(index) & 0xff
  }

  return out
}

/**
 * From revision 5 a password is UTF-8, truncated to 127 bytes.
 *
 * The specification also asks for SASLprep normalisation, which matters only for
 * passwords carrying combining marks or unusual spaces. Skipping it can refuse a
 * correct password in that case and can never accept a wrong one, which is the
 * safe direction for the one to get wrong.
 */
function utf8(password: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(password).slice(0, 127)
}
