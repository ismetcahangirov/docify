import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Progress } from '@/components/ui/progress'

/** The bar that fills the track — the element the width transform is applied to. */
function indicator(): HTMLElement {
  const element = screen
    .getByRole('progressbar')
    .querySelector<HTMLElement>('[data-slot="progress-indicator"]')

  if (element === null) throw new Error('progress indicator not found')
  return element
}

describe('Progress', () => {
  it('exposes a progressbar with the current value', () => {
    render(<Progress value={42} aria-label="Conversion progress" />)
    const bar = screen.getByRole('progressbar')

    expect(bar).toBeInTheDocument()
    expect(bar).toHaveAttribute('aria-valuenow', '42')
  })

  it('offsets the indicator by the remaining percentage', () => {
    render(<Progress value={25} aria-label="Conversion progress" />)

    expect(indicator().style.transform).toBe('translateX(-75%)')
  })

  it('treats a missing value as zero progress', () => {
    render(<Progress aria-label="Conversion progress" />)

    expect(indicator().style.transform).toBe('translateX(-100%)')
  })

  /*
   * `max` reaches the Radix root through the spread, so a caller can set one.
   * If the fill ignores it the bar and the accessibility tree disagree — the
   * screen reader says half done while the bar shows full.
   */
  it('scales the fill against a custom max', () => {
    render(<Progress value={100} max={200} aria-label="Conversion progress" />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '200')
    expect(indicator().style.transform).toBe('translateX(-50%)')
  })

  it('never runs the fill past either end of the track', () => {
    const { rerender } = render(<Progress value={140} aria-label="Conversion progress" />)
    expect(indicator().style.transform).toBe('translateX(-0%)')

    rerender(<Progress value={-40} aria-label="Conversion progress" />)
    expect(indicator().style.transform).toBe('translateX(-100%)')
  })

  it('draws the track and the fill from the @theme palette', () => {
    render(<Progress value={50} aria-label="Conversion progress" />)

    expect(screen.getByRole('progressbar').className).toContain('bg-ink-3')
    expect(indicator().className).toContain('bg-fg-dark')
  })

  it('renders a flat track — no shadow, no ring, no gradient fill', () => {
    render(<Progress value={50} aria-label="Conversion progress" />)
    const track = screen.getByRole('progressbar').className
    const fill = indicator().className

    for (const className of [track, fill]) {
      expect(className).not.toMatch(/\bshadow(-|\b)/)
      expect(className).not.toMatch(/\bring-/)
      expect(className).not.toMatch(/gradient/)
    }
  })

  it('accepts an accessible name from the caller', () => {
    render(<Progress value={10} aria-label="Conversion progress" />)

    expect(screen.getByRole('progressbar', { name: 'Conversion progress' })).toBeInTheDocument()
  })

  it('accepts the name by reference as well', () => {
    render(
      <>
        <span id="job-1">Converting report.docx</span>
        <Progress value={10} aria-labelledby="job-1" />
      </>,
    )

    expect(screen.getByRole('progressbar', { name: 'Converting report.docx' })).toBeInTheDocument()
  })

  /*
   * A compile-time assertion, checked by `pnpm typecheck`: `@ts-expect-error`
   * is itself an error if the line below type-checks cleanly. A progressbar is
   * announced on its own, so an unnamed one has to be impossible to write, not
   * merely discouraged in a comment.
   */
  it('cannot be rendered without a name', () => {
    // @ts-expect-error — aria-label or aria-labelledby is required.
    render(<Progress value={10} />)

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('merges a caller className over the base utilities', () => {
    render(<Progress value={10} className="h-1" aria-label="Conversion progress" />)

    expect(screen.getByRole('progressbar').className).toContain('h-1')
    expect(screen.getByRole('progressbar').className).not.toContain('h-2')
  })
})
