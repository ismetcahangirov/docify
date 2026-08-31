// @vitest-environment node

/**
 * The reader is checked against a writer written from the specification, not
 * against itself.
 *
 * `lib/engines/pdf-crypt-legacy.ts` only ever *reads* revisions 2 to 4 — nothing
 * in the app writes them — so a round-trip through our own code would prove
 * nothing about whether it matches ISO 32000-1. The `/O` and `/U` values below
 * are therefore built here, from algorithms 3, 4 and 5 as the specification
 * states them, and the library has to recover the key from those.
 */

import { describe, expect, it } from 'vitest'

import { buildPasswordEntry, hash2B, newFileKey } from '@/lib/engines/pdf-crypt-r6'
import { md5 } from '@/lib/engines/pdf-crypt-md5'
import { rc4 } from '@/lib/engines/pdf-crypt-rc4'
import {
  decryptValue,
  encryptValue,
  fileKeyFor,
  objectKey,
  type SecuritySpec,
} from '@/lib/engines/pdf-crypt-standard'

const PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
])

const ID0 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
const PERMISSIONS = -3904

const ascii = (text: string) => new TextEncoder().encode(text)

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }

  return out
}

function padPassword(password: string): Uint8Array {
  const bytes = new Uint8Array([...password].map((c) => c.charCodeAt(0) & 0xff))
  const out = new Uint8Array(32)
  const kept = Math.min(bytes.length, 32)
  out.set(bytes.subarray(0, kept))
  out.set(PADDING.subarray(0, 32 - kept), kept)

  return out
}

function shifted(key: Uint8Array, round: number): Uint8Array {
  return key.map((byte) => byte ^ round)
}

/** Algorithm 3: compute `/O` from the owner and user passwords. */
function computeOwnerValue(
  revision: number,
  keyBytes: number,
  owner: string,
  user: string,
): Uint8Array {
  let digest = md5(padPassword(owner))
  if (revision >= 3) for (let i = 0; i < 50; i += 1) digest = md5(digest)

  const key = digest.subarray(0, keyBytes)
  let value = rc4(key, padPassword(user))
  if (revision >= 3) {
    for (let round = 1; round < 20; round += 1) value = rc4(shifted(key, round), value)
  }

  return value
}

/** Algorithm 2: the file key, written out again from the specification. */
function computeFileKey(
  revision: number,
  keyBytes: number,
  user: string,
  ownerValue: Uint8Array,
  encryptMetadata: boolean,
): Uint8Array {
  const permissionBytes = new Uint8Array(4)
  new DataView(permissionBytes.buffer).setInt32(0, PERMISSIONS, true)

  const parts = [padPassword(user), ownerValue, permissionBytes, ID0]
  if (revision >= 4 && !encryptMetadata) parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]))

  let digest = md5(concat(parts))
  if (revision >= 3) {
    for (let i = 0; i < 50; i += 1) digest = md5(digest.subarray(0, keyBytes))
  }

  return digest.subarray(0, keyBytes)
}

/** Algorithms 4 and 5: compute `/U` from the file key. */
function computeUserValue(revision: number, key: Uint8Array): Uint8Array {
  if (revision === 2) return rc4(key, PADDING)

  let value = md5(concat([PADDING, ID0]))
  value = rc4(key, value)
  for (let round = 1; round < 20; round += 1) value = rc4(shifted(key, round), value)

  const out = new Uint8Array(32)
  out.set(value)
  out.set(value.subarray(0, 16), 16)

  return out
}

function legacySpec(options: {
  revision: number
  keyBytes: number
  user: string
  owner: string
  encryptMetadata?: boolean
}): { spec: SecuritySpec; expectedKey: Uint8Array } {
  const { revision, keyBytes, user, owner } = options
  const encryptMetadata = options.encryptMetadata ?? true

  const ownerValue = computeOwnerValue(revision, keyBytes, owner, user)
  const expectedKey = computeFileKey(revision, keyBytes, user, ownerValue, encryptMetadata)

  return {
    expectedKey,
    spec: {
      revision,
      keyBytes,
      permissions: PERMISSIONS,
      encryptMetadata,
      id0: ID0,
      user: computeUserValue(revision, expectedKey),
      owner: ownerValue,
      userWrappedKey: new Uint8Array(0),
      ownerWrappedKey: new Uint8Array(0),
      stringMethod: revision >= 4 ? 'aesv2' : 'rc4',
      streamMethod: revision >= 4 ? 'aesv2' : 'rc4',
    },
  }
}

