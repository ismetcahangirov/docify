import { readdirSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { expect, test } from '@playwright/test'

import {
  BREAKPOINTS,
  MIN_TOUCH_TARGET_PX,
  collectHorizontalOverflow,
  collectSmallTouchTargets,
} from './support/responsive'

/*
 * Issue #20 — the responsive audit, as a gate rather than a one-off pass.
 *
 * CLAUDE.md section 3 states the contract in one line: no horizontal scroll
 * anywhere from 320px to 2560px, and touch targets of at least 44x44px. An
 * audit performed by hand satisfies that on the day it is run and says nothing
 * about the next commit, so it is written here as a sweep that every route
 * takes on every push.
 *
 * The sweep is deliberately shallow — it loads a route and measures it. It does
 * not click through flows, because the thing being protected is layout, and
 * layout regressions arrive with a stylesheet or a new block, not with an
 * interaction.
 */

/**
 * Every route the audit visits.
 *
 * Kept as an explicit list rather than a crawl so that a route can be visited
 * with meaningful state later on (a converter page with a file selected is a
 * different layout from an empty one) — and so that nothing about the audit
 * depends on the sitemap, which does not exist yet.
 *
 * An explicit list rots, so `route coverage` below fails the moment a static
 * page appears under `app/` without being added here.
 */
const ROUTES = ['/', '/convert', '/tools'] as const

for (const route of ROUTES) {
  test.describe(`${route} at every breakpoint`, () => {
    test('never scrolls horizontally between 320px and 2560px', async ({ page }) => {
      const failures: string[] = []

      for (const { width, height, label } of BREAKPOINTS) {
        await page.setViewportSize({ width, height })
        await page.goto(route)
        // Layout is measured with the real faces in place. `next/font` swaps
        // from the fallback after first paint, and the metric difference is
        // enough to move a heading across the viewport edge either way.
        await page.evaluate(() => document.fonts.ready)

        const { scrollWidth, clientWidth, offenders } =
          await page.evaluate(collectHorizontalOverflow)

        if (scrollWidth > clientWidth) {
          failures.push(
            `${width}px (${label}): the document scrolls ${scrollWidth - clientWidth}px ` +
              `horizontally (scrollWidth ${scrollWidth} > clientWidth ${clientWidth})` +
              formatOffenders(offenders),
          )
          continue
        }

        // Reached when the document does not scroll but content still reaches
        // past the right edge — the signature of `overflow-x: hidden` applied
        // to <body> to silence the symptom rather than fix the layout.
        if (offenders.length > 0) {
          failures.push(
            `${width}px (${label}): content extends past the ${clientWidth}px viewport ` +
              `without the document scrolling — it is being clipped, not fitted.` +
              formatOffenders(offenders),
          )
        }
      }

      expect(failures, `Horizontal overflow on ${route}`).toEqual([])
    })

    test(`gives every interactive element a ${MIN_TOUCH_TARGET_PX}x${MIN_TOUCH_TARGET_PX}px hit area`, async ({
      page,
    }) => {
      const failures: string[] = []

      for (const { width, height, label } of BREAKPOINTS) {
        await page.setViewportSize({ width, height })
        await page.goto(route)
        await page.evaluate(() => document.fonts.ready)

        const undersized = await page.evaluate(collectSmallTouchTargets, MIN_TOUCH_TARGET_PX)

        for (const target of undersized) {
          failures.push(
            `${width}px (${label}): ${target.descriptor} renders at ` +
              `${target.width}x${target.height}px`,
          )
        }
      }

      expect(failures, `Touch targets below ${MIN_TOUCH_TARGET_PX}px on ${route}`).toEqual([])
    })
  })
}

test.describe('route coverage', () => {
  /*
   * The audit is only a gate over the routes it knows about, and the list above
   * is maintained by hand. This test is what stops a page from shipping outside
   * it: add `app/pricing/page.tsx` and the sweep does not grow on its own, so
   * this fails and names the route to add.
   *
   * Dynamic segments are excluded because a route like `/convert/[pair]` cannot
   * be visited without choosing a `pair`, and the right representatives are a
   * judgement call for whoever adds the segment. They add concrete URLs to
   * ROUTES — the entries below are the ones that need no such choice.
   */
  test('sweeps every static page under app/', () => {
    const configFile = test.info().config.configFile
    expect(configFile, 'playwright.config.ts must be resolvable to locate app/').toBeTruthy()

    const discovered = discoverStaticRoutes(join(dirname(configFile as string), 'app'))
    const missing = discovered.filter((route) => !ROUTES.includes(route as (typeof ROUTES)[number]))

    expect(missing, 'Add these routes to ROUTES in e2e/responsive.spec.ts').toEqual([])
  })
})

/** Formats the offender list as an indented block, or nothing when it is empty. */
function formatOffenders(offenders: string[]): string {
  if (offenders.length === 0) return ''
  return `\n${offenders.map((offender) => `      - ${offender}`).join('\n')}`
}

/**
 * Walks the App Router tree and returns the URL path of every `page.tsx` that
 * can be visited without supplying a parameter.
 *
 * Route groups (`(marketing)`) contribute no segment and are unwrapped; private
 * folders (`_components`), parallel routes (`@modal`) and dynamic segments
 * (`[pair]`, `[...slug]`) are skipped, the first two because they are not
 * routable at all and the last because it needs a value the audit cannot invent.
 */
function discoverStaticRoutes(appDir: string): string[] {
  const routes: string[] = []

  for (const entry of readdirSync(appDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== 'page.tsx') continue

    const relative = entry.parentPath.slice(appDir.length)
    const segments = relative.split(sep).filter(Boolean)

    if (segments.some((segment) => /^[[@_]/.test(segment))) continue

    const path = segments.filter((segment) => !segment.startsWith('(')).join('/')
    routes.push(`/${path}`.replace(/\/$/, '') || '/')
  }

  return routes.sort()
}
