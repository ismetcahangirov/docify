import { expect, test } from '@playwright/test'

test.describe('homepage', () => {
  test('serves the document with a successful response', async ({ page }) => {
    const response = await page.goto('/')

    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/docify/i)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('renders the hero and states that conversion happens on the device', async ({ page }) => {
    await page.goto('/')

    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible()
    await expect(heading).toContainText(/convert/i)

    await expect(page.getByText(/on your own device/i)).toBeVisible()
  })
})
