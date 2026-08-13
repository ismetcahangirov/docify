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
})
