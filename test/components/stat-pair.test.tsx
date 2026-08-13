import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatPair, type StatPairProps } from '@/components/blocks/stat-pair'
import { COLOURS, contrastRatio, globalsCss, RADII, TYPE_SCALE } from '../support/tokens'

/*
 * StatPair — the third of the six signature patterns (issue #18).
 *
 * A large figure and a small unit on one line, with a muted caption beneath:
 * `0 KB / sent to a server`. Every assertion about size, tracking and colour is
 * derived from the `@theme` block in app/globals.css rather than transcribed,
 * so renaming or retuning a token fails this suite instead of quietly passing.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The component source, with comments stripped — the design-contract surface. */
const source = readFileSync(join(repoRoot, 'components', 'blocks', 'stat-pair.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

/** The `--text-<step>` font size in px, read from @theme. */
function stepSizePx(step: string): number {
  const value = globalsCss.match(new RegExp(`--text-${step}:\\s*([^;]+);`))?.[1]?.trim()
  if (value === undefined) throw new Error(`app/globals.css declares no --text-${step}`)

  const rem = value.match(/^([\d.]+)rem$/)
  if (rem === null) throw new Error(`--text-${step} is not a plain rem value: ${value}`)

  return Number(rem[1]) * 16
}

/** The `--text-<step>--letter-spacing` in em, read from @theme. */
function stepTrackingEm(step: string): number {
  const value = globalsCss
    .match(new RegExp(`--text-${step}--letter-spacing:\\s*([^;]+);`))?.[1]
    ?.trim()
  if (value === undefined)
    throw new Error(`app/globals.css declares no tracking for --text-${step}`)

  return Number(value.replace('em', ''))
}

/** The type-scale step an element uses, e.g. `stat` for `text-stat`. */
function stepOf(element: HTMLElement): string {
  const step = TYPE_SCALE.find((name) =>
    new RegExp(`(?:^|\\s)text-${name}(?:\\s|$)`).test(element.className),
  )
  if (step === undefined) {
    throw new Error(`element declares no type-scale step: ${element.className}`)
  }

  return step
}

function slot(container: HTMLElement, name: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-slot="${name}"]`)
  if (element === null) throw new Error(`nothing rendered with data-slot="${name}"`)

  return element
}

function renderStat(props: Partial<StatPairProps> = {}) {
  return render(<StatPair figure="0" unit="KB" caption="sent to a server" {...props} />)
}

describe('StatPair', () => {
  it('renders the figure, the unit and the caption', () => {
    const { container } = renderStat()

    expect(slot(container, 'stat-pair-figure')).toHaveTextContent('0')
    expect(slot(container, 'stat-pair-unit')).toHaveTextContent('KB')
    expect(slot(container, 'stat-pair-caption')).toHaveTextContent('sent to a server')
  })

  /*
   * The point of the pattern: a screen reader has to read "0 KB sent to a
   * server", not three orphaned strings. Splitting the three parts across
   * sibling paragraphs would do exactly that, so they live inside one text
   * block whose own content is the whole statement.
   */
  it('reads as one statement rather than three orphaned strings', () => {
    const { container } = renderStat()
    const statement = slot(container, 'stat-pair')

    expect(statement.tagName).toBe('P')
    expect(statement.textContent).toBe('0 KB sent to a server')
    // No second text block inside: a nested paragraph or heading would split
    // the statement back into fragments read out one at a time.
    expect(statement.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li')).toHaveLength(0)
  })

  it('keeps the statement readable when there is no unit', () => {
    const { container } = renderStat({
      figure: '100%',
      unit: undefined,
      caption: 'processed in-browser',
    })

    expect(slot(container, 'stat-pair').textContent).toBe('100% processed in-browser')
    expect(container.querySelector('[data-slot="stat-pair-unit"]')).toBeNull()
  })

  it('sets the figure in the display face, uppercase, at the stat step', () => {
    const { container } = renderStat()
    const figure = slot(container, 'stat-pair-figure')

    expect(figure.className).toMatch(/\bfont-display\b/)
    expect(figure.className).toMatch(/\buppercase\b/)

    // CLAUDE.md section 3: display type tracks between -0.03em and -0.02em.
    const tracking = stepTrackingEm(stepOf(figure))
    expect(tracking).toBeLessThanOrEqual(-0.02)
    expect(tracking).toBeGreaterThanOrEqual(-0.03)
  })

  it('keeps the unit subordinate to the figure but on the same line', () => {
    const { container } = renderStat()
    const figure = slot(container, 'stat-pair-figure')
    const unit = slot(container, 'stat-pair-unit')

    expect(stepSizePx(stepOf(unit))).toBeLessThan(stepSizePx(stepOf(figure)))
    expect(unit.parentElement).toBe(figure.parentElement)
  })

  it('sets the caption at 12px in the muted tone of its surface', () => {
    const { container } = renderStat()
    const caption = slot(container, 'stat-pair-caption')

    expect(stepSizePx(stepOf(caption))).toBe(12)
    expect(caption.className).toMatch(/\btext-fg-dark-mut\b/)
  })

  it('switches the caption to the light-surface muted tone', () => {
    const { container } = renderStat({ surface: 'light' })
    const caption = slot(container, 'stat-pair-caption')

    expect(caption.className).toMatch(/\btext-fg-light-mut\b/)
    expect(caption.className).not.toMatch(/\btext-fg-dark-mut\b/)
  })

  /*
   * The figure inherits `currentColor` on purpose, so it flips with the block
   * it sits in. Only the caption names a colour, and a muted tone still has to
   * clear WCAG 2.2 AA for body text on the surface it is documented for.
   */
  it('keeps the caption legible on both surfaces', () => {
    for (const [surface, background] of [
      ['dark', 'ink'],
      ['light', 'paper'],
    ] as const) {
      const { container, unmount } = renderStat({ surface })
      const colour = slot(container, 'stat-pair-caption').className.match(
        /\btext-(fg-[a-z-]+)\b/,
      )?.[1]

      expect(colour, `${surface} caption declares no colour`).toBeDefined()
      expect(
        contrastRatio(colour as string, background),
        `caption ${colour} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5)

      unmount()
    }
  })

  it('names no colour for the figure, so it inverts with its block', () => {
    const { container } = renderStat()

    expect(slot(container, 'stat-pair-figure').className).not.toMatch(
      /\btext-(?:fg|ink|paper|shell)[a-z0-9-]*/,
    )
  })

  /*
   * The responsive contract forbids horizontal scroll from 320px to 2560px. A
   * five-digit figure or a long caption is a single long run of text: without
   * an explicit wrapping guard it sets the element's min-content width and
   * widens whatever grid cell the stat sits in.
   */
  it('wraps a long figure or caption instead of widening its container', () => {
    const { container } = renderStat({ figure: '10000', caption: 'megabytes uploaded to a server' })
    const className = slot(container, 'stat-pair').className

    expect(className).toMatch(/\bbreak-words\b/)
    expect(className).toMatch(/\bmin-w-0\b/)
  })

  it('lets a caller override a base utility through cn', () => {
    const { container } = renderStat({ className: 'gap-8' })
    const className = slot(container, 'stat-pair').className

    expect(className).toMatch(/\bgap-8\b/)
    expect(className).not.toMatch(/\bgap-2\b/)
  })

  it('forwards the remaining props to the rendered element', () => {
    const { container } = renderStat({ id: 'privacy-stat', lang: 'en' })
    const root = slot(container, 'stat-pair')

    expect(root.id).toBe('privacy-stat')
    expect(root).toHaveAttribute('lang', 'en')
  })

  /*
   * The prohibitions of CLAUDE.md section 3. They are asserted against the
   * source rather than the rendered output because a violation can live in a
   * variant this suite never renders — and because the ESLint rule that is
   * meant to catch them does not exist yet (issue #19).
   */
  describe('design contract', () => {
    it('uses no decorative shadow, focus ring or backdrop filter', () => {
      expect(source).not.toMatch(/\bshadow(-|\b)/)
      expect(source).not.toMatch(/\bdrop-shadow/)
      expect(source).not.toMatch(/\bring(-|\/|\b)/)
      expect(source).not.toMatch(/backdrop-(?:blur|filter|saturate)/)
    })

    it('uses no gradient and no blue or purple hue', () => {
      expect(source).not.toMatch(/gradient/i)
      expect(source).not.toMatch(/\b(?:from|via|to)-[a-z]+-\d{2,3}\b/)
      expect(source).not.toMatch(/\b(?:blue|indigo|violet|purple|fuchsia|sky|cyan)\b/i)
    })

    it('uses no raw hex colour', () => {
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    })

    it('draws every colour from the @theme palette', () => {
      const allowed = [
        ...COLOURS.keys(),
        ...TYPE_SCALE,
        'transparent',
        'current',
        'inherit',
        'none',
        'left',
        'center',
        'right',
        'balance',
        'pretty',
        'nowrap',
      ]
      const used = [
        ...source.matchAll(/\b(?:bg|text|border|outline|fill|stroke|ring)-([a-z0-9-]+)/g),
      ].map((match) => match[1])

      expect(used.filter((value) => !allowed.includes(value))).toEqual([])
    })

    it('uses only the documented radius scale', () => {
      const radii = [...source.matchAll(/\brounded(?:-[a-z]+)?-([a-z0-9]+)\b/g)].map((m) => m[1])

      expect(radii.filter((value) => ![...RADII, 'full', 'none'].includes(value))).toEqual([])
    })
  })
})
