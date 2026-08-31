// @vitest-environment node

/**
 * The two operations are tested against each other and against pdf-lib.
 *
 * A round trip alone would prove only that this code is self-consistent, so
 * every case also checks the result with pdf-lib: a protected document must be
 * one pdf-lib refuses as encrypted, and an unlocked one must be a document it
 * opens, with the pages and the title still in it.
 *
 * The legacy revisions get the opposite treatment. Nothing here writes RC4, so
 * an RC4 document is built by hand from the specification's own algorithms and
 * the unlocker has to open it.
 */

import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import type { EngineInput } from '@/lib/engines/types'
import { md5 } from '@/lib/engines/pdf-crypt-md5'
import { rc4 } from '@/lib/engines/pdf-crypt-rc4'
import { protectPdf } from '@/lib/engines/pdf-protect'
import { unlockPdf } from '@/lib/engines/pdf-unlock'

const TITLE = 'Quarterly report (final) — v2'
const running = () => new AbortController().signal
const quiet = () => {}

async function samplePdf(pages = 3): Promise<Blob> {
  const document = await PDFDocument.create()
  document.setTitle(TITLE)
  document.setAuthor('A. Person')
  for (let index = 0; index < pages; index += 1) {
    document.addPage([200, 300]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 })
  }

  return new Blob([(await document.save({ useObjectStreams: true })) as Uint8Array<ArrayBuffer>], {
    type: 'application/pdf',
  })
}

