import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GridOverlay } from '@/components/blocks/grid-overlay'

/*
 * The hero's grid overlay (docify-design §6, issue #267).
 *
 * Two things matter and neither is how it looks: that it is invisible to
 * assistive technology, and that it draws its lines without a gradient
 * function — the design gate rejects every one of those, so the grid is an
 * SVG pattern in `currentColor` with the colour coming from a token class.
 */
describe('GridOverlay', () => {
  it('is decoration, hidden from assistive technology and from the tab order', () => {
    const { container } = render(<GridOverlay />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).toHaveClass('pointer-events-none')
  })

  it('draws its lines from a token, in currentColor, with no gradient anywhere', () => {
    const { container } = render(<GridOverlay />)
    const svg = container.querySelector('svg')
    const path = container.querySelector('pattern path')

    expect(svg).toHaveClass('text-line-light')
    expect(path).toHaveAttribute('stroke', 'currentColor')
    expect(container.innerHTML).not.toMatch(/gradient|#[0-9a-f]{3,8}\b/i)
  })

  it('takes its geometry from the caller rather than filling its parent', () => {
    // It must never sit under text — axe cannot rate contrast over an image
    // node — so the block that uses it says where it goes.
    const { container } = render(<GridOverlay className="inset-x-0 bottom-0 h-10 w-full" />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveClass('absolute', 'inset-x-0', 'bottom-0', 'h-10')
    expect(svg).not.toHaveClass('inset-0')
  })
})
