import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { findViolations, THEME_FILE } from '../scripts/design-lint/rules.mjs'
import { collectFiles, scanSurface, SURFACE_ROOTS } from '../scripts/design-lint/scan.mjs'

/*
 * The design-prohibition gate (issue #19).
 *
 * CLAUDE.md section 3 forbids glassmorphism, blue and purple hues, decorative
 * gradients and raw hex codes outside the `@theme` palette. Until now those
 * rules were enforced by review and by a per-file assertion over
 * components/ui — neither of which sees a violation added to app/ or to a new
 * stylesheet. This gate reads the whole product surface and fails `pnpm lint`.
 *
 * The rules are tested on strings rather than on fixture files on disk: a
 * fixture that violates the prohibitions would itself have to be excluded from
 * the scan, and an exclusion is exactly the hole the gate exists to close.
 */

/** Rule ids reported for a source, in order. */
function rulesFor(path: string, source: string): string[] {
  return findViolations(path, source).map((violation) => violation.rule)
}

describe('no-glassmorphism', () => {
  it('flags a backdrop-blur utility', () => {
    expect(rulesFor('components/x.tsx', '<div className="backdrop-blur-sm" />')).toEqual([
      'no-glassmorphism',
    ])
  })

  it('flags the backdrop-filter property in CSS', () => {
    expect(rulesFor('app/x.css', '.panel { backdrop-filter: blur(8px); }')).toEqual([
      'no-glassmorphism',
    ])
  })

  it('flags the utility behind a supports- variant', () => {
    const source = '<div className="supports-backdrop-filter:backdrop-blur-xs" />'
    expect(rulesFor('components/x.tsx', source)).toHaveLength(2)
  })

  it('does not flag prose naming the prohibition in a comment', () => {
    // components/ui/dialog.tsx documents the shadcn default it strips, in
    // exactly these words. Flagging it would make the gate unusable.
    const source = '/* strips `supports-backdrop-filter:backdrop-blur-xs` — glassmorphism */\n'
    expect(rulesFor('components/x.tsx', source)).toEqual([])
  })

  it('does not flag a line comment naming the prohibition', () => {
    expect(rulesFor('components/x.tsx', '// no backdrop-filter here\n')).toEqual([])
  })
})

describe('no-banned-hue', () => {
  it('flags a blue gradient stop', () => {
    expect(rulesFor('components/x.tsx', '<div className="from-blue-500" />')).toEqual([
      'no-banned-hue',
    ])
  })

  it('flags a purple gradient stop', () => {
    expect(rulesFor('components/x.tsx', '<div className="to-purple-600" />')).toEqual([
      'no-banned-hue',
    ])
  })

  it('flags every banned family, not just blue and purple', () => {
    const source = 'via-indigo-400 bg-violet-50 text-fuchsia-700 border-sky-200 ring-cyan-300'
    expect(rulesFor('components/x.tsx', source)).toEqual(Array(5).fill('no-banned-hue'))
  })

  it('flags a named blue in a CSS declaration', () => {
    expect(rulesFor('app/x.css', '.a { color: rebeccapurple; }')).toEqual(['no-banned-hue'])
  })

  it('does not flag a palette token that merely ends in a colour word', () => {
    expect(rulesFor('components/x.tsx', '<div className="bg-ink-2 text-fg-dark-mut" />')).toEqual(
      [],
    )
  })

  it('does not flag the word blue in prose', () => {
    expect(rulesFor('components/x.tsx', '/* no blue or purple anywhere */\n')).toEqual([])
  })
})

describe('no-gradient', () => {
  it('flags a Tailwind v3 gradient utility', () => {
    expect(rulesFor('components/x.tsx', '<div className="bg-gradient-to-r" />')).toEqual([
      'no-gradient',
    ])
  })

  it('flags a Tailwind v4 gradient utility', () => {
    expect(rulesFor('components/x.tsx', '<div className="bg-linear-to-br" />')).toEqual([
      'no-gradient',
    ])
  })

  it('flags a CSS gradient function', () => {
    expect(rulesFor('app/x.css', '.a { background: linear-gradient(#000, #fff); }')).toContain(
      'no-gradient',
    )
  })

  it('does not flag the word gradient in a comment', () => {
    expect(rulesFor('components/x.tsx', '/* no shadow, no ring, no gradient sweep */\n')).toEqual(
      [],
    )
  })
})

