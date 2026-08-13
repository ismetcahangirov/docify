import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import HomePage from '@/app/page'

// Assertions stay structural on purpose: the page copy is scaffold placeholder
// text that EPIC 2 rewrites, and this suite must not fail on that rewrite.
describe('HomePage', () => {
  it('renders its content inside a main landmark', () => {
    render(<HomePage />)

    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders exactly one level-1 heading, with visible text', () => {
    render(<HomePage />)

    const headings = screen.getAllByRole('heading', { level: 1 })

    expect(headings).toHaveLength(1)
    expect(headings[0]).toBeVisible()
    expect(headings[0].textContent?.trim()).not.toBe('')
  })

  it('places the level-1 heading inside the main landmark', () => {
    render(<HomePage />)

    const main = screen.getByRole('main')

    expect(within(main).getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
