// @vitest-environment node

/**
 * Packing a batch of results into one download (issue #61).
 *
 * The zipper is injected throughout. In a browser it is fflate's asynchronous
 * `zip`, which does the work on a thread of its own — a hundred converted photos
 * is hundreds of megabytes of memcpy, and CLAUDE.md §2.2 does not stop applying
 * because the bytes are already converted. A test that used the real one would
 * be asserting against fflate.
 */

import { describe, expect, it, vi } from 'vitest'

import { zipResults } from '@/lib/queue/batch-zip'
import type { ConversionResult } from '@/lib/queue/results'

const result = (name: string, body = 'x'): ConversionResult => ({
  id: name,
  name,
  blob: new Blob([body], { type: 'image/jpeg' }),
  bytes: body.length,
})

/** A fresh spy per test: one of them asserts the zipper was never reached. */
const zipper = () => vi.fn(async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]))

describe('zipResults', () => {
  it('hands the zipper one entry per result, keyed by its download name', async () => {
    const zip = vi.fn(async () => new Uint8Array([1]))
    await zipResults([result('a.jpg', 'aa'), result('b.jpg', 'bbb')], zip)

    const [entries] = zip.mock.calls[0] as unknown as [Record<string, Uint8Array>]

    expect(Object.keys(entries)).toEqual(['a.jpg', 'b.jpg'])
    expect(entries['a.jpg']).toEqual(new Uint8Array([97, 97]))
    expect(entries['b.jpg']?.byteLength).toBe(3)
  })

  it('answers with a ZIP blob', async () => {
    const archive = await zipResults([result('a.jpg')], zipper())

    expect(archive.type).toBe('application/zip')
    expect(archive.size).toBe(4)
  })

  /*
   * A zero-entry archive downloads, opens, and shows the user nothing. The
   * button that reaches this is hidden with fewer than two results, so arriving
   * here at all is a bug worth naming rather than a file worth shipping.
   */
  it('refuses to write an archive with nothing in it', async () => {
    const zip = zipper()

    await expect(zipResults([], zip)).rejects.toThrow(/empty/i)
    expect(zip).not.toHaveBeenCalled()
  })
})
