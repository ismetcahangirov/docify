import { describe, expect, it } from 'vitest'

import { acceptFor, ALL_FORMATS, formatMeta } from '@/lib/registry/formats'

/*
 * What a file picker is told to show (issue #272).
 *
 * A format is not one extension. The same container arrives as `.heic` from an
 * iPhone and `.heif` from an Android export, and a picker built from the single
 * canonical suffix hides the second one behind "All files" — which reads as the
 * tool not supporting the file at all. The engines sniff bytes, so the only
 * thing an alias changes is whether the user can see their own file.
 */

describe('acceptFor', () => {
  it('is the MIME type and the extension for a format with one of each', () => {
    expect(acceptFor(formatMeta('png'))).toBe('image/png,.png')
  })

  it('shows an Android or macOS `.heif` on the HEIC pages', () => {
    const accept = acceptFor(formatMeta('heic'))

    expect(accept).toContain('.heif')
    expect(accept).toContain('image/heif')
    // The canonical pair still comes first: a picker lists them in order.
    expect(accept.startsWith('image/heic,.heic')).toBe(true)
  })

  it('shows the spellings people actually have on disk', () => {
    // `.jpeg` predates the eight-character filename and never went away;
    // `.tiff` is the spelling every scanner writes.
    expect(acceptFor(formatMeta('jpg'))).toContain('.jpeg')
    expect(acceptFor(formatMeta('tiff'))).toContain('.tiff')
  })

  it('never repeats a token, because a picker would list it twice', () => {
    for (const format of ALL_FORMATS) {
      const tokens = acceptFor(format).split(',')

      expect(new Set(tokens).size).toBe(tokens.length)
    }
  })

  it('produces a comma-separated list with nothing empty in it', () => {
    for (const format of ALL_FORMATS) {
      for (const token of acceptFor(format).split(',')) {
        expect(token).toMatch(/^(?:\.[a-z0-9]+|[a-z]+\/[a-z0-9.+-]+)$/)
      }
    }
  })
})
