import { test, expect } from '@playwright/test';

test.describe('Hezo CRM — End-to-End Suite', () => {

  test('loads Hezo CRM and verifies application title and main UI', async ({ page }) => {
    await page.goto('/');

    // Verify title contains Hezo CRM or Hezo
    await expect(page).toHaveTitle(/Hezo/i);

    // Verify body is rendered and visible
    await expect(page.locator('body')).toBeVisible();
  });

  test('verifies UI container and interactive elements', async ({ page }) => {
    await page.goto('/');

    // Wait for the app container to mount
    await expect(page.locator('body')).toBeVisible();
    await page.waitForLoadState('domcontentloaded');

    // Verify presence of buttons or input interactive elements
    const interactiveElements = page.locator('button, input, a');
    await expect(interactiveElements.first()).toBeVisible();
  });

  test('renders properly across mobile and desktop viewports', async ({ page }) => {
    // Mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    // Desktop view
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });

});
