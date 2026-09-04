'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { reportPageView } from '@/lib/analytics/report'

/*
 * The one client component in the root layout, and the whole of the analytics
 * on the page side (issue #102).
 *
 * It renders nothing. It watches the path, and once per path it schedules a
 * beacon carrying that path and nothing else.
 *
 * ## Why it is scheduled rather than sent in the effect
 *
 * An effect runs during hydration, which is the busiest moment of the page's
 * life and the window the interaction and paint budgets are measured in. A
 * beacon there competes with work the visitor can see. `requestIdleCallback`
 * moves it behind everything that matters, and the count is no less accurate
 * for arriving four hundred milliseconds later.
 *
 * The `setTimeout` fallback is for Safari, which had no `requestIdleCallback`
 * until recently. A zero-delay timeout is still a macrotask, so it still lands
 * after the current render — the same argument the worker's cancel path makes
 * about needing a macrotask to be observed.
 *
 * ## Why it deduplicates per path
 *
 * React runs effects twice in development's strict mode, and a soft navigation
 * back to a page the visitor has already seen is a second view rather than a
 * duplicate of the first. Keyed on the path, so returning to a page counts
 * again and re-rendering it does not.
 *
 * ## Why it is in the root layout and not on each page
 *
 * Because the alternative is remembering. A page added later that forgot this
 * would be missing from the figures with nothing to indicate that it was.
 *
 * It costs a client boundary on every route, which is the one thing worth
 * watching: `pnpm size` is the gate, and the component is a few hundred bytes
 * on top of a React runtime every route already ships for its own hydration.
 */

/** Schedules `run` for after the browser has finished what the visitor can see. */
function whenIdle(run: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  if (typeof window.requestIdleCallback === 'function') {
    // The timeout is a ceiling, not a delay: a tab that never goes idle — one
    // left in the background, most often — would otherwise never report.
    const handle = window.requestIdleCallback(run, { timeout: 4000 })

    return () => window.cancelIdleCallback(handle)
  }

  const handle = window.setTimeout(run, 0)

  return () => window.clearTimeout(handle)
}

export function PageView() {
  const pathname = usePathname()
  const reported = useRef<string | null>(null)

  useEffect(() => {
    if (pathname === null || reported.current === pathname) return

    reported.current = pathname

    return whenIdle(() => reportPageView(pathname))
  }, [pathname])

  return null
}