describe('no-arrow-glyph', () => {
  // The shipped latin subset has no U+2192, so a text arrow renders in whatever
  // fallback face the browser picks — different metrics on every platform.
  it('flags the right arrow CLAUDE.md section 3 puts on the primary button', () => {
    expect(rulesFor('components/ui/button.tsx', `<span>Convert →</span>`)).toContain(
      'no-arrow-glyph',
    )
  })

  it('flags the rest of the block, not just the one character', () => {
    expect(rulesFor('components/x.tsx', `<p>← back</p>`)).toContain('no-arrow-glyph')
    expect(rulesFor('components/x.tsx', `<p>a ↔ b</p>`)).toContain('no-arrow-glyph')
  })

  it('flags one written as a CSS content string', () => {
    expect(rulesFor('app/globals.css', `.x::after { content: '→'; }`)).toContain('no-arrow-glyph')
  })

  it('does not flag prose in a comment, where the engines write theirs', () => {
    expect(rulesFor('lib/engines/bmp.ts', `// images → PDF costs more than it looks`)).toEqual([])
    expect(rulesFor('lib/router/types.ts', `/** the from → to triple */`)).toEqual([])
  })

  it('does not flag an inline SVG, which is the way an arrow is meant to ship', () => {
    expect(rulesFor('components/ui/button.tsx', '<ArrowRight aria-hidden="true" />')).toEqual([])
  })
})

describe('no-raw-hex', () => {
  it('flags a hex code in a CSS rule', () => {
    expect(rulesFor('app/x.css', '.a { color: #7c3aed; }')).toEqual(['no-raw-hex'])
  })

  it('allows a hex code inside the @theme block of the palette file', () => {
    const source = '@theme {\n  --color-ink: #0d0d0d;\n}\n'
    expect(rulesFor(THEME_FILE, source)).toEqual([])
  })

  it('flags a hex code outside the @theme block of the palette file', () => {
    const source = '@theme {\n  --color-ink: #0d0d0d;\n}\n\n.a {\n  color: #ff0000;\n}\n'
    expect(rulesFor(THEME_FILE, source)).toEqual(['no-raw-hex'])
  })

  it('flags a hex code in a @theme block declared by any other stylesheet', () => {
    // The palette has one home. A second @theme block would be a second source
    // of truth, and app/globals.css is the one the tests read.
    expect(rulesFor('components/x.css', '@theme {\n  --color-x: #123456;\n}\n')).toEqual([
      'no-raw-hex',
    ])
  })

  it('flags a hex code in a Tailwind arbitrary value', () => {
    expect(rulesFor('components/x.tsx', '<div className="bg-[#7c3aed]" />')).toEqual(['no-raw-hex'])
  })

  it('flags a hex code used as an inline style value', () => {
    expect(rulesFor('components/x.tsx', "<div style={{ color: '#fff' }} />")).toEqual([
      'no-raw-hex',
    ])
  })

  it('does not flag an issue reference in a comment', () => {
    // app/fonts.ts carries `Tracked in issue #124`, which is three hex digits.
    expect(rulesFor('app/x.ts', '// Tracked in issue #124.\n')).toEqual([])
  })

  it('does not flag a fragment inside a longer string', () => {
    expect(rulesFor('app/x.ts', "const href = 'https://example.com/#124'\n")).toEqual([])
  })

  it('does not flag a run of hex digits that is not a colour length', () => {
    expect(rulesFor('app/x.css', '/* */\n.a { content: "#12345"; }')).toEqual([])
  })
})

describe('violation positions', () => {
  it('reports a 1-based line and column and the offending text', () => {
    const source = '.a {\n  color: red;\n}\n\n.b {\n  backdrop-filter: blur(2px);\n}\n'
    expect(findViolations('app/x.css', source)).toEqual([
      expect.objectContaining({
        rule: 'no-glassmorphism',
        line: 6,
        column: 3,
        text: 'backdrop-filter',
      }),
    ])
  })
})

describe('the scanned surface', () => {
  it('covers the directories that hold styling', () => {
    expect(SURFACE_ROOTS).toEqual(['app', 'components', 'lib'])
  })

  it('includes the palette file and every component', () => {
    const files = collectFiles()
    expect(files).toContain(THEME_FILE)
    expect(files).toContain('components/ui/button.tsx')
  })

  it('does not reach into the tests or the scripts that describe the prohibitions', () => {
    const files = collectFiles()
    expect(files.filter((file) => file.startsWith('test/') || file.startsWith('scripts/'))).toEqual(
      [],
    )
  })

  it('finds no violation in the repository as it stands', () => {
    expect(scanSurface()).toEqual([])
  })
})

describe('the CI wiring', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const scripts = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts

  /*
   * The acceptance criterion for issue #19 is that CI *fails*. A checker no
   * job runs is decoration, and `lint` is the job that already exists.
   */
  it('runs the gate as part of pnpm lint', () => {
    expect(scripts.lint).toContain('lint:design')
    expect(scripts['lint:design']).toContain('scripts/design-lint/cli.mjs')
  })
})
