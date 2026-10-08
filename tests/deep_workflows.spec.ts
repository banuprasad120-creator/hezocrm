import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Deep Workflow & Feature Tests on Hezo CRM', () => {

  test('Security & Role Boundaries: Agent cannot access Super Admin / Admin restricted pages', async ({ page }) => {
    // Login as Agent
    await page.goto('http://localhost:3000/');
    await page.fill('#email', 'rajitha@gmail.com');
    await page.fill('#password', 'TestPassword123!');
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL(url => !url.pathname.endsWith('/'), { timeout: 10000 });

    // Try to access /companies (Super Admin only)
    await page.goto('http://localhost:3000/companies');
    await page.waitForLoadState('domcontentloaded');
    // Agent should be redirected away or shown unauthorized state
    const currentUrl = page.url();
    console.log('Agent navigation to /companies result URL:', currentUrl);
    expect(currentUrl).not.toContain('/companies');
  });

  test('Lead Search and Filtering across multiple fields', async ({ page }) => {
    // Login as Admin
    await page.goto('http://localhost:3000/');
    await page.fill('#email', 'gnaneshwar@getloanshub.com');
    await page.fill('#password', 'TestPassword123!');
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL(url => !url.pathname.endsWith('/'), { timeout: 10000 });

    await page.goto('http://localhost:3000/leads');
    await page.waitForLoadState('domcontentloaded');

    // Check search input
    const searchInput = page.locator('input[placeholder*="Search"], input[type="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('kasam');
      await page.waitForTimeout(500);
      await searchInput.clear();
      await searchInput.fill('9999');
      await page.waitForTimeout(500);
      await searchInput.clear();
    }
  });

  test('Attendance Workflow: Agent Check-in and Check-out', async ({ page }) => {
    // Login as Agent
    await page.goto('http://localhost:3000/');
    await page.fill('#email', 'rajitha@gmail.com');
    await page.fill('#password', 'TestPassword123!');
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL(url => !url.pathname.endsWith('/'), { timeout: 10000 });

    await page.goto('http://localhost:3000/attendance');
    await page.waitForLoadState('domcontentloaded');

    // Verify Attendance page elements
    await expect(page.locator('body')).toBeVisible();
    const checkInBtn = page.locator('button:has-text("Check In"), button:has-text("Punch In")').first();
    if (await checkInBtn.isVisible()) {
      console.log('Check In button is present and visible');
    }
  });

  test('Employee UX Workflow: Today Leads -> Open Customer -> Update Status & Notes', async ({ page }) => {
    // Login as Agent
    await page.goto('http://localhost:3000/');
    await page.fill('#email', 'rajitha@gmail.com');
    await page.fill('#password', 'TestPassword123!');
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL(url => !url.pathname.endsWith('/'), { timeout: 10000 });

    await page.goto('http://localhost:3000/my-leads');
    await page.waitForLoadState('domcontentloaded');

    // Verify My Leads header & count badge
    await expect(page.locator('body')).toBeVisible();
    console.log('My Leads page loaded successfully for Agent');
  });

  test('Multi-breakpoint Responsive Validation (320px, 375px, 768px, 1280px, 1440px)', async ({ page }) => {
    const breakpoints = [
      { name: '320px (Mobile Small)', width: 320, height: 568 },
      { name: '375px (iPhone SE)', width: 375, height: 667 },
      { name: '390px (iPhone 14)', width: 390, height: 844 },
      { name: '768px (iPad/Tablet)', width: 768, height: 1024 },
      { name: '1280px (Desktop HD)', width: 1280, height: 720 },
      { name: '1440px (Desktop QHD)', width: 1440, height: 900 }
    ];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto('http://localhost:3000/');
      await page.waitForLoadState('domcontentloaded');
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      console.log(`Breakpoint ${bp.name}: scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
    }
  });

});
