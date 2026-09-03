import { describe, expect, it } from 'vitest'

import { OG_COLOURS } from '@/lib/seo/og-theme'

import { COLOURS } from '../support/tokens'

/*
 * The social cards' palette against the real one (issue #72).
 *
 * `lib/seo/og-theme.ts` is the one module outside app/globals.css that may name
 * a colour, because satori resolves no custom properties — see its header. The
 * exception is only safe while the transcription is checked, and this is the
 * check: every value there is read back out of the `@theme` block it was copied
 * from, so a token that is renamed or re-tuned fails here rather than shipping
 * an off-brand card nobody looks at until it is on someone's timeline.
 */

describe('the raster palette', () => {
  it('copies a colour that actually exists in the theme', () => {
    for (const token of Object.keys(OG_COLOURS)) {
      expect({ token, declared: COLOURS.has(token) }).toEqual({ token, declared: true })
    }
  })

  it('copies each of them exactly', () => {
    for (const [token, value] of Object.entries(OG_COLOURS)) {
      expect({ token, value }).toEqual({ token, value: COLOURS.get(token) })
    }
  })

  it('draws on the dark palette, which is what the cards are built out of', () => {
    // Not an arbitrary subset: a card is the hero block of a page, and the hero
    // is `variant="dark"`. Naming the expectation keeps a light-palette colour
    // from being added here without the design decision being made first.
    expect(Object.keys(OG_COLOURS).sort()).toEqual([
      'fg-dark',
      'fg-dark-mut',
      'ink',
      'ink-2',
      'line-dark',
    ])
  })
})
