import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * The CSS variables app/globals.css maps onto --font-display/--font-sans/--font-mono.
 *
 * Each family is two faces since issue #315 — a preloaded *core* file covering
 * the codepoints these pages render and an *extended* file covering the rest of
 * the latin subset, which the browser fetches only when a character needs it.
 */
const FONT_VARIABLES = ['--font-archivo', '--font-inter', '--font-jetbrains-mono'] as const

const EXTENDED_FONT_VARIABLES = [
  '--font-archivo-ext',
  '--font-inter-ext',
  '--font-jetbrains-mono-ext',
] as const

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

  /*
   * The split of issue #315, measured where it pays: the network.
   *
   * Each family is a *core* file covering what these pages render plus an
   * *extended* one covering the rest of the latin subset. The saving is
   * entirely in the second never being fetched — 50kB across the three
   * families, on the critical path of every page view, for characters no page
   * here renders. The browser is what decides that, from the two faces'
   * `unicode-range` descriptors, so it has to be observed in a browser rather
   * than asserted about the configuration.
   *
   * Counting requests rather than reading file names: Next hashes every emitted
   * font into `/_next/static/media/`, and nothing in the URL says which half it
   * came from.
   */
  test.describe('the two halves of each family', () => {
    for (const route of ROUTES) {
      test(`fetches one face per family on ${route}, not both`, async ({ page }) => {
        const requested = new Set<string>()
        page.on('request', (request) => {
          if (FONT_FILE.test(request.url())) requested.add(new URL(request.url()).pathname)
        })

        await page.goto(route)
        await page.evaluate(async () => {
          await document.fonts.ready
        })

        // Three families, and only the half that carries the characters on the
        // page. Six would mean the unicode-range is not doing its job and every
        // visitor is paying for the accents.
        expect(requested.size).toBe(3)
      })
    }

    test('reaches the extended half for a character the core half does not carry', async ({
      page,
    }) => {
      const requested = new Set<string>()
      page.on('request', (request) => {
        if (FONT_FILE.test(request.url())) requested.add(new URL(request.url()).pathname)
      })

      await page.goto('/')
      await page.evaluate(async () => {
        await document.fonts.ready
      })

      expect(requested.size).toBe(3)

      // Nothing in the site's own copy is outside the core range, so the page
      // has to be given characters that are — one per family, in the element
      // each family sets. Rendered rather than requested through
      // document.fonts.load(), because it is the *rendering* that is supposed
      // to pull the second file in.
      await page.evaluate(() => {
        for (const family of ['var(--font-display)', 'var(--font-sans)', 'var(--font-mono)']) {
          const probe = document.createElement('p')
          probe.style.fontFamily = family
          probe.textContent = 'ÿçÆ €'
          document.body.append(probe)
        }
      })
      await page.evaluate(async () => {
        await document.fonts.ready
      })

      expect(requested.size).toBe(6)
    })

    /*
     * The saving has to survive the swap window, which is the one moment the
     * counting test above cannot see: over loopback the preloaded core face is
     * in hand before the first paint, so the page is never actually rendered
     * with an unloaded webfont at the head of its stack.
     *
     * `font-display: swap` says the browser renders with "the next available
     * font in the fallback list" meanwhile — and the next entry is the other
     * half of the same family. If reaching past a loading face counted as using
     * the one behind it, every visitor on a slow connection would fetch both
     * halves and the whole change would be worth nothing in the field while
     * still measuring well in the lab.
     *
     * It does not, because the extended face declares a `unicode-range` that
     * excludes ASCII: it is not a candidate for this text at all, loaded or
     * not. This holds the browser to that.
     */
    test('does not reach for the extended half while the core half is still loading', async ({
      page,
    }) => {
      const requested = new Set<string>()
      page.on('request', (request) => {
        if (FONT_FILE.test(request.url())) requested.add(new URL(request.url()).pathname)
      })

      // Every font on the route is delayed, so the page paints, and keeps
      // painting, with nothing but the metric-adjusted fallback available.
      await page.route(/\/_next\/static\/media\/.*\.woff2$/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000))
        await route.continue()
      })

      await page.goto('/', { waitUntil: 'commit' })
      await page.locator('#hero-heading').waitFor({ state: 'visible' })
      await page.waitForTimeout(1000)

      // Still inside the swap window: the three core faces are requested and
      // unanswered, and nothing has gone looking for their extended halves.
      expect(requested.size).toBe(3)
    })

    test('exposes the extended half of each family as its own CSS variable', async ({ page }) => {
      await page.goto('/')

      const pairs: [string, string][] = FONT_VARIABLES.map((core, index) => [
        core,
        EXTENDED_FONT_VARIABLES[index],
      ])

      const stacks = await page.evaluate((variables) => {
        const root = getComputedStyle(document.documentElement)

        return variables.map(([core, extended]) => ({
          core: root.getPropertyValue(core).trim(),
          extended: root.getPropertyValue(extended).trim(),
        }))
      }, pairs)

      for (const { core, extended } of stacks) {
        expect(core).not.toBe('')
        expect(extended).not.toBe('')
        // The core half carries no fallback tail of its own: Next appends the
        // metric-adjusted `local("Arial")` face to whichever face declares one,
        // and that face has no unicode-range — between the two halves it would
        // answer for every accented character and the extended file would never
        // load. See the header of app/fonts.ts.
        expect(core).not.toContain(',')
        expect(extended).toContain(',')
      }
    })
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