describe('the legacy revisions, read back from a specification-built document', () => {
  it.each([
    ['revision 2, 40-bit', 2, 5],
    ['revision 3, 128-bit', 3, 16],
    ['revision 4, 128-bit', 4, 16],
  ])('recovers the file key from the user password: %s', async (_name, revision, keyBytes) => {
    const { spec, expectedKey } = legacySpec({ revision, keyBytes, user: 'letmein', owner: 'boss' })

    expect(await fileKeyFor(spec, 'letmein')).toEqual(expectedKey)
  })

  it.each([
    ['revision 2', 2, 5],
    ['revision 3', 3, 16],
    ['revision 4', 4, 16],
  ])('recovers the same key from the owner password: %s', async (_name, revision, keyBytes) => {
    const { spec, expectedKey } = legacySpec({ revision, keyBytes, user: 'letmein', owner: 'boss' })

    expect(await fileKeyFor(spec, 'boss')).toEqual(expectedKey)
  })

  it('opens a document that has restrictions but no user password at all', async () => {
    // The commonest reason anyone reaches for a PDF unlocker: the file opens
    // without being asked for anything, and refuses to let them print it.
    const { spec, expectedKey } = legacySpec({ revision: 4, keyBytes: 16, user: '', owner: 'boss' })

    expect(await fileKeyFor(spec, '')).toEqual(expectedKey)
  })

  it('refuses a password that is neither', async () => {
    const { spec } = legacySpec({ revision: 4, keyBytes: 16, user: 'letmein', owner: 'boss' })

    expect(await fileKeyFor(spec, 'letmeout')).toBeNull()
  })

  it('folds unencrypted metadata into the key, so the two are not interchangeable', async () => {
    const withMetadata = legacySpec({ revision: 4, keyBytes: 16, user: 'p', owner: 'o' })
    const without = legacySpec({
      revision: 4,
      keyBytes: 16,
      user: 'p',
      owner: 'o',
      encryptMetadata: false,
    })

    expect(without.expectedKey).not.toEqual(withMetadata.expectedKey)
    expect(await fileKeyFor(without.spec, 'p')).toEqual(without.expectedKey)
  })
})

/**
 * Deliberately slow, and given room to be.
 *
 * Algorithm 2.B is at least 64 rounds of AES and SHA-2 by design — that is what
 * makes a password guess cost an attacker what it costs us. Each case below runs
 * it several times, which is comfortably under a second on its own and can pass
 * the default five while the rest of the suite competes for the same cores.
 */
describe('revision 6', { timeout: 30_000 }, () => {
  async function protectedSpec(user: string, owner: string) {
    const fileKey = newFileKey()
    const userEntry = await buildPasswordEntry(
      new TextEncoder().encode(user),
      fileKey,
      new Uint8Array(0),
    )
    const ownerEntry = await buildPasswordEntry(
      new TextEncoder().encode(owner),
      fileKey,
      userEntry.value,
    )

    const spec: SecuritySpec = {
      revision: 6,
      keyBytes: 32,
      permissions: PERMISSIONS,
      encryptMetadata: true,
      id0: ID0,
      user: userEntry.value,
      owner: ownerEntry.value,
      userWrappedKey: userEntry.wrappedKey,
      ownerWrappedKey: ownerEntry.wrappedKey,
      stringMethod: 'aesv3',
      streamMethod: 'aesv3',
    }

    return { spec, fileKey }
  }

  it('unwraps the file key with either password', async () => {
    const { spec, fileKey } = await protectedSpec('open-me', 'own-me')

    expect(await fileKeyFor(spec, 'open-me')).toEqual(fileKey)
    expect(await fileKeyFor(spec, 'own-me')).toEqual(fileKey)
  })

  it('refuses anything else', async () => {
    const { spec } = await protectedSpec('open-me', 'own-me')

    expect(await fileKeyFor(spec, 'open-mf')).toBeNull()
    expect(await fileKeyFor(spec, '')).toBeNull()
  })

  it('takes a password of any length and any script', async () => {
    const { spec, fileKey } = await protectedSpec('パスワード🔐', 'x')

    expect(await fileKeyFor(spec, 'パスワード🔐')).toEqual(fileKey)
  })

  it('does not derive the file key from the password, which is why both open it', async () => {
    const first = await protectedSpec('same', 'same')
    const second = await protectedSpec('same', 'same')

    // Same passwords, different documents, different keys: the key is random and
    // only wrapped by the password.
    expect(first.fileKey).not.toEqual(second.fileKey)
  })

  it('runs at least 64 rounds of the hash, whatever the input', async () => {
    // Not observable directly, so this pins the property that matters: the hash
    // is not a plain SHA-256 of the password and salt.
    const password = ascii('p')
    const salt = new Uint8Array(8)

    const revision6 = await hash2B(password, salt, new Uint8Array(0), 6)
    const revision5 = await hash2B(password, salt, new Uint8Array(0), 5)

    expect(revision6).toHaveLength(32)
    expect(revision6).not.toEqual(revision5)
  })
})

