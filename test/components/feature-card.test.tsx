import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { render, screen } from '@testing-library/react'
import { Cpu, ShieldCheck } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { FeatureCard, type FeatureCardProps } from '@/components/blocks/feature-card'
import { COLOURS, contrastRatio, RADII, TYPE_SCALE } from '../support/tokens'

/*
 * FeatureCard — the fourth of the six signature patterns (issue #18).
 *
 * An `--color-ink-2` card on the dark block: flat fill, a 1px `--color-line-dark`
 * border, and a 44px circular icon badge above the title and copy. The icon is
 * the caller's, so the card never reaches for a lucide import of its own.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The component source, with comments stripped — the design-contract surface. */
const source = readFileSync(join(repoRoot, 'components', 'blocks', 'feature-card.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

function slot(container: HTMLElement, name: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-slot="${name}"]`)
  if (element === null) throw new Error(`nothing rendered with data-slot="${name}"`)

  return element
}

function renderCard(props: Partial<FeatureCardProps> = {}) {
  return render(
    <FeatureCard icon={ShieldCheck} title="Nothing is uploaded" {...props}>
      Your file never leaves the tab. Conversion runs on your own machine.
    </FeatureCard>,
  )
}

describe('FeatureCard', () => {
  it('renders the title as a heading and the copy beneath it', () => {
    renderCard()

    expect(screen.getByRole('heading', { name: 'Nothing is uploaded' })).toBeInTheDocument()
    expect(screen.getByText(/never leaves the tab/)).toBeInTheDocument()
  })

  it('renders the icon the caller passed, hidden from assistive technology', () => {
    const shield = renderCard()
    const shieldIcon = slot(shield.container, 'feature-card-badge').querySelector('svg')

    // The badge is decoration: the title already carries the card's meaning, so
    // announcing the icon would only repeat it.
    expect(shieldIcon).not.toBeNull()
    expect(shieldIcon).toHaveAttribute('aria-hidden', 'true')

    const drawing = shieldIcon?.innerHTML
    shield.unmount()

    // A second icon has to produce different artwork — otherwise the card could
    // be drawing one of its own and this suite would never know.
    const { container } = renderCard({ icon: Cpu })
    expect(slot(container, 'feature-card-badge').querySelector('svg')?.innerHTML).not.toBe(drawing)
  })

  /*
   * 44x44px is the badge's brief and the responsive contract's touch-target
   * floor at once, so it is expressed on the spacing scale — `size-11`, four
   * pixels per step — rather than as an arbitrary value that no other component
   * shares. If the card ever becomes interactive, the floor still holds.
   */
  it('draws a 44px circular icon badge', () => {
    const { container } = renderCard()
    const badge = slot(container, 'feature-card-badge')
    const step = badge.className.match(/\bsize-(\d+)\b/)?.[1]

    expect(step, 'the badge declares no size on the spacing scale').toBeDefined()
    expect(Number(step) * 4).toBe(44)
    expect(badge.className).toMatch(/\brounded-full\b/)
    expect(badge.className).toMatch(/\bbg-ink-3\b/)
  })

  /*
   * The card's hover fill is the badge's own tone. Left alone the two would
   * merge under the cursor, so they swap: the badge drops to the card's resting
   * fill and the step between them survives the hover.
   */
  it('swaps the badge tone with the card on hover instead of merging them', () => {
    const { container } = renderCard()

    expect(slot(container, 'feature-card').className).toMatch(/(?:^|\s)group(?:\s|$)/)
    expect(slot(container, 'feature-card-badge').className).toMatch(/\bgroup-hover:bg-ink-2\b/)
  })

  it('is a flat ink-2 surface with a 1px border and no shadow', () => {
    const { container } = renderCard()
    const className = slot(container, 'feature-card').className

    expect(className).toMatch(/\bbg-ink-2\b/)
    expect(className).toMatch(/(?:^|\s)border(?:\s|$)/)
    expect(className).toMatch(/\bborder-line-dark\b/)
    expect(className).toMatch(/\bhover:bg-ink-3\b/)
    expect(className).not.toMatch(/\bshadow(-|\b)/)
  })

  it('rounds the card on a step of the radius scale', () => {
    const { container } = renderCard()
    const radius = slot(container, 'feature-card').className.match(/\brounded-([a-z0-9]+)\b/)?.[1]

    expect(radius, 'the card declares no radius').toBeDefined()
    expect(RADII).toContain(radius)
  })

  it('sets the title and the copy at their steps of the type scale', () => {
    const { container } = renderCard()

    expect(TYPE_SCALE).toContain('h3')
    expect(slot(container, 'feature-card-title').className).toMatch(/\btext-h3\b/)
    expect(slot(container, 'feature-card-copy').className).toMatch(/\btext-body\b/)
  })

  /*
   * WCAG 2.2 AA is 4.5:1 for body text. The card has two fills — its own and
   * the one it takes on hover — and the copy has to clear the bar on both.
   */
  it('keeps the title and the copy legible on the card and on its hover fill', () => {
    const { container } = renderCard()

    for (const name of ['feature-card-title', 'feature-card-copy']) {
      const colour = slot(container, name).className.match(/\btext-(fg-[a-z-]+)\b/)?.[1]
      expect(colour, `${name} declares no colour`).toBeDefined()

      for (const surface of ['ink-2', 'ink-3']) {
        expect(
          contrastRatio(colour as string, surface),
          `${name}: ${colour} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  /*
   * The responsive contract forbids horizontal scroll from 320px to 2560px. An
   * unbroken word in the title or the copy — a long MIME type, a URL — would
   * otherwise set the card's min-content width and push its grid sideways;
   * `min-w-0` is what removes that floor, `break-words` alone does not.
   *
   * jsdom computes no layout, so this can only check that the guards are
   * declared; the measured no-scroll check belongs to `pnpm e2e`.
   */
  it('declares the guards that let long copy wrap', () => {
    const { container } = renderCard()
    const className = slot(container, 'feature-card').className

    expect(className).toMatch(/\bbreak-words\b/)
    expect(className).toMatch(/\bmin-w-0\b/)
  })

  it('lets a caller override a base utility through cn', () => {
    const { container } = renderCard({ className: 'p-10' })
    const className = slot(container, 'feature-card').className

    expect(className).toMatch(/\bp-10\b/)
    expect(className).not.toMatch(/\bp-6\b/)
  })

  it('forwards the remaining props to the rendered element', () => {
    const { container } = renderCard({ id: 'privacy-card', lang: 'en' })
    const root = slot(container, 'feature-card')

    expect(root.id).toBe('privacy-card')
    expect(root).toHaveAttribute('lang', 'en')
  })

  /*
   * The prohibitions of CLAUDE.md section 3, asserted against the source rather
   * than the rendered output: a violation can live in a branch this suite never
   * renders, and the ESLint rule meant to catch them does not exist yet
   * (issue #19).
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
      // Mirrors NON_COLOUR_SUFFIXES in test/components/ui/design-contract.test.ts:
      // values that share a prefix with a colour utility but carry no colour —
      // the type scale, keywords, alignment, and bare widths and offsets.
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
        '0',
        '1',
        '2',
        '4',
        '8',
        'offset-2',
        'offset-4',
        't',
        'b',
        'l',
        'r',
        'x',
        'y',
        's',
        'e',
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

    /*
     * An arbitrary value slips past both checks above — `bg-[#171717]` and
     * `rounded-[28px]` match neither the palette regex nor the radius one. The
     * point of the token block is that there is no second way to spell a value.
     */
    it('uses no arbitrary colour or radius value', () => {
      expect(source).not.toMatch(/\b(?:bg|text|border|outline|fill|stroke|ring|rounded)-\[/)
    })

    /*
     * Every icon the card ever shows comes from the caller. Importing one here
     * would both hard-code the card's meaning and pull the icon into the bundle
     * of every page that renders a card, whether it uses that icon or not.
     */
    it('imports nothing from lucide-react but its type', () => {
      const clauses = [...source.matchAll(/^import\s+(.+?)\s+from\s+'lucide-react'/gm)].map(
        (match) => match[1],
      )

      expect(clauses.filter((clause) => !clause.startsWith('type'))).toEqual([])
    })
  })
})
