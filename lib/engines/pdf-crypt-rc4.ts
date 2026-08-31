/**
 * RC4, as PDF's standard security handler used it before AES.
 *
 * Here for one reason: files. Every PDF encrypted by Acrobat before version 7 —
 * and plenty since, because `/V 2` stayed a supported choice — is RC4, and a
 * tool that cannot open those cannot honestly call itself a password remover.
 *
 * It is **never** used to encrypt anything here. `./pdf-protect` writes AES-256
 * only. RC4 is broken as a cipher and its use in PDF compounds that with a
 * 40-bit key option; reading a legacy file is a different act from producing a
 * new one, and only the first is defensible.
 *
 * The algorithm is twenty lines because it is twenty lines — a 256-byte
 * permutation, shuffled by the key, then walked to produce a keystream that is
 * XORed with the data. Symmetric, so one function serves both directions.
 */

const STATE_SIZE = 256

/**
 * `data` XORed with the RC4 keystream for `key`.
 *
 * The same call encrypts and decrypts: RC4 is a stream cipher, so applying it
 * twice with the same key returns the original bytes. Output is always exactly
 * as long as the input, which is what lets `./pdf-unlock-bytes` decrypt a legacy
 * document without moving a single byte offset in the file.
 */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const state = new Uint8Array(STATE_SIZE)
  for (let index = 0; index < STATE_SIZE; index += 1) state[index] = index

  // Key-scheduling: shuffle the identity permutation by the key, repeating the
  // key as often as needed to cover all 256 positions.
  let swapAt = 0
  for (let index = 0; index < STATE_SIZE; index += 1) {
    swapAt = (swapAt + state[index] + key[index % key.length]) % STATE_SIZE
    swap(state, index, swapAt)
  }

  const out = new Uint8Array(data.length)
  let i = 0
  let j = 0

  for (let index = 0; index < data.length; index += 1) {
    i = (i + 1) % STATE_SIZE
    j = (j + state[i]) % STATE_SIZE
    swap(state, i, j)
    out[index] = data[index] ^ state[(state[i] + state[j]) % STATE_SIZE]
  }

  return out
}

function swap(state: Uint8Array, a: number, b: number): void {
  const held = state[a]
  state[a] = state[b]
  state[b] = held
}
