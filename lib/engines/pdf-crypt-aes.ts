/**
 * The AES and SHA-2 primitives PDF encryption needs, on top of `SubtleCrypto`.
 *
 * Nothing here implements a cipher. The browser already has AES and the SHA-2
 * family, audited and hardware-accelerated, and hand-rolling either to avoid an
 * `await` would be the worst trade in this repository. What this module does is
 * bridge two mismatches between what `SubtleCrypto` offers and what the PDF
 * specification asks for.
 *
 * ## Mismatch one: CBC without padding
 *
 * `SubtleCrypto`'s AES-CBC always applies PKCS#7 padding on the way in and
 * always validates it on the way out. PDF needs raw CBC in two places — the
 * revision-6 password hash (ISO 32000-2, algorithm 2.B) and the 32-byte `UE`/`OE`
 * blocks that hold the file key — and neither is padded. Both are reachable
 * anyway, by arithmetic rather than by a second AES implementation:
 *
 * - **Encrypting** a whole number of blocks produces one extra block of pure
 *   padding at the end. Dropping it leaves exactly the unpadded ciphertext.
 * - **Decrypting** needs the reverse: append a block that is *constructed* to
 *   decrypt to a valid full-block padding, `0x10` sixteen times. Because CBC
 *   decryption XORs each decrypted block with the previous ciphertext block,
 *   the block to append is `E(padding XOR Cₙ)` — and `E` of a single block is
 *   itself one CBC encryption under a zero IV. `SubtleCrypto` then strips the
 *   padding it was given and returns exactly the plaintext.
 *
 * ## Mismatch two: forgiving decryption
 *
 * A stream that arrives with damaged padding — a truncated download, a producer
 * that got it wrong — makes `SubtleCrypto` reject the whole operation. For a
 * *document* that is the wrong answer: the other ten thousand objects are fine,
 * and the user wants their file. So content decryption goes through the unpadded
 * path and strips PKCS#7 here, keeping whatever it finds when the padding does
 * not check out rather than failing the job.
 */

const BLOCK_BYTES = 16
const ZERO_IV = new Uint8Array(BLOCK_BYTES)

/** SHA-256, SHA-384 or SHA-512 of `data`. Revision 6 needs all three. */
export async function sha(
  bits: 256 | 384 | 512,
  data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().digest(`SHA-${bits}`, copy(data)))
}

/** Cryptographically random bytes, for salts, IVs and file keys. */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

/**
 * AES-CBC over a whole number of blocks, with no padding added.
 *
 * `data.length` must be a multiple of 16; the extra block `SubtleCrypto` appends
 * is dropped.
 */
export async function aesEncryptNoPad(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const encrypted = await subtle().encrypt(
    { name: 'AES-CBC', iv: copy(iv) },
    await importKey(key),
    copy(data),
  )

  return new Uint8Array(encrypted).slice(0, data.length)
}

/**
 * AES-CBC over a whole number of blocks, expecting no padding.
 *
 * See the module header for the appended block that makes this possible without
 * a second AES implementation.
 */
export async function aesDecryptNoPad(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (data.length === 0) return new Uint8Array(0)

  const material = await importKey(key)
  const last = data.subarray(data.length - BLOCK_BYTES)
  const wanted = new Uint8Array(BLOCK_BYTES).fill(BLOCK_BYTES)
  const closing = await encryptBlock(material, xor(wanted, last))

  const padded = new Uint8Array(data.length + BLOCK_BYTES)
  padded.set(data)
  padded.set(closing, data.length)

  const decrypted = await subtle().decrypt({ name: 'AES-CBC', iv: copy(iv) }, material, padded)

  return new Uint8Array(decrypted)
}

/**
 * Encrypts `data` the way PDF encrypts a string or a stream: a fresh random
 * initialisation vector, then AES-CBC with PKCS#7 padding, with the vector
 * prefixed to the result.
 *
 * The prefix is part of the format rather than a convention of ours — a reader
 * takes the first sixteen bytes as the IV — which is also why every encrypted
 * value is at least seventeen bytes longer than what went in.
 */
export async function aesEncryptContent(
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(BLOCK_BYTES)
  const encrypted = await subtle().encrypt(
    { name: 'AES-CBC', iv: copy(iv) },
    await importKey(key),
    copy(data),
  )

  const out = new Uint8Array(BLOCK_BYTES + encrypted.byteLength)
  out.set(iv)
  out.set(new Uint8Array(encrypted), BLOCK_BYTES)

  return out
}

/**
 * The reverse of {@link aesEncryptContent}: strips the leading vector, decrypts,
 * and removes the PKCS#7 padding.
 *
 * Forgiving on purpose, twice over. A value shorter than one vector plus one
 * block cannot be a ciphertext at all and comes back empty rather than throwing;
 * padding that does not check out is left in place rather than failing the job.
 * One damaged object in a document is not a reason to refuse the other ten
 * thousand — see the module header.
 */
export async function aesDecryptContent(
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const blocks = Math.floor((data.length - BLOCK_BYTES) / BLOCK_BYTES) * BLOCK_BYTES
  if (blocks <= 0) return new Uint8Array(0)

  const iv = data.subarray(0, BLOCK_BYTES)
  const body = data.subarray(BLOCK_BYTES, BLOCK_BYTES + blocks)

  return stripPadding(await aesDecryptNoPad(key, iv, body))
}

/**
 * Removes PKCS#7 padding, or leaves the bytes alone when what is there is not
 * padding.
 *
 * The last byte says how many bytes to drop, between 1 and 16, and every one of
 * them has to carry that same value. Anything else is a damaged object, and
 * returning its plaintext with sixteen stray bytes is more useful than returning
 * nothing.
 */
function stripPadding(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const count = data[data.length - 1]
  if (count < 1 || count > BLOCK_BYTES || count > data.length) return data

  for (let index = data.length - count; index < data.length; index += 1) {
    if (data[index] !== count) return data
  }

  return data.slice(0, data.length - count)
}

/** One block through the block cipher, which CBC under a zero IV reduces to. */
async function encryptBlock(key: CryptoKey, block: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const encrypted = await subtle().encrypt({ name: 'AES-CBC', iv: ZERO_IV }, key, block)

  return new Uint8Array(encrypted).subarray(0, BLOCK_BYTES)
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length)
  for (let index = 0; index < a.length; index += 1) out[index] = a[index] ^ b[index]

  return out
}

async function importKey(key: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', copy(key), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt'])
}

/**
 * A standalone copy of `view`.
 *
 * `SubtleCrypto` refuses a `Uint8Array` backed by a `SharedArrayBuffer`, and a
 * `subarray` of a document's bytes silently passes the *whole* buffer to some
 * engines. Both are avoided by copying, which for the sizes involved — keys,
 * salts, one object at a time — costs nothing worth measuring.
 */
function copy(view: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(view.length)
  out.set(view)

  return out
}

/**
 * The Web Crypto implementation, or a sentence saying why there is none.
 *
 * `crypto.subtle` is absent outside a secure context. Every page this runs on is
 * HTTPS, so the realistic case is not a user's browser but a stale bookmark to
 * an `http://` development server — and "your PDF is damaged" would be a
 * terrible way to report that.
 */
function subtle(): SubtleCrypto {
  const available = globalThis.crypto?.subtle
  if (available === undefined) {
    throw new Error(
      'PDF encryption needs the browser cryptography API, which is only available on a ' +
        'secure connection. Open this page over https and try again.',
    )
  }

  return available
}
