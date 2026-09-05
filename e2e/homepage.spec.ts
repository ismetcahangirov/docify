import { expect, test } from '@playwright/test'

test.describe('homepage', () => {
  test('responds with a 200 and an English document titled Docify', async ({ page }) => {
    const response = await page.goto('/')

    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/docify/i)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('renders the hero and the on-device privacy claim', async ({ page }) => {
    await page.goto('/')

    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible()
    await expect(heading).toContainText(/convert/i)

    // Matches the wording loosely on purpose: the claim outlives the copy.
    await expect(page.getByRole('main')).toContainText(
      /(in your browser|on your (own )?device|never leaves)/i,
    )
  })

  test('leads into the catalogue, and straight into the popular conversions', async ({ page }) => {
    await page.goto('/')

    // The button by its own name: the popular block ends with a second link
    // into the catalogue, and a looser pattern matches both.
    await expect(
      page.getByRole('main').getByRole('link', { name: /browse every converter/i }),
    ).toHaveAttribute('href', '/convert')

    const popular = page.getByRole('main').locator('a[href^="/convert/"]')
    expect(await popular.count()).toBeGreaterThanOrEqual(8)
  })

  test('frames the page with the site header and footer', async ({ page }) => {
    await page.goto('/')

    const header = page.getByRole('banner')
    await expect(header.getByRole('link', { name: /docify/i })).toHaveAttribute('href', '/')
    await expect(header.getByRole('link', { name: /converters/i })).toHaveAttribute(
      'href',
      '/convert',
    )

    await expect(page.getByRole('contentinfo')).toBeVisible()
  })

  test('shows the same frame on a converter page', async ({ page }) => {
    await page.goto('/convert/heic-to-jpg')

    await expect(page.getByRole('banner').getByRole('link', { name: /docify/i })).toBeVisible()
    await expect(page.getByRole('contentinfo')).toBeVisible()
  })
})
