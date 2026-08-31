/**
 * Revision 6 of PDF's standard security handler: AES-256, SHA-2 key derivation,
 * and the only scheme this project will *write*.
 *
 * ISO 32000-2 §7.6.4.3. It replaced the MD5-and-RC4 design in `./pdf-crypt-legacy`
 * for the obvious reasons, and one structural improvement matters to the code
 * here: the file encryption key is random and independent of the password. The
 * password unlocks a wrapped copy of it (`/UE`, `/OE`) rather than *being* it,
 * which is why an owner and a user password can open the same document without
 * either being derivable from the other — and why the per-object key derivation
 * of the older revisions is gone. Every object is encrypted with the file key
 * itself.
 *
 * ## Algorithm 2.B, the deliberately slow hash
 *
 * The password hash is not one SHA-256. It is at least 64 rounds of "build a
 * megabyte-ish buffer, AES it, hash it with whichever SHA-2 the ciphertext
 * selects", terminating on a condition read out of the last byte of that
 * ciphertext. The data-dependent choice of digest and the data-dependent
 * termination are the point: they make the work irreducible, so a password
 * guess costs an attacker what it costs us.
 */

import { aesDecryptNoPad, aesEncryptNoPad, randomBytes, sha } from './pdf-crypt-aes'

/** Salts and the wrapped key are all this size; the specification fixes each. */
const SALT_BYTES = 8
const HASH_BYTES = 32
const FILE_KEY_BYTES = 32
const ZERO_IV = new Uint8Array(16)

/** Rounds 0..63 always run; after that the last ciphertext byte decides. */
const MINIMUM_ROUNDS = 64

/** `/U` and `/O` as revision 6 lays them out: hash, validation salt, key salt. */
export interface PasswordEntry {
  /** The full 48 bytes, as they appear in the file. */
  value: Uint8Array
  hash: Uint8Array
  validationSalt: Uint8Array
  keySalt: Uint8Array
}

/** Splits a 48-byte `/U` or `/O` into its three parts. */
export function passwordEntry(value: Uint8Array): PasswordEntry {
  return {
    value,
    hash: value.subarray(0, HASH_BYTES),
    validationSalt: value.subarray(HASH_BYTES, HASH_BYTES + SALT_BYTES),
    keySalt: value.subarray(HASH_BYTES + SALT_BYTES, HASH_BYTES + 2 * SALT_BYTES),
  }
}

/** What revision 6 needs from the `/Encrypt` dictionary to check a password. */
export interface R6Inputs {
  revision: number
  /** `/U`, 48 bytes. */
  user: Uint8Array
  /** `/UE`, 32 bytes: the file key wrapped under the user password. */
  userWrappedKey: Uint8Array
  /** `/O`, 48 bytes. */
  owner: Uint8Array
  /** `/OE`, 32 bytes: the file key wrapped under the owner password. */
  ownerWrappedKey: Uint8Array
}

/**
 * The file encryption key `password` unwraps, or `null` when it is neither
 * password.
 *
 * The user password is tried first, as in the legacy handler and for the same
 * reason: it is the one people are given.
 */
export async function r6FileKey(
  inputs: R6Inputs,
  password: Uint8Array,
): Promise<Uint8Array | null> {
  const user = passwordEntry(inputs.user)
  const owner = passwordEntry(inputs.owner)

  if (await matches(inputs.revision, password, user.validationSalt, empty(), user.hash)) {
    return unwrap(inputs.revision, password, user.keySalt, empty(), inputs.userWrappedKey)
  }

  // The owner check hashes the whole of `/U` alongside the password, which is
  // what binds an owner password to this document's user password rather than to
  // the document at large.
  if (await matches(inputs.revision, password, owner.validationSalt, user.value, owner.hash)) {
    return unwrap(inputs.revision, password, owner.keySalt, user.value, inputs.ownerWrappedKey)
  }

  return null
}

/** A fresh, random file encryption key. Never derived from the password. */
export function newFileKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(FILE_KEY_BYTES)
}

/**
 * Builds the `/U` and `/UE` pair for a user password, or the `/O` and `/OE` pair
 * for an owner password.
 *
 * The two differ only in `userValue`: empty for the user entry, and the finished
 * 48-byte `/U` for the owner entry. That is the whole of the asymmetry between
 * them in this revision.
 */
