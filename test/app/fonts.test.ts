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

  it('combines the three variables into a single className for <html>', () => {
    expect(fontVariables).toBe(`${archivo.variable} ${inter.variable} ${jetbrainsMono.variable}`)
    expect(fontVariables.split(' ')).toHaveLength(3)
  })
})
