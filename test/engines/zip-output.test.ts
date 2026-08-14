// @vitest-environment node

import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { toZip, uniqueEntryName } from '@/lib/engines/zip-output'

const bytes = (text: string) => new TextEncoder().encode(text)

async function entriesOf(archive: Blob): Promise<Record<string, string>> {
  const unpacked = unzipSync(new Uint8Array(await archive.arrayBuffer()))
  const decoder = new TextDecoder()

  return Object.fromEntries(
    Object.entries(unpacked).map(([name, content]) => [name, decoder.decode(content)]),
  )
}

describe('toZip', () => {
  it('round-trips every entry under the name it was given', async () => {
    const archive = toZip([
      { name: 'page-1.pdf', bytes: bytes('first') },
      { name: 'page-2.pdf', bytes: bytes('second') },
    ])

    expect(await entriesOf(archive)).toEqual({ 'page-1.pdf': 'first', 'page-2.pdf': 'second' })
  })

  it('is a ZIP as far as the browser is concerned, so the download names itself', async () => {
    const archive = toZip([{ name: 'page-1.pdf', bytes: bytes('first') }])

    expect(archive.type).toBe('application/zip')
  })

  it('stores rather than deflates, because PDF and JPEG are already compressed', async () => {
    // Deflating incompressible input costs CPU on the user's phone and returns
    // bytes it cannot save. The check is indirect on purpose: what matters is
    // that the archive does not grow while trying.
    const payload = crypto.getRandomValues(new Uint8Array(64 * 1024))
    const archive = toZip([{ name: 'noise.bin', bytes: payload }])

    expect(archive.size).toBeLessThan(payload.byteLength + 1024)
  })

  it('refuses to write an empty archive, which is never a useful result', () => {
    expect(() => toZip([])).toThrow(/empty/i)
  })
})

describe('uniqueEntryName', () => {
  it('leaves a name that has not been used alone', () => {
    expect(uniqueEntryName('report.pdf', new Set())).toBe('report.pdf')
  })

  it('suffixes a collision rather than silently dropping the second entry', () => {
    const taken = new Set(['report.pdf'])

    expect(uniqueEntryName('report.pdf', taken)).toBe('report-2.pdf')
  })

  it('keeps counting when the suffixed name is taken too', () => {
    const taken = new Set(['report.pdf', 'report-2.pdf'])

    expect(uniqueEntryName('report.pdf', taken)).toBe('report-3.pdf')
  })

  it('suffixes a name with no extension', () => {
    expect(uniqueEntryName('report', new Set(['report']))).toBe('report-2')
  })
})
