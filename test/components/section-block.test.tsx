import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SectionBlock, sectionBlockVariants } from '@/components/blocks/section-block'
import { COLOURS, contrastRatio, globalsCss, RADII } from '../support/tokens'

/*
 * SectionBlock — the page is a stack of alternating light and dark blocks, each
 * one rounded and inset from the shell background (issue #16).
 *
 * The acceptance criterion was filed as `rounded-[28px]` and "inset 12px mobile
 * / 24px from sm up". Arbitrary values are forbidden by CLAUDE.md section 3, so
 * the numbers are asserted through the scales that produce them: the radius via
 * the `--radius-xl` token, the inset via Tailwind's 4px spacing step. If a token
 * is retuned the assertion follows it instead of contradicting it.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The component source, comments stripped — prohibitions are asserted on it. */
const source = readFileSync(join(repoRoot, 'components', 'blocks', 'section-block.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

/** The value of a `--radius-*` step as declared in app/globals.css. */
function radius(step: string): string {
  const declared = globalsCss.match(new RegExp(`--radius-${step}\\s*:\\s*([^;]+);`))?.[1]

  expect(declared, `app/globals.css declares no --radius-${step}`).toBeDefined()
  return (declared as string).trim()
}

/** The suffix of a `<prefix>-<value>` utility on the element, if it carries one. */
function utility(className: string, prefix: string, variant = ''): string | undefined {
  return className.match(new RegExp(`(?:^|\\s)${variant}${prefix}-([a-z0-9-]+)`))?.[1]
}

function renderBlock(props: Parameters<typeof SectionBlock>[0] = {}): HTMLElement {
  render(<SectionBlock aria-label="Block" {...props} />)
  return screen.getByRole('region', { name: 'Block' })
}

describe('SectionBlock', () => {
  it('renders a section carrying its children', () => {
    render(
      <SectionBlock aria-label="Privacy">
        <h2>Nothing leaves your device</h2>
      </SectionBlock>,
    )
    const block = screen.getByRole('region', { name: 'Privacy' })

    expect(block.tagName).toBe('SECTION')
    expect(block).toContainElement(
      screen.getByRole('heading', { name: 'Nothing leaves your device' }),
    )
  })

  it('rounds its corners with the radius token that resolves to 28px', () => {
    const step = utility(renderBlock().className, 'rounded')

    expect(step, 'no rounded utility').toBeDefined()
    expect(RADII, `rounded-${step} is not a declared radius step`).toContain(step)
    expect(radius(step as string)).toBe('28px')
  })

  /*
   * Tailwind's spacing scale is 4px per step, so the filed 12px / 24px inset is
   * `mx-3` / `sm:mx-6`. Deriving the pixels from the step keeps the criterion
   * legible without writing an arbitrary value into the component.
   */
  it('insets itself 12px from the shell, and 24px from sm up', () => {
    const className = renderBlock().className

    const base = utility(className, 'mx')
    const small = utility(className, 'mx', 'sm:')

    expect(base, 'no horizontal inset').toBeDefined()
    expect(small, 'no sm: horizontal inset').toBeDefined()
    expect(Number(base) * 4).toBe(12)
    expect(Number(small) * 4).toBe(24)
  })

  /*
   * The block owns the gutter between its border and its content. Leaving that
   * to every caller would put the padding decision in six places and let two
   * blocks in the same stack disagree.
   */
  it('pads its content off its own border, and more so from sm up', () => {
    const className = renderBlock().className

    const base = utility(className, 'p')
    const small = utility(className, 'p', 'sm:')

    expect(base, 'no padding').toBeDefined()
    expect(small, 'no sm: padding').toBeDefined()
    expect(Number(small)).toBeGreaterThan(Number(base))
  })

  it('is a flat fill with a 1px border and no shadow', () => {
    const className = renderBlock().className

    // A bare `border` is Tailwind's 1px width; any `border-2`/`border-4` is not.
    expect(className).toMatch(/(?:^|\s)border(?:\s|$)/)
    expect(className).not.toMatch(/\bborder-\d+\b/)
    expect(className).not.toMatch(/\bshadow(-|\b)/)
  })

  describe.each(['light', 'dark'] as const)('the %s variant', (variant) => {
    it('draws its fill, border and text from the @theme palette', () => {
      const className = sectionBlockVariants({ variant })

      for (const prefix of ['bg', 'text', 'border']) {
        const value = utility(className, prefix)

        expect(value, `${variant} sets no ${prefix} colour`).toBeDefined()
        expect(
          COLOURS.has(value as string),
          `${prefix}-${value} is not a colour token in app/globals.css`,
        ).toBe(true)
      }
    })

    it('keeps its body text legible on its own fill', () => {
      const className = sectionBlockVariants({ variant })
      const fill = utility(className, 'bg') as string
      const text = utility(className, 'text') as string

      expect(contrastRatio(text, fill), `text-${text} on bg-${fill}`).toBeGreaterThanOrEqual(4.5)
    })
  })

  it('inverts between the two variants, so a stack alternates', () => {
    const light = sectionBlockVariants({ variant: 'light' })
    const dark = sectionBlockVariants({ variant: 'dark' })

    expect(utility(dark, 'bg')).not.toBe(utility(light, 'bg'))
    expect(utility(dark, 'text')).not.toBe(utility(light, 'text'))
    expect(utility(dark, 'border')).not.toBe(utility(light, 'border'))
  })

  it('defaults to the light variant', () => {
    expect(renderBlock().className).toContain(
      utility(sectionBlockVariants({ variant: 'light' }), 'bg') as string,
    )
  })

  it('lets a caller override a base utility through cn', () => {
    const className = renderBlock({ className: 'rounded-none' }).className

    expect(className).toContain('rounded-none')
    expect(className).not.toContain('rounded-xl')
  })

  it('forwards the remaining props to the section', () => {
    render(
      <SectionBlock id="privacy" aria-labelledby="privacy-title" data-testid="block">
        <h2 id="privacy-title">Privacy</h2>
      </SectionBlock>,
    )
    const block = screen.getByTestId('block')

    expect(block).toHaveAttribute('id', 'privacy')
    expect(block).toHaveAttribute('aria-labelledby', 'privacy-title')
  })

  it('renders as the child element when asChild is set', () => {
    render(
      <SectionBlock asChild>
        <footer aria-label="Site footer" />
      </SectionBlock>,
    )
    const footer = screen.getByRole('contentinfo', { name: 'Site footer' })

    expect(footer.tagName).toBe('FOOTER')
    expect(footer.className).toContain('rounded-xl')
  })

  /*
   * The design prohibitions of CLAUDE.md section 3, asserted on the source
   * rather than on a rendered variant: a violation in a branch no test happens
   * to render is still a violation. Issue #19 will add the lint rule; until it
   * lands this file is the only thing enforcing them here.
   */
  describe('design prohibitions', () => {
    it('carries no decorative shadow', () => {
      expect(source).not.toMatch(/\bshadow(-|\b)/)
      expect(source).not.toMatch(/\bdrop-shadow/)
    })

    it('carries no focus ring utility', () => {
      expect(source).not.toMatch(/\bring(-|\/|\b)/)
    })

    it('carries no glassmorphism', () => {
      expect(source).not.toMatch(/backdrop-(?:blur|filter|saturate)/)
      expect(source).not.toMatch(/\bbg-[a-z0-9-]+\/\d+/)
    })

    it('carries no gradient', () => {
      expect(source).not.toMatch(/gradient/i)
      expect(source).not.toMatch(/\b(?:from|via|to)-[a-z]+-\d{2,3}\b/)
    })

    it('carries no blue or purple hue', () => {
      expect(source).not.toMatch(/\b(?:blue|indigo|violet|purple|fuchsia|sky|cyan)\b/i)
    })

    it('carries no raw hex colour', () => {
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    })

    it('carries no arbitrary value', () => {
      // `rounded-[28px]`, `mx-[12px]`, `bg-[#0d0d0d]` — the scales exist so that
      // none of these has to be written by hand.
      expect(source).not.toMatch(/\b[a-z-]+-\[[^\]]+\]/)
    })

    it("uses none of shadcn's default colour variables", () => {
      expect(source).not.toMatch(
        /\b(?:bg|text|border|outline|fill|stroke|ring|from|via|to)-(?:primary|secondary|background|foreground|muted|accent|popover|card|destructive|input|ring|border)\b/,
      )
    })
  })
})
