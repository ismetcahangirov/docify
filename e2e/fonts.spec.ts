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

// Issue #14: the network panel must show zero external font requests. Fonts are
// the only third-party resource a marketing page normally reaches for, and a
// request to fonts.gstatic.com would leak a visitor's IP to Google on every
// page view — which contradicts the privacy claim the product is sold on.
test.describe('font delivery', () => {
  test('never requests a font from a third-party host', async ({ page, baseURL }) => {
    const urls: string[] = []
    page.on('request', (request) => urls.push(request.url()))

    await page.goto('/')
    await loadDeclaredFonts(page)

    for (const host of THIRD_PARTY_FONT_HOSTS) {
      expect(urls.filter((url) => url.includes(host))).toEqual([])
    }

    const origin = new URL(baseURL ?? '').origin
    const fontUrls = urls.filter((url) => FONT_FILE.test(url))

    expect(fontUrls.length).toBeGreaterThan(0)
    for (const url of fontUrls) {
      expect(new URL(url).origin).toBe(origin)
    }
  })

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

  test('ships no stylesheet or preload pointing at a font CDN', async ({ page }) => {
    const response = await page.goto('/')
    const html = (await response?.text()) ?? ''

    for (const host of THIRD_PARTY_FONT_HOSTS) {
      expect(html).not.toContain(host)
    }
  })
})

/**
 * Nothing on the page is guaranteed to *use* the three families yet, so the
 * browser would never fetch them and a "fonts came from this origin" assertion
 * would pass vacuously. Loading them explicitly forces the fetch.
 */
async function loadDeclaredFonts(page: Page): Promise<number[]> {
  return page.evaluate(
    async (variables) => {
      const root = getComputedStyle(document.documentElement)
      const counts: number[] = []

      for (const variable of variables) {
        const family = root.getPropertyValue(variable).trim()
        const faces = family ? await document.fonts.load(`1em ${family}`) : []
        counts.push(faces.length)
      }

      return counts
    },
    FONT_VARIABLES as unknown as string[],
  )
}
