import { test, expect } from '@playwright/test';

test.describe('Hezo CRM — Core End-to-End Tests', () => {

  test('loads login page and has proper title and branding', async ({ page }) => {
    // Navigate to root / login
    await page.goto('/login');

    // Verify page title
    await expect(page).toHaveTitle(/Hezo/i);

    // Verify presence of branding and login form elements
    await expect(page.locator('input[type="email"], input[placeholder*="email" i]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Sign in"), button:has-text("Log in"), button[type="submit"]')).toBeVisible();
  });

  test('validates required fields on login submission', async ({ page }) => {
    await page.goto('/login');

    // Click submit without filling form
    const submitBtn = page.locator('button:has-text("Sign in"), button:has-text("Log in"), button[type="submit"]');
    await submitBtn.click();

    // Verify URL remains on /login or shows error validation
    await expect(page).toHaveURL(/\/login/);
  });

  test('renders responsive viewport properly', async ({ page }) => {
    // Test on mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');

    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

});
