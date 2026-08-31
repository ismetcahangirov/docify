/**
 * MD5, because PDF's pre-2011 key derivation is built out of it.
 *
 * Revisions 2 through 4 of the standard security handler derive the file
 * encryption key by hashing the padded password with MD5, iterating it fifty
 * times, and then derive a *per-object* key by hashing that with the object
 * number. There is no way to open one of those documents without it, and
 * `SubtleCrypto` deliberately does not offer MD5 — so it lives here, in the one
 * place that is allowed to want it.
 *
 * Nothing in this project uses MD5 for anything a hash function is normally
 * chosen for. It is not used to sign, to verify integrity, or to derive a key we
 * write: `./pdf-protect` produces AES-256 with SHA-256-based derivation
 * (revision 6) and never calls this. This is a *file format reader*, and the
 * format is what it is.
 *
 * The implementation is the reference one from RFC 1321, transcribed: four
 * 32-bit words, sixty-four rounds over each 64-byte block, little-endian
 * throughout.
 */

const BLOCK_BYTES = 64

/** Per-round left-rotation amounts, RFC 1321 §3.4. */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

/** `floor(abs(sin(i + 1)) * 2^32)` for each round, precomputed at module load. */
const SINES = Array.from({ length: 64 }, (_, round) =>
  Math.floor(Math.abs(Math.sin(round + 1)) * 2 ** 32),
)

/** The 16-byte MD5 digest of `data`. */
export function md5(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const padded = pad(data)
  const words = new Int32Array(padded.buffer, padded.byteOffset, padded.length / 4)

  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  for (let block = 0; block < words.length; block += 16) {
    const [a0, b0, c0, d0] = [a, b, c, d]

    for (let round = 0; round < 64; round += 1) {
      const { mixed, index } =
        round < 16
          ? { mixed: (b & c) | (~b & d), index: round }
          : round < 32
            ? { mixed: (d & b) | (~d & c), index: (5 * round + 1) % 16 }
            : round < 48
              ? { mixed: b ^ c ^ d, index: (3 * round + 5) % 16 }
              : { mixed: c ^ (b | ~d), index: (7 * round) % 16 }

      const rotated = a + mixed + SINES[round] + words[block + index]
      a = d
      d = c
      c = b
      b = (b + rotateLeft(rotated, SHIFTS[round])) | 0
    }

    a = (a + a0) | 0
    b = (b + b0) | 0
    c = (c + c0) | 0
    d = (d + d0) | 0
  }

  const digest = new Uint8Array(16)
  new DataView(digest.buffer).setInt32(0, a, true)
  new DataView(digest.buffer).setInt32(4, b, true)
  new DataView(digest.buffer).setInt32(8, c, true)
  new DataView(digest.buffer).setInt32(12, d, true)

  return digest
}

/**
 * The message with the mandatory `0x80` terminator, zero padding to a multiple
 * of 64 bytes, and the original bit length in the last eight.
 *
 * A fresh buffer rather than a view onto the caller's, so a `Uint8Array` backed
 * by a `SharedArrayBuffer` — or by a longer buffer at a non-zero offset — still
 * lines up for the `Int32Array` above.
 */
function pad(data: Uint8Array): Uint8Array<ArrayBuffer> {
  // 9 = the 0x80 byte plus the eight length bytes, which must all fit.
  const blocks = Math.ceil((data.length + 9) / BLOCK_BYTES)
  const padded = new Uint8Array(blocks * BLOCK_BYTES)
  padded.set(data)
  padded[data.length] = 0x80

  // Only the low 32 bits of the length are written: PDF hashes passwords and
  // 16-byte digests, never anything near 512 MB.
  new DataView(padded.buffer).setUint32(padded.length - 8, data.length * 8, true)

  return padded
}

function rotateLeft(value: number, by: number): number {
  return (value << by) | (value >>> (32 - by))
}
