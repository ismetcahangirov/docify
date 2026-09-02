import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ConverterIsland, ConverterSkeleton } from '@/components/converter/converter-island'
import { pairBySlug } from '@/lib/registry/pairs'

/*
 * The static-to-interactive boundary (issue #66).
 *
 * The property worth holding is that the placeholder occupies exactly the space
 * the real converter will. A deferred component that arrives into a
 * zero-height box pushes every section below it down, which is the layout shift
 * EPIC 9 sets a budget for — and the reason for deferring it in the first place
 * was performance.
 */

const pair = pairBySlug('heic-to-jpg')!

describe('the skeleton', () => {
  it('reserves the dropzone’s own minimum height', () => {
    const { container } = render(<ConverterSkeleton />)
    const box = container.querySelector('[data-slot="converter-skeleton"]')

    // `min-h-52` and the same padding as the real zone. Written as the utility
    // rather than as a pixel count, because that is what would have to change
    // for the two to drift apart.
    expect(box?.className).toContain('min-h-52')
    expect(box?.className).toContain('p-8')
    expect(box?.className).toContain('sm:p-12')
  })

  it('borrows the dropzone’s surface, so it does not read as a different block', () => {
    const { container } = render(<ConverterSkeleton />)
    const box = container.querySelector('[data-slot="converter-skeleton"]')

    expect(box?.className).toContain('border-line-dark')
    expect(box?.className).toContain('bg-ink-2')
    expect(box?.className).toContain('rounded-lg')
  })

  /*
   * There is nothing here for a screen reader to do. The real dropzone carries
   * its own label and arrives with it; announcing a placeholder first would be
   * two announcements for one control.
   */
  it('is hidden from assistive technology', () => {
    const { container } = render(<ConverterSkeleton />)

    expect(container.querySelector('[data-slot="converter-skeleton"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('does not animate', () => {
    const { container } = render(<ConverterSkeleton />)
    const box = container.querySelector('[data-slot="converter-skeleton"]')

    expect(box?.className).not.toMatch(/animate-|transition-/)
  })
})

describe('the island', () => {
  it('shows the placeholder until the converter has loaded', () => {
    render(<ConverterIsland pair={pair} />)

    expect(document.querySelector('[data-slot="converter-skeleton"]')).not.toBeNull()
  })

  /*
   * The converter it loads is exercised directly in `./converter.test.tsx`.
   * Resolving the lazy boundary here would be a test of `next/dynamic` rather
   * than of anything this repository wrote.
   */
  it('renders nothing else while it waits', () => {
    const { container } = render(<ConverterIsland pair={pair} />)

    expect(container.querySelectorAll('[data-slot]')).toHaveLength(1)
  })
})
