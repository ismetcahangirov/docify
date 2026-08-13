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
    render(<Progress value={42} />)
    const bar = screen.getByRole('progressbar')

    expect(bar).toBeInTheDocument()
    expect(bar).toHaveAttribute('aria-valuenow', '42')
  })

  it('offsets the indicator by the remaining percentage', () => {
    render(<Progress value={25} />)

    expect(indicator().style.transform).toBe('translateX(-75%)')
  })

  it('treats a missing value as zero progress', () => {
    render(<Progress />)

    expect(indicator().style.transform).toBe('translateX(-100%)')
  })

  it('draws the track and the fill from the @theme palette', () => {
    render(<Progress value={50} />)

    expect(screen.getByRole('progressbar').className).toContain('bg-ink-3')
    expect(indicator().className).toContain('bg-fg-dark')
  })

  it('renders a flat track — no shadow, no ring, no gradient fill', () => {
    render(<Progress value={50} />)
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

  it('merges a caller className over the base utilities', () => {
    render(<Progress value={10} className="h-1" />)

    expect(screen.getByRole('progressbar').className).toContain('h-1')
    expect(screen.getByRole('progressbar').className).not.toContain('h-2')
  })
})
