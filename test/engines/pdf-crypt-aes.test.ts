// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  aesDecryptContent,
  aesDecryptNoPad,
  aesEncryptContent,
  aesEncryptNoPad,
  randomBytes,
  sha,
} from '@/lib/engines/pdf-crypt-aes'

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const bytes = (hexText: string) =>
  new Uint8Array((hexText.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)))

const zeroIv = new Uint8Array(16)

describe('sha', () => {
  it('produces the published digests of the empty message', async () => {
    expect(hex(await sha(256, new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(hex(await sha(384, new Uint8Array(0))).slice(0, 32)).toBe(
      '38b060a751ac96384cd9327eb1b1e36a',
    )
    expect(hex(await sha(512, new Uint8Array(0))).slice(0, 32)).toBe(
      'cf83e1357eefb8bdf1542850d66d8007',
    )
  })
})

describe('AES-CBC without padding', () => {
  // NIST SP 800-38A, F.2.1: AES-128-CBC with the standard example key, IV and
  // four plaintext blocks. The published vectors are unpadded, which is exactly
  // the mode PDF's revision-6 hash and its UE/OE blocks use.
  const key = bytes('2b7e151628aed2a6abf7158809cf4f3c')
  const iv = bytes('000102030405060708090a0b0c0d0e0f')
  const plain = bytes(
    '6bc1bee22e409f96e93d7e117393172a' +
      'ae2d8a571e03ac9c9eb76fac45af8e51' +
      '30c81c46a35ce411e5fbc1191a0a52ef' +
      'f69f2445df4f9b17ad2b417be66c3710',
  )
  const cipher = bytes(
    '7649abac8119b246cee98e9b12e9197d' +
      '5086cb9b507219ee95db113a917678b2' +
      '73bed6b8e3c1743b7116e69e22229516' +
      '3ff1caa1681fac09120eca307586e1a7',
  )

  it('encrypts to the NIST vector, with no block of padding on the end', async () => {
    const out = await aesEncryptNoPad(key, iv, plain)

    expect(hex(out)).toBe(hex(cipher))
    expect(out).toHaveLength(plain.length)
  })

  it('decrypts the NIST vector without demanding padding that is not there', async () => {
    expect(hex(await aesDecryptNoPad(key, iv, cipher))).toBe(hex(plain))
  })

  it('round-trips a single block, which is what UE and OE are made of', async () => {
    const block = randomBytes(32)
    const secret = randomBytes(32)

    expect(
      await aesDecryptNoPad(secret, zeroIv, await aesEncryptNoPad(secret, zeroIv, block)),
    ).toEqual(block)
  })

  it('answers nothing for nothing', async () => {
    expect(await aesDecryptNoPad(randomBytes(32), zeroIv, new Uint8Array(0))).toEqual(
      new Uint8Array(0),
    )
  })
})

describe('content encryption', () => {
  const key = randomBytes(32)

  it('round-trips a value of any length', async () => {
    for (const length of [0, 1, 15, 16, 17, 1000]) {
      const message = randomBytes(length)

      expect(await aesDecryptContent(key, await aesEncryptContent(key, message))).toEqual(message)
    }
  })

  it('prefixes the initialisation vector, which is why the value grows', async () => {
    const message = randomBytes(16)

    const encrypted = await aesEncryptContent(key, message)

    // 16 for the vector, and a whole further block because a message that is
    // already a multiple of the block size still gets a full block of padding.
    expect(encrypted).toHaveLength(16 + 32)
  })

  it('uses a fresh vector every time, so the same value never encrypts alike', async () => {
    const message = new Uint8Array(32).fill(7)

    const first = await aesEncryptContent(key, message)
    const second = await aesEncryptContent(key, message)

    expect(hex(first)).not.toBe(hex(second))
  })

  it('gives back what it can when the padding is damaged, instead of failing', async () => {
    // One corrupt object must not cost the user the other ten thousand. The last
    // block decrypts to something that is not padding, so it is kept as-is.
    const message = randomBytes(32)
    const encrypted = await aesEncryptContent(key, message)
    encrypted[encrypted.length - 1] ^= 0xff

    const out = await aesDecryptContent(key, encrypted)

    expect(out.length).toBeGreaterThanOrEqual(message.length)
    expect(hex(out.subarray(0, 16))).toBe(hex(message.subarray(0, 16)))
  })

  it('treats a value too short to be a ciphertext as empty rather than throwing', async () => {
    expect(await aesDecryptContent(key, new Uint8Array(8))).toEqual(new Uint8Array(0))
    expect(await aesDecryptContent(key, new Uint8Array(16))).toEqual(new Uint8Array(0))
  })
})
