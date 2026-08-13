import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button, BUTTON_SIZES, buttonVariants } from '@/components/ui/button'
import { contrastRatio } from '../../support/tokens'

describe('Button', () => {
  it('renders a native button carrying its accessible name', () => {
    render(<Button>Convert file</Button>)

    expect(screen.getByRole('button', { name: 'Convert file' })).toBeInTheDocument()
  })

  it('defaults to the primary variant: white fill, black text, pill radius', () => {
    render(<Button>Convert</Button>)
    const className = screen.getByRole('button').className

    // Word-bounded: a bare `toContain('bg-paper')` also passes for `bg-paper-2`,
    // which is the hover tone, not the fill.
    expect(className).toMatch(/\bbg-paper\b/)
    expect(className).toMatch(/\btext-ink\b/)
    expect(className).toMatch(/\brounded-full\b/)
  })

  it('renders the secondary variant as a transparent 1px outline', () => {
    render(<Button variant="secondary">Cancel</Button>)
    const className = screen.getByRole('button').className

    expect(className).toContain('bg-transparent')
    expect(className).toContain('border-line-dark')
    expect(className).toContain('rounded-full')
    expect(className).not.toContain('bg-paper')
  })

  it('renders the ghost variant as text that underlines on hover', () => {
    render(<Button variant="ghost">Learn more</Button>)
    const className = screen.getByRole('button').className

    expect(className).toContain('bg-transparent')
    expect(className).toContain('hover:underline')
    expect(className).not.toContain('border-line-dark')
  })

  it('meets the 44px minimum touch target at the default and icon sizes', () => {
    render(
      <>
        <Button>Default</Button>
        <Button size="icon" aria-label="Close" />
      </>,
    )

    expect(screen.getByRole('button', { name: 'Default' }).className).toContain('h-11')
    expect(screen.getByRole('button', { name: 'Close' }).className).toContain('size-11')
  })

  /*
   * The responsive contract puts the floor at 44x44px, and Tailwind's scale is
   * 4px per step — so `h-11` / `size-11` is exactly the floor and nothing may
   * sit below it. A size that offers a smaller button is a trap: whoever reaches
   * for it has no way to know it breaks the contract.
   */
  it('offers no size below the 44px floor', () => {
    for (const [size, classes] of Object.entries(BUTTON_SIZES)) {
      const step = classes.match(/\b(?:h|size)-(\d+)\b/)?.[1]

      expect(step, `size="${size}" declares no height`).toBeDefined()
      expect(Number(step) * 4, `size="${size}" is below the 44px floor`).toBeGreaterThanOrEqual(44)
    }
  })

  it('shows a 2px offset outline on keyboard focus rather than a ring', () => {
    render(<Button>Convert</Button>)
    const className = screen.getByRole('button').className

    expect(className).toContain('focus-visible:outline-2')
    expect(className).toContain('focus-visible:outline-offset-2')
    expect(className).not.toMatch(/\bring-/)
  })

  /*
   * The outline is drawn 2px *outside* the button, so the colour it has to
   * contrast with is the section behind the button — not the button's own fill.
   * `outline-current` therefore cannot be right for a variant that sets a text
   * colour: the primary button is black-on-white and lives on the dark block,
   * where a `currentColor` outline is black on #0D0D0D and simply vanishes.
   *
   * WCAG 2.2 SC 2.4.11 puts the floor at 3:1.
   */
  describe('focus indicator contrast', () => {
    /** The surface each variant is documented to sit on (docify-design §5). */
    const SURFACES = { primary: 'ink', secondary: 'ink' } as const

    /** The outline colour the rendered button actually resolves to. */
    function outlineColour(className: string): string {
      const outline = className.match(/focus-visible:outline-((?!offset-|\d)[a-z0-9-]+)/)?.[1]

      // `current` means the outline inherits the button's own text colour.
      if (outline !== 'current') return outline ?? ''
      return (
        className.match(/(?:^|\s)text-((?!body|h2|h3|display|eyebrow|stat|tech)[a-z0-9-]+)/)?.[1] ??
        ''
      )
    }

    it.each(Object.entries(SURFACES))(
      'keeps the %s outline legible on the %s surface',
      (variant, surface) => {
        render(<Button variant={variant as keyof typeof SURFACES}>Convert</Button>)
        const colour = outlineColour(screen.getByRole('button').className)

        expect(colour, `${variant} declares no outline colour`).not.toBe('')
        expect(
          contrastRatio(colour, surface),
          `${variant}: outline ${colour} on ${surface}`,
        ).toBeGreaterThanOrEqual(3)
      },
    )

    it('lets the ghost variant inherit, so it inverts with the section', () => {
      render(<Button variant="ghost">Learn more</Button>)
      const className = screen.getByRole('button').className

      // No text colour and no outline colour of its own — both come from the
      // surrounding block, which is what makes it work on light and dark.
      expect(className).toContain('focus-visible:outline-current')
      expect(className).not.toMatch(/(?:^|\s)text-(?:fg|ink|paper|shell)[a-z0-9-]*/)
    })
  })

  it('carries no shadow at any variant or size', () => {
    for (const variant of ['primary', 'secondary', 'ghost'] as const) {
      for (const size of Object.keys(BUTTON_SIZES) as Array<keyof typeof BUTTON_SIZES>) {
        expect(buttonVariants({ variant, size })).not.toMatch(/\bshadow(-|\b)/)
      }
    }
  })

  it('lets a caller override a base utility through cn', () => {
    render(<Button className="rounded-none">Convert</Button>)
    const className = screen.getByRole('button').className

    expect(className).toContain('rounded-none')
    expect(className).not.toContain('rounded-full')
  })

  it('renders as the child element when asChild is set', () => {
    render(
      <Button asChild>
        <a href="/convert">Start converting</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Start converting' })

    expect(link).toBeInTheDocument()
    expect(link.className).toContain('rounded-full')
  })
})