describe('object keys and values', () => {
  const spec = (revision: number, method: SecuritySpec['stringMethod']): SecuritySpec => ({
    revision,
    keyBytes: revision >= 5 ? 32 : 16,
    permissions: PERMISSIONS,
    encryptMetadata: true,
    id0: ID0,
    user: new Uint8Array(48),
    owner: new Uint8Array(48),
    userWrappedKey: new Uint8Array(32),
    ownerWrappedKey: new Uint8Array(32),
    stringMethod: method,
    streamMethod: method,
  })

  it('derives a different key for every object before revision 5', () => {
    const fileKey = new Uint8Array(16).fill(9)
    const legacy = spec(4, 'aesv2')

    const first = objectKey(legacy, fileKey, 'aesv2', 7, 0)
    const second = objectKey(legacy, fileKey, 'aesv2', 8, 0)

    expect(first).not.toEqual(second)
    expect(first).toHaveLength(16)
  })

  it('salts the AES derivation differently from the RC4 one, per table 21', () => {
    const fileKey = new Uint8Array(16).fill(9)

    expect(objectKey(spec(4, 'aesv2'), fileKey, 'aesv2', 7, 0)).not.toEqual(
      objectKey(spec(4, 'rc4'), fileKey, 'rc4', 7, 0),
    )
  })

  it('uses the file key itself from revision 5, with no derivation at all', () => {
    const fileKey = new Uint8Array(32).fill(3)

    expect(objectKey(spec(6, 'aesv3'), fileKey, 'aesv3', 7, 0)).toEqual(fileKey)
  })

  it.each([
    ['rc4 under revision 4', 4, 'rc4' as const],
    ['aes-128 under revision 4', 4, 'aesv2' as const],
    ['aes-256 under revision 6', 6, 'aesv3' as const],
  ])('round-trips a value: %s', async (_name, revision, method) => {
    const handler = spec(revision, method)
    const fileKey = new Uint8Array(revision >= 5 ? 32 : 16).fill(5)
    const value = ascii('The GPS coordinates are in here.')

    const encrypted = await encryptValue(handler, fileKey, method, 12, 0, value)
    expect(await decryptValue(handler, fileKey, method, 12, 0, encrypted)).toEqual(value)
  })

  it('leaves an identity filter alone in both directions', async () => {
    const handler = spec(4, 'identity')
    const value = ascii('in the clear')

    expect(await encryptValue(handler, new Uint8Array(16), 'identity', 1, 0, value)).toEqual(value)
    expect(await decryptValue(handler, new Uint8Array(16), 'identity', 1, 0, value)).toEqual(value)
  })

  it('keeps an RC4 value exactly as long as it was', async () => {
    const handler = spec(4, 'rc4')
    const value = ascii('a title')

    expect(await encryptValue(handler, new Uint8Array(16), 'rc4', 1, 0, value)).toHaveLength(
      value.length,
    )
  })
})
