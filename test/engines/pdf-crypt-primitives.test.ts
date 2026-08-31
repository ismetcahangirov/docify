// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { md5 } from '@/lib/engines/pdf-crypt-md5'
import { rc4 } from '@/lib/engines/pdf-crypt-rc4'

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const ascii = (text: string) => new TextEncoder().encode(text)

describe('md5', () => {
  // RFC 1321 §A.5 publishes these seven digests as the suite an implementation
  // has to reproduce. Matching them is the whole verification: the algorithm has
  // one right answer and no room for interpretation.
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    [
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      'd174ab98d277d9f5a5611c2c9f419d9f',
    ],
    [
      '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
      '57edf4a22be3c955ac49da2e2107b67a',
    ],
  ])('matches the RFC 1321 test suite for %j', (input, digest) => {
    expect(hex(md5(ascii(input)))).toBe(digest)
  })

  it('hashes exactly 55 and 56 bytes, either side of the padding boundary', () => {
    // 56 is where the length field no longer fits in the first block and a
    // second one has to be added; an implementation that gets the boundary wrong
    // usually passes every shorter case.
    expect(hex(md5(ascii('a'.repeat(55))))).toBe('ef1772b6dff9a122358552954ad0df65')
    expect(hex(md5(ascii('a'.repeat(56))))).toBe('3b0c8ac703f828b04c6c197006d17218')
  })

  it('reads a view that does not start at the beginning of its buffer', () => {
    // Every slice taken out of a PDF is such a view, so this is the shape the
    // caller actually passes rather than a hypothetical one.
    const backing = new Uint8Array([9, 9, 9, ...ascii('abc'), 9])

    expect(hex(md5(backing.subarray(3, 6)))).toBe('900150983cd24fb0d6963f7d28e17f72')
  })
})

describe('rc4', () => {
  // The vectors published with the original cipher description; the first two
  // are the ones every implementation is checked against.
  it.each([
    ['0123456789abcdef', '0123456789abcdef', '75b7878099e0c596'],
    ['0123456789abcdef', '0000000000000000', '7494c2e7104b0879'],
    ['0000000000000000', '0000000000000000', 'de188941a3375d3a'],
    ['ef012345', '00000000000000000000', 'd6a141a7ec3c38dfbd61'],
  ])('matches the published vector for key %s', (key, plain, cipher) => {
    expect(hex(rc4(bytes(key), bytes(plain)))).toBe(cipher)
  })

  it('decrypts by encrypting again, which is why one function serves both ways', () => {
    const key = ascii('a password')
    const message = ascii('The GPS coordinates are in the Exif block.')

    expect(rc4(key, rc4(key, message))).toEqual(message)
  })

  it('never changes the length, which is what keeps a legacy file byte-aligned', () => {
    for (const length of [0, 1, 15, 16, 17, 1000]) {
      expect(rc4(ascii('key'), new Uint8Array(length))).toHaveLength(length)
    }
  })
})

function bytes(hexText: string): Uint8Array {
  return new Uint8Array((hexText.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)))
}
