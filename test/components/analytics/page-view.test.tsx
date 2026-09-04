import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The page-view component (issue #102).
 *
 * It sits in the root layout, so its cost is paid by all 126 pages and its
 * mistakes are made on all of them too. Three properties are worth holding:
 *
 *   it renders nothing            — a layout-level component must not be able
 *                                   to move anything or shift anything
 *   it reports once per path      — strict mode runs effects twice, and a
 *                                   double count on every page would be a
 *                                   silent factor of two in the figures
 *   it reports off the hot path   — scheduled behind what the visitor can see,
 *                                   never during hydration
 */

const report = vi.hoisted(() => vi.fn())
const path = vi.hoisted(() => ({ current: '/' as string | null }))

vi.mock('@/lib/analytics/report', () => ({ reportPageView: report }))
vi.mock('next/navigation', () => ({ usePathname: () => path.current }))

const { PageView } = await import('@/components/analytics/page-view')

/** Every callback `requestIdleCallback` was handed, in order. */
let scheduled: Array<() => void>

beforeEach(() => {
  report.mockReset()
  path.current = '/'
  scheduled = []

  vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
    scheduled.push(callback)

    return scheduled.length
  })
  vi.stubGlobal('cancelIdleCallback', vi.fn())
})

afterEach(() => {
  // Unmounted before the stubs go, not after. Vitest runs `afterEach` hooks in
  // reverse registration order, so test/setup.ts's own cleanup would otherwise
  // tear the tree down with `cancelIdleCallback` already removed — and the
  // component's effect cleanup calls it.
  cleanup()
  vi.unstubAllGlobals()
})

/** Runs whatever the browser was asked to run when it next went idle. */
function goIdle(): void {
  const pending = scheduled
  scheduled = []
  for (const callback of pending) callback()
}

describe('PageView', () => {
  it('renders nothing at all', () => {
    const { container } = render(<PageView />)

    expect(container.innerHTML).toBe('')
  })

  it('does not report during the render', () => {
    // Hydration is the busiest moment of the page's life and the window the
    // paint and interaction budgets are measured in. A beacon there competes
    // with work the visitor can see.
    render(<PageView />)

    expect(report).not.toHaveBeenCalled()
  })

  it('reports the path once the browser is idle', () => {
    path.current = '/convert/heic-to-jpg'
    render(<PageView />)
    goIdle()

    expect(report).toHaveBeenCalledExactlyOnceWith('/convert/heic-to-jpg')
  })

  it('reports once for a path however many times it re-renders', () => {
    const { rerender } = render(<PageView />)
    rerender(<PageView />)
    rerender(<PageView />)
    goIdle()

    expect(report).toHaveBeenCalledTimes(1)
  })

  it('reports again when the visitor navigates to another page', () => {
    const { rerender } = render(<PageView />)
    goIdle()

    path.current = '/convert'
    rerender(<PageView />)
    goIdle()

    expect(report.mock.calls).toEqual([['/'], ['/convert']])
  })

  it('reports again when the visitor comes back to a page they have seen', () => {
    // A second visit is a second view, not a duplicate of the first.
    const { rerender } = render(<PageView />)
    goIdle()

    path.current = '/convert'
    rerender(<PageView />)
    goIdle()

    path.current = '/'
    rerender(<PageView />)
    goIdle()

    expect(report.mock.calls).toEqual([['/'], ['/convert'], ['/']])
  })

  it('falls back to a timeout where there is no idle callback', () => {
    // Safari, until recently.
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers()

    try {
      render(<PageView />)
      expect(report).not.toHaveBeenCalled()

      vi.runAllTimers()
      expect(report).toHaveBeenCalledExactlyOnceWith('/')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a scheduled report when the page is left before it runs', () => {
    const cancel = vi.fn()
    vi.stubGlobal('cancelIdleCallback', cancel)

    render(<PageView />).unmount()

    expect(cancel).toHaveBeenCalled()
  })
})