export async function buildPasswordEntry(
  password: Uint8Array,
  fileKey: Uint8Array,
  userValue: Uint8Array,
): Promise<{ value: Uint8Array<ArrayBuffer>; wrappedKey: Uint8Array<ArrayBuffer> }> {
  const validationSalt = randomBytes(SALT_BYTES)
  const keySalt = randomBytes(SALT_BYTES)

  const hash = await hash2B(password, validationSalt, userValue)
  const value = new Uint8Array(HASH_BYTES + 2 * SALT_BYTES)
  value.set(hash)
  value.set(validationSalt, HASH_BYTES)
  value.set(keySalt, HASH_BYTES + SALT_BYTES)

  const wrapping = await hash2B(password, keySalt, userValue)

  return { value, wrappedKey: await aesEncryptNoPad(wrapping, ZERO_IV, fileKey) }
}

/**
 * `/Perms`: the permission bits, encrypted with the file key, so that a reader
 * can tell an edited `/P` from an authentic one.
 *
 * A single block under a zero initialisation vector, which is AES-ECB by another
 * name — the specification's own wording, and the one place in PDF where a mode
 * without chaining is correct, because there is exactly one block.
 */
export async function buildPerms(
  fileKey: Uint8Array,
  permissions: number,
  encryptMetadata: boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  const block = new Uint8Array(16)
  new DataView(block.buffer).setInt32(0, permissions | 0, true)
  block.set([0xff, 0xff, 0xff, 0xff], 4)
  block[8] = encryptMetadata ? 0x54 : 0x46 // 'T' or 'F'
  block.set([0x61, 0x64, 0x62], 9) // 'adb', the specification's own marker
  block.set(randomBytes(4), 12)

  return aesEncryptNoPad(fileKey, ZERO_IV, block)
}

async function matches(
  revision: number,
  password: Uint8Array,
  salt: Uint8Array,
  userValue: Uint8Array,
  expected: Uint8Array,
): Promise<boolean> {
  const computed = await hash2B(password, salt, userValue, revision)

  let difference = 0
  for (let index = 0; index < HASH_BYTES; index += 1) {
    difference |= computed[index] ^ expected[index]
  }

  return difference === 0
}

async function unwrap(
  revision: number,
  password: Uint8Array,
  keySalt: Uint8Array,
  userValue: Uint8Array,
  wrappedKey: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const wrapping = await hash2B(password, keySalt, userValue, revision)

  return aesDecryptNoPad(wrapping, ZERO_IV, wrappedKey.subarray(0, FILE_KEY_BYTES))
}

/**
 * Algorithm 2.B: the password hash.
 *
 * Revision 5 — an Adobe extension that never became ISO — stops at the first
 * SHA-256. Revision 6 continues into the round loop, and the loop is the
 * security: each round rebuilds a buffer 64 times the size of
 * `password || key || userValue`, encrypts it under half of the current hash,
 * and picks SHA-256, SHA-384 or SHA-512 for the next hash by the ciphertext's
 * own first sixteen bytes. It cannot end before round 64, and after that it ends
 * only when the last ciphertext byte falls below `round - 32`.
 */
export async function hash2B(
  password: Uint8Array,
  salt: Uint8Array,
  userValue: Uint8Array,
  revision = 6,
): Promise<Uint8Array<ArrayBuffer>> {
  let key = await sha(256, concat([password, salt, userValue]))
  if (revision < 6) return key

  for (let round = 0; ; round += 1) {
    const block = concat([password, key, userValue])
    const repeated = repeat(block, 64)

    const encrypted = await aesEncryptNoPad(key.subarray(0, 16), key.subarray(16, 32), repeated)

    let sum = 0
    for (let index = 0; index < 16; index += 1) sum += encrypted[index]

    const bits = ([256, 384, 512] as const)[sum % 3]
    key = await sha(bits, encrypted)

    if (round >= MINIMUM_ROUNDS - 1 && encrypted[encrypted.length - 1] <= round - 31) break
  }

  return key.slice(0, HASH_BYTES)
}

function repeat(block: Uint8Array, times: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(block.length * times)
  for (let index = 0; index < times; index += 1) out.set(block, index * block.length)

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

function empty(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(0)
}
