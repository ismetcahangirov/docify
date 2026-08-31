/**
 * Key derivation for revisions 2, 3 and 4 of PDF's standard security handler —
 * everything Acrobat produced before 2011.
 *
 * Read-only by design. `./pdf-protect` writes revision 6 and never comes here;
 * this exists so that a file somebody was given in 2008 can still be opened.
 * The algorithms are ISO 32000-1 §7.6.3.3 and §7.6.3.4, and they are quoted by
 * their numbers below because the specification is the only readable
 * explanation of why any of these steps exist.
 *
 * Two properties of the design are worth knowing before reading it:
 *
 * - **The owner password opens the file through the user password.** There is
 *   no separate owner key. `/O` holds the user password encrypted under a key
 *   derived from the owner password, so an owner password is checked by
 *   recovering the user password from it and then checking *that*.
 * - **A 40-bit option existed and was the default.** Revision 2 fixes the key at
 *   five bytes. Nothing here can make that safe; it can only read it.
 */

import { md5 } from './pdf-crypt-md5'
import { rc4 } from './pdf-crypt-rc4'

/**
 * The 32-byte string every password is padded with, from ISO 32000-1 table 20.
 *
 * A password shorter than 32 bytes is topped up from the front of this; an empty
 * password *is* this. That last case is the common one in practice — a document
 * with owner-only restrictions has no user password at all.
 */
const PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
])

/** Revision 3 and later iterate the digest this many times, per algorithm 2 step (h). */
const REHASH_ROUNDS = 50

/** The 20-key ladder revisions 3 and later use for `/U` and `/O`, step (e). */
const LADDER_ROUNDS = 20

/** What algorithm 2 needs beyond the password itself. */
export interface LegacyInputs {
  revision: number
  /** File key length in bytes: 5 for revision 2, up to 16 after it. */
  keyBytes: number
  /** `/O`, 32 bytes. */
  owner: Uint8Array
  /** `/U`, 32 bytes. */
  user: Uint8Array
  /** `/P`, as the signed 32-bit integer the file declares. */
  permissions: number
  /** The first element of the trailer's `/ID`. Empty where the file has none. */
  id0: Uint8Array
  /** `/EncryptMetadata`. Revision 4 folds it into the key; earlier ones do not. */
  encryptMetadata: boolean
}

/**
 * The file encryption key for `password`, or `null` if it is neither the user
 * nor the owner password.
 *
 * Tries the user password first because it is the one people are given, then the
 * owner password — which is how a document with restrictions but no open
 * password is unlocked, and the case that brings most people to a tool like this
 * one.
 */
export function legacyFileKey(inputs: LegacyInputs, password: Uint8Array): Uint8Array | null {
  const asUser = userKey(inputs, password)
  if (validatesAsUser(inputs, asUser)) return asUser

  const recovered = userPasswordFromOwner(inputs, password)
  const asOwner = userKey(inputs, recovered)

  return validatesAsUser(inputs, asOwner) ? asOwner : null
}

/**
 * Algorithm 2: the file key a user password derives.
 *
 * The permissions and the document id go into the hash, which is what ties a key
 * to one particular file — copying `/U` out of another document does not
 * transplant its password.
 */
function userKey(inputs: LegacyInputs, password: Uint8Array): Uint8Array {
  const { revision, keyBytes, owner, permissions, id0, encryptMetadata } = inputs

  const parts = [padded(password), owner.subarray(0, 32), littleEndian(permissions), id0]
  // Revision 4 with unencrypted metadata appends four 0xFF bytes, so that
  // turning that switch off changes the key rather than silently leaving
  // documents interchangeable.
  if (revision >= 4 && !encryptMetadata) parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]))

  let digest = md5(concat(parts))

  if (revision >= 3) {
    for (let round = 0; round < REHASH_ROUNDS; round += 1) {
      digest = md5(digest.subarray(0, keyBytes))
    }
  }

  return digest.subarray(0, keyBytes)
}

/**
 * Algorithms 4 and 5: whether `key` really is this document's file key.
 *
 * The check is on `/U`, which holds a known plaintext encrypted under the key —
 * the padding string for revision 2, and a hash of the padding string and the
 * document id for later revisions. Only the first sixteen bytes of `/U` are
 * compared after revision 2: the rest is arbitrary padding that producers fill
 * differently.
 */
function validatesAsUser(inputs: LegacyInputs, key: Uint8Array): boolean {
  const { revision, user } = inputs

  if (revision === 2) return same(rc4(key, PADDING), user.subarray(0, 32), 32)

  let value = md5(concat([PADDING, inputs.id0]))
  value = rc4(key, value)
  for (let round = 1; round < LADDER_ROUNDS; round += 1) {
    value = rc4(shiftedKey(key, round), value)
  }

  return same(value, user.subarray(0, 16), 16)
}

/**
 * Algorithm 7: the user password hidden inside `/O`, recovered with the owner
 * password.
 *
 * Returns the padded user password, which {@link userKey} then treats like any
 * other. A wrong owner password produces 32 bytes of noise here rather than an
 * error — the failure surfaces one step later, when that noise does not validate.
 */
function userPasswordFromOwner(inputs: LegacyInputs, password: Uint8Array): Uint8Array {
  const { revision, keyBytes, owner } = inputs

  let digest = md5(padded(password))
  if (revision >= 3) {
    for (let round = 0; round < REHASH_ROUNDS; round += 1) digest = md5(digest)
  }

  const key = digest.subarray(0, keyBytes)
  if (revision === 2) return rc4(key, owner.subarray(0, 32))

  // The ladder runs backwards for decryption: 19 down to 0.
  let value: Uint8Array = owner.subarray(0, 32)
  for (let round = LADDER_ROUNDS - 1; round >= 0; round -= 1) {
    value = rc4(shiftedKey(key, round), value)
  }

  return value
}

/** The file key with every byte XORed by the round number, per step (e). */
function shiftedKey(key: Uint8Array, round: number): Uint8Array<ArrayBuffer> {
  const shifted = new Uint8Array(key.length)
  for (let index = 0; index < key.length; index += 1) shifted[index] = key[index] ^ round

  return shifted
}

/** The password truncated to 32 bytes, or topped up from {@link PADDING}. */
function padded(password: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(32)
  const kept = Math.min(password.length, 32)
  out.set(password.subarray(0, kept))
  out.set(PADDING.subarray(0, 32 - kept), kept)

  return out
}

/** `/P` as the four little-endian bytes the hash consumes. */
function littleEndian(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setInt32(0, value | 0, true)

  return out
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)

  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }

  return out
}

function same(a: Uint8Array, b: Uint8Array, length: number): boolean {
  if (a.length < length || b.length < length) return false

  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return false
  }

  return true
}
