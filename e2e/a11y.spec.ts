/**
 * WCAG 2.2 AA, audited rather than asserted about (issue #80).
 *
 * ## What axe can and cannot answer
 *
 * axe-core evaluates roughly a third of the WCAG success criteria — the ones a
 * machine can decide. It will find a heading level skipped, a control with no
 * accessible name, a colour pair under 4.5:1 and a landmark missing; it cannot
 * decide whether the alternative text is *right*, whether the order things are
 * read in makes sense, or whether an animation would make somebody ill.
 *
 * So this suite is axe plus three things axe does not do, each of which the
 * acceptance criterion names: contrast is asserted to have actually been
 * evaluated rather than skipped, every focusable element is checked for a
 * visible focus indicator, and the page is loaded again under
 * `prefers-reduced-motion: reduce` to confirm nothing moves.
 *
 * ## What it found
 *
 * Two things, both fixed here rather than recorded. `fg-light-mut` on `shell`
 * measures 4.41:1 — under AA by a rounding error, and invisible to review
 * because it is the *ground* between surfaces rather than a surface. Muted text
 * belongs on `paper`, where the same colour measures 4.78:1, and the home page
 * now puts it there. And Tailwind v4 emits its built-in palette as `oklch()`,
 * which axe cannot parse: the placeholder pages, written before the tokens
 * existed, came back not as failing but as *unknown*.
 *
 * ## Why zero violations rather than zero critical ones
 *
 * The criterion says zero critical. A `moderate` finding is still somebody who
 * cannot use the page, and this site has four page shapes and no legacy: there
 * is nothing here that was inherited and has to be lived with. Every violation
 * is reported with its rule id and the nodes it found, so a failure names what
 * to fix rather than a count.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * The rule sets an audit at this level has to pass.
 *
 * `wcag22aa` is the target and the others are what it is built on: 2.2 adds to
 * 2.1, which adds to 2.0, and axe tags each rule with the earliest level it
 * belongs to. Asking for only the newest tag would run the three rules 2.2
 * introduced and none of the ones it inherits.
 *
 * `best-practice` is deliberately absent. It is axe's own advice rather than
 * the standard, and a suite that cannot tell the two apart is one that gets
 * turned off the first time the advice changes.
 */
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

/**
 * Every page shape the site has. The other 123 conversion pages are the last one.
 *
 * `interactive` says whether the page has anything the keyboard can reach.
 * `/tools` is still the scaffold's placeholder and has no link and no button on
 * it at all — which is a gap of its own, and not one an accessibility suite
 * should paper over by asserting nothing. The home page stopped being one in
 * #267 and now carries the site frame plus a grid of links.
 */
const PAGES = [
  { path: '/', label: 'the home page', interactive: true },
  { path: '/convert', label: 'the converter hub', interactive: true },
  { path: '/tools', label: 'the tools placeholder', interactive: false },
  { path: '/convert/heic-to-jpg', label: 'a conversion page', interactive: true },
] as const

/** A conversion page is not finished until its deferred island has mounted. */
async function ready(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')

  if (path.startsWith('/convert/')) {
    await expect(page.locator('[data-slot="dropzone-input"]')).toBeAttached({ timeout: 30_000 })
  }
}

/** One violation, flattened into something a failure message can print. */
function summarise(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
    why: violation.nodes[0]?.failureSummary,
  }))
}

for (const { path, label, interactive } of PAGES) {
  test.describe(`${label} (${path})`, () => {
    test('has no WCAG 2.2 AA violation', async ({ page }) => {
      await ready(page, path)

      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze()

      expect(summarise(results.violations)).toEqual([])
    })

    test('was actually checked for contrast, rather than skipped', async ({ page }) => {
      // axe reports a rule it could not evaluate as `incomplete` rather than as
      // a failure, and `color-contrast` is the one that lands there most often —
      // a background it cannot resolve, an element it cannot screenshot. A
      // suite that treats "not checked" as "passed" is the whole failure mode
      // of an automated audit.
      await ready(page, path)

      const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze()
      const checked = results.passes.some((rule) => rule.id === 'color-contrast')
      const unknown = results.incomplete.filter((rule) => rule.id === 'color-contrast')

      expect({ checked, unknown: summarise(unknown) }).toEqual({ checked: true, unknown: [] })
    })

    test('gives every element the keyboard reaches a visible focus indicator', async ({ page }) => {
      await ready(page, path)

      const invisible = await page.evaluate(() => {
        const focusable = [
          ...document.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ]
        const unreachable: string[] = []

        for (const element of focusable) {
          // `focus-visible` is what the design system styles, and it only
          // matches when the browser thinks the focus came from a keyboard.
          // `focus({ focusVisible: true })` is how a script asks for that.
          element.focus({ focusVisible: true } as FocusOptions)
          if (document.activeElement !== element) continue

          const style = getComputedStyle(element)
          const outlined = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
          const ringed = style.boxShadow !== 'none' && style.boxShadow !== ''

          if (!outlined && !ringed) {
            unreachable.push(
              `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`}: ${element.textContent?.trim().slice(0, 40) ?? ''}`,
            )
          }
        }

        return { checked: focusable.length, unreachable }
      })

      // The count is asserted too, where the page has anything to count: a
      // selector that matched nothing would report no failures for ever.
      if (interactive) expect(invisible.checked).toBeGreaterThan(0)
      expect(invisible.unreachable).toEqual([])
    })
  })
}

test.describe('with prefers-reduced-motion: reduce', () => {
  for (const { path, label } of PAGES) {
    test(`${label} moves nothing`, async ({ page }) => {
      // Set on the page rather than through `test.use`, so the preference is in
      // place before the first byte is parsed and a media query that is only
      // evaluated once still sees it.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await ready(page, path)

      const moving = await page.evaluate(() => {
        const offenders: string[] = []

        for (const element of document.querySelectorAll<HTMLElement>('*')) {
          const style = getComputedStyle(element)

          // A running animation is disqualifying whatever it animates: WCAG
          // 2.3.3 is about motion, and a keyframe loop under a reduce
          // preference is the case the preference exists for.
          const animated = style.animationName !== 'none' && parseFloat(style.animationDuration) > 0

          // A transition is only motion if it moves something. `transition-colors`
          // is used throughout for hover states, and a colour crossfade is not
          // what anybody sets this preference to avoid.
          const properties = style.transitionProperty.split(',').map((name) => name.trim())
          const moves = properties.some(
            (name) =>
              name === 'all' ||
              name === 'transform' ||
              name === 'translate' ||
              name === 'scale' ||
              name === 'rotate' ||
              name === 'width' ||
              name === 'height' ||
              name === 'top' ||
              name === 'left',
          )
          const transitioned = moves && parseFloat(style.transitionDuration) > 0

          if (animated || transitioned) {
            offenders.push(
              `${element.tagName.toLowerCase()}: animation=${style.animationName} transition=${style.transitionProperty} ${style.transitionDuration}`,
            )
          }
        }

        return offenders
      })

      expect(moving).toEqual([])
    })
  }
})
