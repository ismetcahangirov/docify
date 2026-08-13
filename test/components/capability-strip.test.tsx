import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { render, screen } from '@testing-library/react'
import { Code, Cpu, FileStack, ShieldCheck, UserRoundX } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import {
  CAPABILITY_TONES,
  CapabilityStrip,
  type CapabilityItem,
  type CapabilityTone,
} from '@/components/blocks/capability-strip'
import { COLOURS, contrastRatio, RADII, TYPE_SCALE } from '../support/tokens'

/*
 * The CapabilityStrip (issue #17) — the row of core claims that sits under the
 * hero block: `Runs in browser / No sign-up / No limits / Hardware-accelerated
 * / Open source`.
 *
 * Two things are worth stating about what is asserted and how.
 *
 * The palette assertions read app/globals.css through test/support/tokens.ts
 * rather than naming hex values. A transcribed `#9b9a96` keeps agreeing with
 * itself after the token behind it is renamed, at which point the component
 * compiles to no colour at all and the suite still passes.
 *
 * The responsive assertions are structural, not geometric. jsdom runs no layout
 * engine and applies no Tailwind stylesheet, so `getBoundingClientRect()` here
 * returns zeroes and a "does it scroll at 320px?" assertion would be theatre.
 * What is checked instead is the set of properties that make overflow
 * impossible — fixed-fraction tracks, `min-w-0` on the cells, a break rule that
 * lowers min-content width — plus the absence of the utilities that reintroduce
 * it. The geometric check belongs to Playwright, which renders real CSS.
 */

const ITEMS: readonly CapabilityItem[] = [
  { icon: Cpu, label: 'Runs in browser', detail: 'WASM + WebCodecs' },
  { icon: UserRoundX, label: 'No sign-up', detail: 'No account' },
  { icon: FileStack, label: 'No limits', detail: 'Batch of any size' },
  { icon: ShieldCheck, label: 'Hardware-accelerated', detail: 'GPU when available' },
  { icon: Code, label: 'Open source', detail: 'MIT licensed' },
]

