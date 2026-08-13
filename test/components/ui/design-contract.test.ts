import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * The retuning contract for the shadcn primitives (issue #15).
 *
 * shadcn ships its components against its own `--primary` / `--background` /
 * `--ring` variables and decorates them with shadows, focus rings and default
 * radii. CLAUDE.md section 3 forbids all of that: every colour has to come from
 * the `@theme` palette in app/globals.css, surfaces are flat fill plus a 1px
 * border, and there are no decorative shadows or glows.
 *
 * These assertions read the component sources rather than the rendered output
 * because that is where the violation would live — a stray `shadow-xs` in a
 * variant that no test happens to render is still a violation.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const uiDir = join(repoRoot, 'components', 'ui')

const EXPECTED_COMPONENTS = ['button.tsx', 'dialog.tsx', 'progress.tsx']

/** Source of every file under components/ui, with comments stripped. */
const sources = EXPECTED_COMPONENTS.map((file) => {
  const raw = readFileSync(join(uiDir, file), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  return [file, code] as const
})

/** The complete colour palette declared in app/globals.css. */
const PALETTE = [
  'shell',
  'paper',
  'paper-2',
  'ink',
  'ink-2',
  'ink-3',
  'line-light',
  'line-dark',
  'fg-light',
  'fg-light-mut',
  'fg-dark',
  'fg-dark-mut',
  'ok',
  'warn',
  'err',
]

/**
 * Suffixes that share a prefix with a colour utility but carry no colour:
 * the type scale (`text-h3`), the font stacks (`font-sans` is not matched, but
 * `text-…` steps are), keywords and bare numeric widths.
 */
const NON_COLOUR_SUFFIXES = [
  // keywords
  'transparent',
  'current',
  'inherit',
  'none',
  // type scale steps from @theme
  'display',
  'h2',
  'h3',
  'eyebrow',
  'body',
  'stat',
  'tech',
  // alignment / wrapping
  'left',
  'center',
  'right',
  'balance',
  'pretty',
  'nowrap',
  // numeric widths and offsets
  '0',
  '1',
  '2',
  '4',
  '8',
  'offset-2',
  'offset-4',
  // border sides — `border-t` is a width, not a colour
  't',
  'b',
  'l',
  'r',
  'x',
  'y',
  's',
  'e',
]

/** Every `bg-`/`text-`/`border-`/`outline-`/`fill-`/`stroke-` value in the file. */
function colourUtilities(code: string): string[] {
  const matches = code.matchAll(/\b(?:bg|text|border|outline|fill|stroke|ring)-([a-z0-9-]+)/g)
  return [...matches].map((match) => match[1])
}

describe('components/ui design contract', () => {
  it('contains exactly the three components the project has adopted', () => {
    expect(readdirSync(uiDir).sort()).toEqual([...EXPECTED_COMPONENTS].sort())
  })

  describe.each(sources)('%s', (_file, code) => {
    it('uses no decorative shadow', () => {
      expect(code).not.toMatch(/\bshadow(-|\b)/)
      expect(code).not.toMatch(/\bdrop-shadow/)
    })

    it('uses no focus ring utility', () => {
      // Focus is shown with an outline (2px, 2px offset) per the design system,
      // never with shadcn's `ring-*` glow.
      expect(code).not.toMatch(/\bring(-|\/|\b)/)
    })

    it('uses no gradient', () => {
      expect(code).not.toMatch(/gradient/i)
      expect(code).not.toMatch(/\b(?:from|via|to)-[a-z]+-\d{2,3}\b/)
    })

    it('uses no glassmorphism', () => {
      expect(code).not.toMatch(/backdrop-(?:blur|filter|saturate)/)
    })

    it('uses no blue or purple hue', () => {
      expect(code).not.toMatch(/\b(?:blue|indigo|violet|purple|fuchsia|sky|cyan)\b/i)
    })

    it('uses no raw hex colour', () => {
      expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    })

    it("uses none of shadcn's default colour variables", () => {
      expect(code).not.toMatch(
        /\b(?:bg|text|border|outline|fill|stroke|ring|from|via|to)-(?:primary|secondary|background|foreground|muted|accent|popover|card|destructive|input|ring|border)\b/,
      )
      expect(code).not.toMatch(
        /--(?:primary|background|foreground|muted|accent|popover|card|ring)\b/,
      )
    })

    it('draws every colour from the @theme palette', () => {
      const unknown = colourUtilities(code).filter(
        (value) => !PALETTE.includes(value) && !NON_COLOUR_SUFFIXES.includes(value),
      )

      expect(unknown).toEqual([])
    })

    it('uses only the documented radius scale', () => {
      const radii = [...code.matchAll(/\brounded(?:-[a-z]+)?-([a-z0-9]+)\b/g)].map((m) => m[1])
      const allowed = ['sm', 'md', 'lg', 'xl', 'full', 'none']

      expect(radii.filter((value) => !allowed.includes(value))).toEqual([])
    })

    it('never suppresses the focus indicator without replacing it', () => {
      if (/\boutline-none\b/.test(code)) {
        expect(code).toMatch(/focus-visible:outline-2/)
      }
    })
  })
})
