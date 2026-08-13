import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/** The CSS variables app/globals.css maps onto --font-display/--font-sans/--font-mono. */
const FONT_VARIABLES = ['--font-archivo', '--font-inter', '--font-jetbrains-mono'] as const

/** Hosts a font would plausibly be pulled from if self-hosting ever regressed. */
const THIRD_PARTY_FONT_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'fonts.bunny.net',
  'use.typekit.net',
  'p.typekit.net',
  'cdn.jsdelivr.net',
  'unpkg.com',
]

const FONT_FILE = /\.(woff2?|ttf|otf|eot)(\?|$)/

/**
 * `/` is a marketing route; `/convert` is cross-origin isolated by
 * next.config.ts, where `Cross-Origin-Embedder-Policy: require-corp` would make
 * a cross-origin font fail outright rather than merely leak.
 */
const ROUTES = ['/', '/convert']

// Issue #14: the network panel must show zero external font requests. Fonts are
// the only third-party resource a marketing page normally reaches for, and a
// request to fonts.gstatic.com would leak a visitor's IP to Google on every
// page view — which contradicts the privacy claim the product is sold on.
test.describe('font delivery', () => {
  for (const route of ROUTES) {
    test(`serves every font of ${route} from this origin`, async ({ page, baseURL }) => {
      expect(baseURL, 'playwright.config.ts must define a baseURL').toBeTruthy()
      const origin = new URL(baseURL as string).origin

      const urls: string[] = []
      page.on('request', (request) => urls.push(request.url()))

      await page.goto(route)
      await loadDeclaredFonts(page)

      for (const host of THIRD_PARTY_FONT_HOSTS) {
        expect(urls.filter((url) => url.includes(host))).toEqual([])
      }

      const fontUrls = urls.filter((url) => FONT_FILE.test(url))

      // Guards against the assertion above passing because nothing loaded at all.
      expect(fontUrls.length).toBeGreaterThan(0)
      for (const url of fontUrls) {
        expect(new URL(url).origin).toBe(origin)
      }
    })

    test(`ships no markup on ${route} pointing at a font CDN`, async ({ page }) => {
      const response = await page.goto(route)
      const html = (await response?.text()) ?? ''

      for (const host of THIRD_PARTY_FONT_HOSTS) {
        expect(html).not.toContain(host)
      }
    })
  }

  test('exposes each family as a CSS variable on the html element', async ({ page }) => {
    await page.goto('/')

    const values = await page.evaluate(
      (variables) => {
        const root = getComputedStyle(document.documentElement)
        return variables.map((variable) => root.getPropertyValue(variable).trim())
      },
      [...FONT_VARIABLES],
    )

    for (const value of values) {
      expect(value).not.toBe('')
    }
  })

  test('resolves every declared family to a real, loadable face', async ({ page }) => {
    await page.goto('/')

    const faceCounts = await loadDeclaredFonts(page)

    for (const count of faceCounts) {
      expect(count).toBeGreaterThan(0)
    }
  })
})

/**
 * Nothing on the page is guaranteed to *use* the three families yet, so the
 * browser would never fetch them and a "fonts came from this origin" assertion
 * would pass vacuously. Loading them explicitly forces the fetch.
 *
 * Only the first family of each stack is requested — that is the real face. The
 * rest of the stack is metric-adjusted `local()` fallbacks and generics, whose
 * availability varies by machine and says nothing about self-hosting.
 */
async function loadDeclaredFonts(page: Page): Promise<number[]> {
  return page.evaluate(
    async (variables) => {
      const root = getComputedStyle(document.documentElement)
      const counts: number[] = []

      for (const variable of variables) {
        const family = root.getPropertyValue(variable).trim().split(',')[0]
        const faces = family ? await document.fonts.load(`1em ${family}`) : []
        counts.push(faces.length)
      }

      return counts
    },
    [...FONT_VARIABLES],
  )
}