const TONES = Object.keys(CAPABILITY_TONES) as CapabilityTone[]

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The component source, comments stripped, for the prohibition assertions. */
const source = readFileSync(join(repoRoot, 'components', 'blocks', 'capability-strip.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * The block each tone is documented to sit on — the light strip belongs on the
 * `paper` section, not on the `shell` background behind it, where the same
 * muted token drops to 4.42:1.
 */
const SURFACES: Record<CapabilityTone, string> = { dark: 'ink', light: 'paper' }

describe('CapabilityStrip', () => {
  describe('semantics', () => {
    it('renders the capabilities as a list, one item each', () => {
      render(<CapabilityStrip items={ITEMS} tone="dark" />)

      expect(screen.getByRole('list')).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(ITEMS.length)
    })

    /*
     * Tailwind's preflight sets `list-style: none`, and Safari with VoiceOver
     * then drops the list role entirely — the strip stops announcing "list, 5
     * items". The explicit role is what survives the reset.
     */
    it('states the list role explicitly, so the preflight reset cannot remove it', () => {
      render(<CapabilityStrip items={ITEMS} tone="dark" />)

      expect(screen.getByRole('list')).toHaveAttribute('role', 'list')
    })

    // The type omits `role`, but a JavaScript caller — or a spread whose type
    // TypeScript never checks for excess properties — can still reach it. The
    // attribute is written after the spread so the guarantee holds anyway.
    it('keeps the list role even when a caller spreads one over it', () => {
      const rogue = { role: 'presentation' }
      render(<CapabilityStrip items={ITEMS} tone="dark" {...rogue} />)

      expect(screen.getByRole('list')).toBeInTheDocument()
    })

    it('renders both lines of every label', () => {
      render(<CapabilityStrip items={ITEMS} tone="dark" />)

      for (const item of ITEMS) {
        expect(screen.getByText(item.label)).toBeInTheDocument()
        expect(screen.getByText(item.detail)).toBeInTheDocument()
      }
    })

    it('hides the icons from assistive technology, so each label is read once', () => {
      const { container } = render(<CapabilityStrip items={ITEMS} tone="dark" />)
      const icons = [...container.querySelectorAll('svg')]

      expect(icons).toHaveLength(ITEMS.length)
      for (const icon of icons) {
        expect(icon).toHaveAttribute('aria-hidden', 'true')
        expect(icon).toHaveAttribute('focusable', 'false')
      }
    })

    /*
     * `listitem` takes no name from its contents, so the guarantee that a cell
     * is announced once is not an accessible-name assertion — it is that the
     * cell contributes exactly its two lines to the accessibility tree. The
     * icon adds nothing to it because it is hidden (above); nothing else may
     * either.
     */
    it('puts nothing in a cell but its two lines', () => {
      render(<CapabilityStrip items={ITEMS} tone="dark" />)
      const cells = screen.getAllByRole('listitem')

      cells.forEach((cell, index) => {
        expect(cell.textContent).toBe(`${ITEMS[index].label}${ITEMS[index].detail}`)
      })
    })

    // Two claims are allowed to share a wording, so the key cannot be the
    // label: React drops one of the duplicates and warns.
    it('renders every cell even when two capabilities share a label', () => {
      const twins: CapabilityItem[] = [
        { icon: Cpu, label: 'Free', detail: 'No card' },
        { icon: Code, label: 'Free', detail: 'No licence' },
      ]
      render(<CapabilityStrip items={twins} tone="dark" />)

      expect(screen.getAllByRole('listitem')).toHaveLength(2)
    })
  })

  describe('layout', () => {
    /*
     * Two on mobile, three from `md` (48rem / 768px — iPad portrait, the point
     * a third 12-character claim still fits), five from `lg` (64rem / 1024px,
     * where a five-track row leaves each cell ~180px inside the SectionBlock
     * inset). Anything narrower than `md` for the three-column step puts three
     * tracks into a 640px viewport and hyphenates every claim.
     */
    it('is two columns on mobile, three from md and five from lg', () => {
      render(<CapabilityStrip items={ITEMS} tone="dark" />)
      const className = screen.getByRole('list').className

      expect(className).toMatch(/(?:^|\s)grid-cols-2\b/)
      expect(className).toMatch(/\bmd:grid-cols-3\b/)
      expect(className).toMatch(/\blg:grid-cols-5\b/)
      expect(className).toMatch(/(?:^|\s)grid\b/)
    })

    it('declares no column count between md and lg that would strand a cell', () => {
      render(<CapabilityStrip items={ITEMS} tone="dark" />)
      const breakpoints = [...screen.getByRole('list').className.matchAll(/\b(\w+):grid-cols-/g)]

      expect(breakpoints.map((match) => match[1])).toEqual(['md', 'lg'])
    })
  })

  /*
   * The responsive contract: no horizontal scroll from 320px to 2560px. In a
   * grid the danger is not the wrapping, it is the sizing — a cell whose
   * min-content width exceeds its share widens the track, the row, and the
   * page. Three things have to hold at once, and each is asserted separately so
   * a failure names which one was lost.
   */
  describe('320px contract', () => {
    const LONG = 'Hardware-accelerated transcoding without a single server round-trip'

    it('gives the cells no minimum width of their own', () => {
      render(<CapabilityStrip items={ITEMS} tone="dark" />)

      for (const cell of screen.getAllByRole('listitem')) {
        expect(cell.className).toMatch(/\bmin-w-0\b/)
      }
    })

    /*
     * `break-words` alone is not enough. `overflow-wrap: break-word` breaks a
     * long word only once the line is already too narrow — it leaves the
     * element's min-content width at the longest word, which is exactly the
     * measurement that widens a grid track. `wrap-anywhere`
     * (`overflow-wrap: anywhere`) is the one that lowers it, and `break-words`
     * stays as the fallback for browsers that drop the newer keyword.
     */
    it('lets a long word break rather than set the cell width', () => {
      render(<CapabilityStrip items={[{ icon: Cpu, label: LONG, detail: LONG }]} tone="dark" />)

      for (const line of screen.getAllByText(LONG)) {
        expect(line.className).toMatch(/\bwrap-anywhere\b/)
        expect(line.className).toMatch(/\bbreak-words\b/)
      }
    })

    it('holds every track to an equal fraction, so no cell can widen the row', () => {
      // Tailwind compiles `grid-cols-<n>` to `repeat(n, minmax(0, 1fr))`. The
      // `auto-cols`/`grid-flow-col` family and an explicit `w-`/`min-w-` on the
      // list would each replace that with a content-driven track.
      render(<CapabilityStrip items={ITEMS} tone="dark" />)
      const className = screen.getByRole('list').className

      expect(className).not.toMatch(/\bgrid-flow-col\b/)
      expect(className).not.toMatch(/\bauto-cols-/)
      expect(className).not.toMatch(/\b(?:min-)?w-(?!full\b)[a-z0-9[]/)
    })

    it('never pins a line to one row', () => {
      const { container } = render(<CapabilityStrip items={ITEMS} tone="dark" />)

      expect(container.innerHTML).not.toMatch(/\bwhitespace-nowrap\b/)
      expect(container.innerHTML).not.toMatch(/\btruncate\b/)
    })

    it('scrolls nothing sideways of its own accord', () => {
      const { container } = render(<CapabilityStrip items={ITEMS} tone="dark" />)

      expect(container.innerHTML).not.toMatch(/\boverflow-x-/)
    })
  })

  describe('typography', () => {
    it('sets the claim in the card-title step', () => {
      render(<CapabilityStrip items={ITEMS} tone="dark" />)

      expect(screen.getByText(ITEMS[0].label).className).toMatch(/\btext-h3\b/)
    })

    it('sets the qualifier as an eyebrow: uppercase, the eyebrow step', () => {
      render(<CapabilityStrip items={ITEMS} tone="dark" />)
      const className = screen.getByText(ITEMS[0].detail).className

      expect(className).toMatch(/\btext-eyebrow\b/)
      expect(className).toMatch(/\buppercase\b/)
    })

    // Guards a rename: the two steps above have to exist in the @theme block,
    // or the classes above compile to nothing and every assertion still passes.
    it('names steps that app/globals.css actually declares', () => {
      expect(TYPE_SCALE).toEqual(expect.arrayContaining(['h3', 'eyebrow']))
    })
  })

  describe('tone', () => {
    /*
     * Only the qualifier is coloured. The claim and the icon inherit, which is
     * what makes the strip invert with the block around it rather than needing
     * to be told twice — and it is what keeps a wrong tone legible instead of
     * turning the whole strip into paper-on-paper.
     */
    it('leaves the claim and the icon to inherit the block colour', () => {
      render(<CapabilityStrip items={ITEMS} tone="dark" />)

      expect(screen.getByRole('list').className).not.toMatch(/\btext-fg-/)
      expect(screen.getByText(ITEMS[0].label).className).not.toMatch(/\btext-fg-/)
    })

    it.each(TONES)('mutes the %s qualifier with the muted token for that surface', (tone) => {
      render(<CapabilityStrip items={ITEMS} tone={tone} />)
      const className = screen.getByText(ITEMS[0].detail).className

      expect(className).toContain(CAPABILITY_TONES[tone])
      // CLAUDE.md §3: eyebrow text is muted. `text-fg-dark` would satisfy every
      // other assertion here, including the contrast floor below.
      expect(CAPABILITY_TONES[tone]).toMatch(/-mut$/)
    })

    /*
     * The qualifier is the strip's smallest text and its lowest contrast, so it
     * is the line that decides whether the pattern is legible at all. WCAG 2.2
     * SC 1.4.3 puts 12px body text at 4.5:1.
     */
    it.each(TONES)('keeps the %s qualifier at 4.5:1 against the surface it sits on', (tone) => {
      render(<CapabilityStrip items={ITEMS} tone={tone} />)
      const colour = screen.getByText(ITEMS[0].detail).className.match(/\btext-(fg-[a-z-]+)\b/)?.[1]

      expect(colour, `${tone} declares no qualifier colour`).toBeDefined()
      expect(COLOURS.has(colour ?? ''), `${colour} is not a palette token`).toBe(true)
      expect(
        contrastRatio(colour ?? '', SURFACES[tone]),
        `${tone}: ${colour} on ${SURFACES[tone]}`,
      ).toBeGreaterThanOrEqual(4.5)
    })

    it('covers exactly the two surfaces the design system defines', () => {
      expect([...TONES].sort()).toEqual(['dark', 'light'])
    })
  })

  describe('composition', () => {
    // tailwind-merge drops the base utility for the caller's, but only the one
    // it conflicts with: the `md:`/`lg:` counts are separate groups and stay.
    // An override of the base count therefore holds below 768px and no further.
    it('merges the caller className through cn, dropping the base it conflicts with', () => {
      render(<CapabilityStrip items={ITEMS} tone="dark" className="grid-cols-1" />)
      const className = screen.getByRole('list').className

      expect(className).toContain('grid-cols-1')
      expect(className).not.toMatch(/(?:^|\s)grid-cols-2\b/)
      expect(className).toMatch(/\bmd:grid-cols-3\b/)
    })

    it('forwards the remaining props to the list element', () => {
      render(
        <CapabilityStrip
          items={ITEMS}
          tone="dark"
          aria-label="What Docify guarantees"
          id="claims"
        />,
      )
      const list = screen.getByRole('list', { name: 'What Docify guarantees' })

      expect(list).toHaveAttribute('id', 'claims')
    })

    it('renders nothing but an empty list when given no capabilities', () => {
      render(<CapabilityStrip items={[]} tone="dark" />)

      expect(screen.getByRole('list')).toBeEmptyDOMElement()
    })
  })

  /*
   * CLAUDE.md §3 prohibitions, read off the source rather than the render: a
   * `shadow-xs` on a branch no test happens to exercise is still a violation.
   * The ESLint rule that is meant to catch these does not exist yet (issue
   * #19), so this is the only thing standing between the file and a raw hex.
   *
   * The equivalent sweep over components/ui lives in
   * test/components/ui/design-contract.test.ts and enumerates its directory, so
   * a new file there cannot skip the check. components/blocks deserves the same
   * treatment once the blocks landing in parallel have merged.
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
      expect(source).not.toMatch(/\bbackdrop-/)
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

    it('escapes into no arbitrary colour or radius value', () => {
      expect(source).not.toMatch(/\b(?:bg|text|border|outline|fill|stroke|rounded)-\[/)
      expect(source).not.toMatch(/\b(?:bg|text|border|outline|fill|stroke|rounded)-\(/)
    })

    it("uses none of shadcn's default colour variables", () => {
      expect(source).not.toMatch(
        /\b(?:bg|text|border|outline|fill|stroke)-(?:primary|secondary|background|foreground|muted|accent|popover|card|destructive|input)\b/,
      )
      expect(source).not.toMatch(/--(?:primary|background|foreground|muted|accent|popover|card)\b/)
    })

    it('draws every colour from the @theme palette', () => {
      const palette = [...COLOURS.keys()]
      // The type scale shares the `text-` prefix with the colour utilities, and
      // the three keywords are colours without being palette entries.
      const nonColour = [...TYPE_SCALE, 'transparent', 'current', 'inherit']
      const used = [...source.matchAll(/\b(?:bg|text|border|outline|fill|stroke)-([a-z0-9-]+)/g)]
        .map((match) => match[1])
        .filter((value) => !palette.includes(value) && !nonColour.includes(value))

      expect(used).toEqual([])
    })

    it('uses only the documented radius scale', () => {
      const used = [...source.matchAll(/\brounded(?:-[a-z]+)?-([a-z0-9]+)\b/g)].map((m) => m[1])

      expect(used.filter((value) => ![...RADII, 'full', 'none'].includes(value))).toEqual([])
    })
  })
})
