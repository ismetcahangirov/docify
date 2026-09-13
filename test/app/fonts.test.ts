import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { CORE_UNICODE_RANGE } from '../../scripts/subset-fonts/ranges.mjs'

interface LocalFontSource {
  path: string
  weight?: string
  style?: string
}

interface LocalFontOptions {
  src: LocalFontSource[]
  variable: string
  display: string
  preload: boolean
  adjustFontFallback?: false | 'Arial' | 'Times New Roman'
  fallback?: string[]
  declarations?: { prop: string; value: string }[]
}

// `next/font/local` is a compiler macro — called outside a Next build it throws.
// The mock records the options every call receives, and those options *are* the
// contract this suite guards: the CSS variable names app/globals.css maps onto
// --font-display / --font-sans / --font-mono, and the on-disk woff2 files.
const { fontCalls } = vi.hoisted(() => ({ fontCalls: [] as LocalFontOptions[] }))

vi.mock('next/font/local', () => ({
  default: (options: LocalFontOptions) => {
    fontCalls.push(options)

    return {
      className: `classname-${options.variable}`,
      variable: `variable-${options.variable}`,
      style: { fontFamily: options.variable },
    }
  },
}))

const {
  archivo,
  archivoExtended,
  fontVariables,
  inter,
  interExtended,
  jetbrainsMono,
  jetbrainsMonoExtended,
} = await import('@/app/fonts')

// app/fonts.ts resolves every `src` relative to its own directory.
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../app')

const [archivoCall, archivoExtCall, interCall, interExtCall, monoCall, monoExtCall] = fontCalls

/** The half of each family that is preloaded, and the half that is not. */
const CORE_CALLS = [archivoCall, interCall, monoCall]
const EXTENDED_CALLS = [archivoExtCall, interExtCall, monoExtCall]

describe('app/fonts', () => {
  it('declares both halves of each of the three families the design system uses', () => {
    expect(fontCalls).toHaveLength(6)
  })

  it('exposes the CSS variable names app/globals.css maps to design tokens', () => {
    expect(fontCalls.map((call) => call.variable)).toEqual([
      '--font-archivo',
      '--font-archivo-ext',
      '--font-inter',
      '--font-inter-ext',
      '--font-jetbrains-mono',
      '--font-jetbrains-mono-ext',
    ])
  })

  it('swaps rather than blocking the first paint', () => {
    for (const call of fontCalls) {
      expect(call.display).toBe('swap')
    }
  })

  it('serves every face from a file inside the repository, never a remote URL', () => {
    const paths = fontCalls.flatMap((call) => call.src.map((source) => source.path))

    expect(paths).toHaveLength(6)

    for (const path of paths) {
      // The acceptance criterion of issue #14: nothing here may resolve off-origin.
      expect(path).not.toMatch(/^(https?:)?\/\//)
      expect(path).toMatch(/^\.\.\/public\/fonts\/[\w-]+\.woff2$/)
      expect(existsSync(resolve(appDir, path))).toBe(true)
    }
  })

  // A wrong weight range is invisible until a heading renders: declaring '400'
  // for a variable file makes every 700/800 heading synthetically bold instead.
  it('declares the weight range and style each file actually contains', () => {
    expect(archivoCall.src).toEqual([
      { path: '../public/fonts/archivo-latin-core.woff2', weight: '100 900', style: 'normal' },
    ])
    expect(archivoExtCall.src).toEqual([
      { path: '../public/fonts/archivo-latin-ext.woff2', weight: '100 900', style: 'normal' },
    ])
    expect(interCall.src).toEqual([
      { path: '../public/fonts/inter-latin-core.woff2', weight: '100 900', style: 'normal' },
    ])
    expect(interExtCall.src).toEqual([
      { path: '../public/fonts/inter-latin-ext.woff2', weight: '100 900', style: 'normal' },
    ])
    expect(monoCall.src).toEqual([
      { path: '../public/fonts/jetbrains-mono-latin-core.woff2', weight: '400', style: 'normal' },
    ])
    expect(monoExtCall.src).toEqual([
      { path: '../public/fonts/jetbrains-mono-latin-ext.woff2', weight: '400', style: 'normal' },
    ])
  })

  /*
   * The split of issue #315, and the three assertions that are the whole of its
   * safety.
   *
   * The point of it is the byte count before the first paint: preload the 107
   * codepoints these pages render, and let the other 123 of Google's latin
   * subset arrive only if something needs them. Get any of this wrong and the
   * failure is silent — an accented character quietly set in Arial, or 40kB
   * back on the critical path with the number still green until it is not.
   */
  describe('the two halves of each family', () => {
    it('preloads the core half and never the extended one', () => {
      for (const call of CORE_CALLS) expect(call.preload).toBe(true)
      for (const call of EXTENDED_CALLS) expect(call.preload).toBe(false)
    })

    // The Next font loader evaluates these objects statically, so the range is
    // an inline literal here and computed in scripts/subset-fonts/ranges.mjs —
    // which is also what the subsetter cut the files with. If the two ever
    // disagree, the preloaded file no longer covers what it claims to.
    it('scopes the core half to exactly the range the subsetter cut it with', () => {
      for (const call of CORE_CALLS) {
        expect(call.declarations).toEqual([{ prop: 'unicode-range', value: CORE_UNICODE_RANGE }])
      }
    })

    // No unicode-range on the extended face: it is the "everything else" tier,
    // reached only for a character the core face's range does not claim. Give
    // it one and any codepoint missing from both lists falls out of the family
    // altogether.
    it('leaves the extended half unscoped so it answers for whatever the core does not', () => {
      for (const call of EXTENDED_CALLS) {
        expect(call.declarations).toBeUndefined()
      }
    })
  })

  /*
   * Next appends the metric-adjusted fallback and the generic stack to whichever
   * face declares them, and a `local("Arial")` face carries no unicode-range —
   * so between the core and extended families it would answer for every
   * accented character and the extended file would never load. The whole tail
   * therefore hangs off the extended face, which app/globals.css puts last.
   */
  it('hangs the fallback stack off the extended half, not the core one', () => {
    for (const call of CORE_CALLS) {
      expect(call.fallback).toBeUndefined()
      expect(call.adjustFontFallback).toBe(false)
    }

    expect(archivoExtCall.fallback?.at(-1)).toBe('sans-serif')
    expect(interExtCall.fallback?.at(-1)).toBe('sans-serif')
    expect(monoExtCall.fallback?.at(-1)).toBe('monospace')
  })

  // Next's metric-adjusted fallback is a local("Arial") face, which resolves
  // almost everywhere and would shadow the monospace stack entirely.
  it('keeps the Arial-based metric fallback away from the monospace family', () => {
    expect(monoExtCall.adjustFontFallback).toBe(false)
    expect(archivoExtCall.adjustFontFallback).toBeUndefined()
    expect(interExtCall.adjustFontFallback).toBeUndefined()
  })

  it('combines all six variables into a single className for <html>', () => {
    const classNames = fontVariables.split(' ')

    expect(classNames).toHaveLength(6)
    expect(classNames).toEqual([
      archivo.variable,
      archivoExtended.variable,
      inter.variable,
      interExtended.variable,
      jetbrainsMono.variable,
      jetbrainsMonoExtended.variable,
    ])
  })
})