const job = (files: Blob[], pdf?: EngineInput['pdf']): EngineInput => ({
  task: { from: 'pdf', to: 'pdf', op: 'protect' },
  files,
  pdf,
})

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('protecting a PDF', { timeout: 30_000 }, () => {
  it('produces a document pdf-lib will not open without being told to ignore it', async () => {
    const protectedPdf = await protectPdf(
      job([await samplePdf()], { protect: { password: 'letmein' } }),
      running(),
      quiet,
    )

    await expect(PDFDocument.load(await bytesOf(protectedPdf))).rejects.toThrow()

    const ignoring = await PDFDocument.load(await bytesOf(protectedPdf), {
      ignoreEncryption: true,
    })
    expect(ignoring.isEncrypted).toBe(true)
  })

  it('writes AES-256 under revision 6, and nothing older', async () => {
    const protectedPdf = await protectPdf(
      job([await samplePdf()], { protect: { password: 'letmein' } }),
      running(),
      quiet,
    )
    const text = new TextDecoder('latin1').decode(await bytesOf(protectedPdf))

    expect(text).toMatch(/\/R 6\b/)
    expect(text).toMatch(/\/V 5\b/)
    expect(text).toMatch(/\/CFM \/AESV3\b/)
    expect(text).not.toMatch(/\/CFM \/V2\b/)
  })

  it('leaves nothing readable behind: the title is no longer in the bytes', async () => {
    const protectedPdf = await protectPdf(
      job([await samplePdf()], { protect: { password: 'letmein' } }),
      running(),
      quiet,
    )
    const text = new TextDecoder('latin1').decode(await bytesOf(protectedPdf))

    // The document information dictionary is an ordinary object, so its strings
    // are encrypted like any others. A title still visible here would mean the
    // walk missed a container.
    expect(text).not.toContain('Quarterly report')
    expect(text).not.toContain('A. Person')
  })

  it('refuses a job with no password rather than writing an unprotected file', async () => {
    await expect(protectPdf(job([await samplePdf()]), running(), quiet)).rejects.toThrow(
      /needs a password/,
    )
    await expect(
      protectPdf(job([await samplePdf()], { protect: { password: '' } }), running(), quiet),
    ).rejects.toThrow(/needs a password/)
  })

  it('refuses to protect a document that is already protected', async () => {
    const once = await protectPdf(
      job([await samplePdf()], { protect: { password: 'letmein' } }),
      running(),
      quiet,
    )

    await expect(
      protectPdf(job([once], { protect: { password: 'again' } }), running(), quiet),
    ).rejects.toThrow(/already has a password/)
  })

  it('takes one document at a time, and says so', async () => {
    const files = [await samplePdf(), await samplePdf()]

    await expect(
      protectPdf(job(files, { protect: { password: 'x' } }), running(), quiet),
    ).rejects.toThrow(/one document at a time/)
  })

  it('reports progress from nothing to finished', async () => {
    const seen: number[] = []

    await protectPdf(
      job([await samplePdf()], { protect: { password: 'x' } }),
      running(),
      (progress) => seen.push(progress),
    )

    expect(seen[0]).toBe(0)
    expect(seen.at(-1)).toBe(1)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('stops when the job is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      protectPdf(
        job([await samplePdf()], { protect: { password: 'x' } }),
        controller.signal,
        quiet,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('unlocking a PDF', { timeout: 30_000 }, () => {
  async function locked(password: string, ownerPassword?: string): Promise<Blob> {
    return protectPdf(
      job([await samplePdf()], { protect: { password, ownerPassword } }),
      running(),
      quiet,
    )
  }

  it('gives back a document pdf-lib opens, with its pages and its title', async () => {
    const unlocked = await unlockPdf(
      job([await locked('letmein')], { unlock: { password: 'letmein' } }),
      running(),
      quiet,
    )

    const document = await PDFDocument.load(await bytesOf(unlocked))
    expect(document.isEncrypted).toBe(false)
    expect(document.getPageCount()).toBe(3)
    expect(document.getTitle()).toBe(TITLE)
    expect(document.getAuthor()).toBe('A. Person')
  })

  it('opens with the owner password as readily as with the user password', async () => {
    const document = await unlockPdf(
      job([await locked('open-me', 'own-me')], { unlock: { password: 'own-me' } }),
      running(),
      quiet,
    )

    expect((await PDFDocument.load(await bytesOf(document))).getTitle()).toBe(TITLE)
  })

  it('never moves a byte: the unlocked file is exactly as long as the locked one', async () => {
    // The property the whole design rests on. Every object is rewritten inside
    // its own span and padded back, so the cross-reference table keeps pointing
    // at the right offsets without being rebuilt.
    const source = await locked('letmein')
    const unlocked = await unlockPdf(
      job([source], { unlock: { password: 'letmein' } }),
      running(),
      quiet,
    )

    expect(unlocked.size).toBe(source.size)
  })

  it('leaves no encryption dictionary reference behind in the trailer', async () => {
    const unlocked = await unlockPdf(
      job([await locked('letmein')], { unlock: { password: 'letmein' } }),
      running(),
      quiet,
    )
    const text = new TextDecoder('latin1').decode(await bytesOf(unlocked))
    const trailer = text.slice(text.lastIndexOf('trailer'))

    expect(trailer).not.toMatch(/\/Encrypt/)
  })

  it('says which way to go when the password is wrong, and when none was given', async () => {
    const source = await locked('letmein')

    await expect(
      unlockPdf(job([source], { unlock: { password: 'letmeout' } }), running(), quiet),
    ).rejects.toThrow(/does not open this PDF/)
    await expect(unlockPdf(job([source]), running(), quiet)).rejects.toThrow(
      /needs a password to open/,
    )
  })

  it('says there is nothing to do for a document that was never protected', async () => {
    await expect(
      unlockPdf(job([await samplePdf()], { unlock: { password: 'x' } }), running(), quiet),
    ).rejects.toThrow(/no password on it/)
  })

  it('takes one document at a time, and says so', async () => {
    const source = await locked('letmein')

    await expect(unlockPdf(job([source, source]), running(), quiet)).rejects.toThrow(
      /one document at a time/,
    )
  })

  it('stops when the job is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      unlockPdf(job([await locked('x')], { unlock: { password: 'x' } }), controller.signal, quiet),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('unlocking a legacy RC4 document', { timeout: 30_000 }, () => {
  /**
   * Encrypts a pdf-lib document the way Acrobat 5 would have: revision 3,
   * 128-bit RC4, every string and stream under its own object key.
   *
   * Written here from ISO 32000-1 rather than reused from the library, because
   * nothing in the app writes this and a round trip through our own encryptor
   * would prove nothing about the format.
   */
  async function encryptWithRc4(source: Uint8Array, password: string): Promise<Uint8Array> {
    const PADDING = new Uint8Array([
      0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01,
      0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53,
      0x69, 0x7a,
    ])
    const id0 = new Uint8Array(16).fill(0x5a)
    const permissions = -4
    const keyBytes = 16

    const padPassword = (value: string) => {
      const raw = new Uint8Array([...value].map((c) => c.charCodeAt(0) & 0xff))
      const out = new Uint8Array(32)
      const kept = Math.min(raw.length, 32)
      out.set(raw.subarray(0, kept))
      out.set(PADDING.subarray(0, 32 - kept), kept)

      return out
    }
    const join = (parts: Uint8Array[]) => {
      const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
      let at = 0
      for (const part of parts) {
        out.set(part, at)
        at += part.length
      }

      return out
    }
    const shifted = (key: Uint8Array, round: number) => key.map((byte) => byte ^ round)

    // Algorithm 3: /O, from the owner password (here the same as the user's).
    let ownerDigest = md5(padPassword(password))
    for (let i = 0; i < 50; i += 1) ownerDigest = md5(ownerDigest)
    const ownerKey = ownerDigest.subarray(0, keyBytes)
    let ownerValue = rc4(ownerKey, padPassword(password))
    for (let round = 1; round < 20; round += 1) {
      ownerValue = rc4(shifted(ownerKey, round), ownerValue)
    }

    // Algorithm 2: the file key.
    const permissionBytes = new Uint8Array(4)
    new DataView(permissionBytes.buffer).setInt32(0, permissions, true)
    let digest = md5(join([padPassword(password), ownerValue, permissionBytes, id0]))
    for (let i = 0; i < 50; i += 1) digest = md5(digest.subarray(0, keyBytes))
    const fileKey = digest.subarray(0, keyBytes)

    // Algorithm 5: /U.
    let userValue = rc4(fileKey, md5(join([PADDING, id0])))
    for (let round = 1; round < 20; round += 1) {
      userValue = rc4(shifted(fileKey, round), userValue)
    }
    const user = new Uint8Array(32)
    user.set(userValue)
    user.set(userValue.subarray(0, 16), 16)

    const objectKey = (number: number, generation: number) => {
      const material = new Uint8Array(keyBytes + 5)
      material.set(fileKey)
      material.set(
        [number & 0xff, (number >> 8) & 0xff, (number >> 16) & 0xff, generation & 0xff, 0],
        keyBytes,
      )

      return md5(material).subarray(0, Math.min(keyBytes + 5, 16))
    }

    const hex = (value: Uint8Array) =>
      [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')

    // Every string and stream, encrypted in place. The document is written with
    // `useObjectStreams: false`, so every object is at the top level and each is
    // exactly one span in the file. The dictionary and the payload are split
    // first: a `(...)` pattern inside compressed stream data is not a string.
    let text = new TextDecoder('latin1').decode(source)
    const encrypted = text.replace(
      /(\d+) (\d+) obj([\s\S]*?)endobj/g,
      (_whole, number: string, generation: string, body: string) => {
        const key = objectKey(Number(number), Number(generation))
        // Both spellings, because pdf-lib writes the ASCII strings as literals
        // and the UTF-16 ones as hex — and a real encryptor encrypts both. The
        // hex branch demands a leading hex digit and no `<` in front, which is
        // what keeps it off a `<<` dictionary opener.
        const encryptStrings = (part: string) =>
          part.replace(
            /\(([^()\\]*)\)|(?<!<)<([0-9a-fA-F][0-9a-fA-F\s]*)>/g,
            (_match, literal: string | undefined, hexDigits: string | undefined) => {
              const plain =
                literal === undefined
                  ? new Uint8Array(
                      ((hexDigits ?? '').replace(/\s/g, '').match(/../g) ?? []).map((pair) =>
                        Number.parseInt(pair, 16),
                      ),
                    )
                  : new Uint8Array([...literal].map((c) => c.charCodeAt(0)))

              return `<${hex(rc4(key, plain))}>`
            },
          )

        const opening = /stream\r?\n/.exec(body)
        if (opening === null) return `${number} ${generation} obj${encryptStrings(body)}endobj`

        const dataStart = opening.index + opening[0].length
        const dataEnd = body.lastIndexOf('endstream')
        const trailingEol = body.slice(dataEnd - 2, dataEnd) === '\r\n' ? 2 : 1
        const payload = body.slice(dataStart, dataEnd - trailingEol)
        const cipher = rc4(key, new Uint8Array([...payload].map((c) => c.charCodeAt(0))))

        return (
          `${number} ${generation} obj` +
          encryptStrings(body.slice(0, opening.index)) +
          opening[0] +
          String.fromCharCode(...cipher) +
          body.slice(dataEnd - trailingEol) +
          'endobj'
        )
      },
    )

    // A trailer that names the encryption dictionary and the document id. The
    // cross-reference table is now wrong, and the unlocker never reads it: it
    // scans for objects, exactly as it does for a real encrypted file.
    const encryptObject =
      `\n999 0 obj\n<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${permissions} ` +
      `/O <${hex(ownerValue)}> /U <${hex(user)}> >>\nendobj\n`
    text = encrypted.replace(
      /trailer[\s]*<</,
      `${encryptObject}trailer\n<< /Encrypt 999 0 R /ID [<${hex(id0)}> <${hex(id0)}>] `,
    )

    return new Uint8Array([...text].map((c) => c.charCodeAt(0) & 0xff))
  }

  it('opens a revision 3 RC4 document and hands back a readable one', async () => {
    const plain = await PDFDocument.create()
    plain.setTitle(TITLE)
    plain.addPage([200, 300]).drawRectangle({ x: 5, y: 5, width: 20, height: 20 })
    const source = await plain.save({ useObjectStreams: false })

    const locked = await encryptWithRc4(source, 'legacy')
    const unlocked = await unlockPdf(
      job([new Blob([locked as Uint8Array<ArrayBuffer>])], { unlock: { password: 'legacy' } }),
      running(),
      quiet,
    )

    const document = await PDFDocument.load(await bytesOf(unlocked), {
      throwOnInvalidObject: false,
    })
    expect(document.getTitle()).toBe(TITLE)
    expect(document.getPageCount()).toBe(1)
  })

  it('refuses the wrong password for a legacy document too', async () => {
    const plain = await PDFDocument.create()
    plain.addPage([200, 300])
    const locked = await encryptWithRc4(await plain.save({ useObjectStreams: false }), 'legacy')

    await expect(
      unlockPdf(
        job([new Blob([locked as Uint8Array<ArrayBuffer>])], { unlock: { password: 'nope' } }),
        running(),
        quiet,
      ),
    ).rejects.toThrow(/does not open this PDF/)
  })
})
