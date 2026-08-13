import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

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

const { archivo, fontVariables, inter, jetbrainsMono } = await import('@/app/fonts')

// app/fonts.ts resolves every `src` relative to its own directory.
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../app')

const [archivoCall, interCall, monoCall] = fontCalls

describe('app/fonts', () => {
  it('declares exactly the three families the design system uses', () => {
    expect(fontCalls).toHaveLength(3)
  })

  it('exposes the CSS variable names app/globals.css maps to design tokens', () => {
    expect(fontCalls.map((call) => call.variable)).toEqual([
      '--font-archivo',
      '--font-inter',
      '--font-jetbrains-mono',
    ])
  })

  it('swaps rather than blocking the first paint', () => {
    for (const call of fontCalls) {
      expect(call.display).toBe('swap')
    }
  })

  it('preloads every family', () => {
    for (const call of fontCalls) {
      expect(call.preload).toBe(true)
    }
  })

  it('serves every face from a file inside the repository, never a remote URL', () => {
    const paths = fontCalls.flatMap((call) => call.src.map((source) => source.path))

    expect(paths.length).toBeGreaterThanOrEqual(3)

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
      { path: '../public/fonts/archivo-latin-variable.woff2', weight: '100 900', style: 'normal' },
    ])
    expect(interCall.src).toEqual([
      { path: '../public/fonts/inter-latin-variable.woff2', weight: '100 900', style: 'normal' },
    ])
    expect(monoCall.src).toEqual([
      { path: '../public/fonts/jetbrains-mono-latin-400.woff2', weight: '400', style: 'normal' },
    ])
  })

  it('ends each fallback stack in the right generic family', () => {
    expect(archivoCall.fallback?.at(-1)).toBe('sans-serif')
    expect(interCall.fallback?.at(-1)).toBe('sans-serif')
    expect(monoCall.fallback?.at(-1)).toBe('monospace')
  })

  // Next's metric-adjusted fallback is a local("Arial") face, which resolves
  // almost everywhere and would shadow the monospace stack entirely.
  it('keeps the Arial-based metric fallback away from the monospace family', () => {
    expect(monoCall.adjustFontFallback).toBe(false)
    expect(archivoCall.adjustFontFallback).toBeUndefined()
    expect(interCall.adjustFontFallback).toBeUndefined()
  })

  it('combines all three variables into a single className for <html>', () => {
    const classNames = fontVariables.split(' ')

    expect(classNames).toHaveLength(3)
    expect(classNames).toContain(archivo.variable)
    expect(classNames).toContain(inter.variable)
    expect(classNames).toContain(jetbrainsMono.variable)
  })
})
