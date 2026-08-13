import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const globalsCss = readFileSync(join(repoRoot, 'app', 'globals.css'), 'utf8')

const declarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the single top-level `@theme { ... }` block, comments removed. */
const themeBlock = (() => {
  const opening = declarations.indexOf('@theme')
  if (opening === -1) return null

  const start = declarations.indexOf('{', opening)
  if (start === -1) return null

  let depth = 0
  for (let i = start; i < declarations.length; i += 1) {
    if (declarations[i] === '{') depth += 1
    if (declarations[i] === '}') {
      depth -= 1
      if (depth === 0) return declarations.slice(start + 1, i)
    }
  }

  return null
})()

/** Every custom property declared directly inside `@theme`, keyed by name. */
const tokens = new Map<string, string>(
  (themeBlock ?? '')
    .split(';')
    .map((declaration) => declaration.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => [match[1], match[2].trim().replace(/\s+/g, ' ')]),
)

const COLOUR_TOKENS: ReadonlyArray<readonly [string, string]> = [
  // Surfaces
  ['--color-shell', '#E9E8E4'],
  ['--color-paper', '#F7F7F5'],
  ['--color-paper-2', '#EFEEEA'],
  ['--color-ink', '#0D0D0D'],
  ['--color-ink-2', '#171717'],
  ['--color-ink-3', '#1F1F1F'],
  // Borders
  ['--color-line-light', '#DCDBD6'],
  ['--color-line-dark', '#262626'],
  // Text
  ['--color-fg-light', '#0A0A0A'],
  ['--color-fg-light-mut', '#6B6A66'],
  ['--color-fg-dark', '#FAFAF9'],
  ['--color-fg-dark-mut', '#9B9A96'],
  // Functional status
  ['--color-ok', '#3F7D4E'],
  ['--color-warn', '#B4762A'],
  ['--color-err', '#A83A2E'],
]

const RADIUS_TOKENS: ReadonlyArray<readonly [string, string]> = [
  ['--radius-sm', '8px'],
  ['--radius-md', '14px'],
  ['--radius-lg', '20px'],
  ['--radius-xl', '28px'],
]

/**
 * The self-hosted families are exposed on `<html>` as `--font-archivo`,
 * `--font-inter` and `--font-jetbrains-mono`. The generic has to sit *inside*
 * `var()`: a reference to an undefined property invalidates the declaration at
 * computed-value time, discarding anything listed after it.
 */
const FONT_TOKENS: ReadonlyArray<readonly [string, string]> = [
  ['--font-display', 'var(--font-archivo, ui-sans-serif), system-ui, sans-serif'],
  ['--font-sans', 'var(--font-inter, ui-sans-serif), system-ui, sans-serif'],
  ['--font-mono', 'var(--font-jetbrains-mono, ui-monospace), monospace'],
]

/** The typography scale from the plan: size, line height, tracking, weight. */
const TEXT_SCALE: ReadonlyArray<readonly [string, string, string, string, string]> = [
  ['display', 'clamp(2.75rem, 9vw, 6rem)', '0.9', '-0.03em', '800'],
  ['h2', 'clamp(1.75rem, 4.5vw, 3rem)', '0.95', '-0.02em', '700'],
  ['h3', '1.125rem', '1.3', '-0.01em', '600'],
  ['eyebrow', '0.75rem', '1', '0.18em', '500'],
  ['body', '0.9375rem', '1.65', '0em', '400'],
  ['stat', '2.25rem', '1', '-0.02em', '700'],
  ['tech', '0.8125rem', '1.4', '0em', '400'],
]

describe('app/globals.css design tokens', () => {
  it('imports Tailwind and declares a @theme block', () => {
    expect(globalsCss).toMatch(/@import\s+['"]tailwindcss['"]/)
    expect(themeBlock).not.toBeNull()
  })

  describe('colour tokens', () => {
    it.each(COLOUR_TOKENS)('declares %s as %s', (name, value) => {
      expect(tokens.get(name)?.toUpperCase()).toBe(value)
    })

    it('declares no colour token outside the documented palette', () => {
      const declared = [...tokens.keys()].filter((name) => name.startsWith('--color-'))
      const documented = COLOUR_TOKENS.map(([name]) => name)

      expect(declared.sort()).toEqual([...documented].sort())
    })
  })

  describe('typography tokens', () => {
    it.each(FONT_TOKENS)('declares %s as the full stack %s', (name, stack) => {
      expect(tokens.get(name)).toBe(stack)
    })

    it('declares no font family token outside the three documented stacks', () => {
      const declared = [...tokens.keys()].filter((name) => name.startsWith('--font-'))
      const documented = FONT_TOKENS.map(([name]) => name)

      expect(declared.sort()).toEqual([...documented].sort())
    })

    it('declares no type scale step outside the documented scale', () => {
      const declared = [...tokens.keys()].filter(
        // Base steps only: `--text-h2` but not `--text-h2--line-height`.
        (name) => name.startsWith('--text-') && !name.slice('--text-'.length).includes('--'),
      )
      const documented = TEXT_SCALE.map(([step]) => `--text-${step}`)

      expect(declared.sort()).toEqual([...documented].sort())
    })

    it.each(TEXT_SCALE)(
      'declares the %s step of the type scale',
      (step, size, lineHeight, tracking, weight) => {
        expect(tokens.get(`--text-${step}`)).toBe(size)
        expect(tokens.get(`--text-${step}--line-height`)).toBe(lineHeight)
        expect(tokens.get(`--text-${step}--letter-spacing`)).toBe(tracking)
        expect(tokens.get(`--text-${step}--font-weight`)).toBe(weight)
      },
    )
  })

  describe('radius tokens', () => {
    it.each(RADIUS_TOKENS)('declares %s as %s', (name, value) => {
      expect(tokens.get(name)).toBe(value)
    })

    it('declares no radius token outside the documented scale', () => {
      const declared = [...tokens.keys()].filter((name) => name.startsWith('--radius-'))
      const documented = RADIUS_TOKENS.map(([name]) => name)

      expect(declared.sort()).toEqual([...documented].sort())
    })
  })

  // Narrow on purpose: this only guards globals.css. CLAUDE.md section 3 bans
  // raw hex across the whole codebase, and that is an ESLint rule's job
  // (EPIC 2 task 2.7), not this file's.
  it('declares raw hex colours only inside the @theme block', () => {
    const outsideTheme = declarations.replace(themeBlock ?? '', '')

    expect(outsideTheme).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
