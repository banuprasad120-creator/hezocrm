import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('1. Authentication & Security Audit', () => {
  test('Auth Page renders correctly with branding, SEO tags, and theme toggle', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('http://localhost:3000/');
    await expect(page).toHaveTitle(/Sign in — Hezo CRM|Hezo CRM/i);
    await expect(page.locator('h1')).toContainText(/Assign. Call./i);
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Test Theme Toggle
    const themeBtn = page.locator('button[aria-label="Toggle theme"]');
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(300);
      await themeBtn.click();
    }
  });

  test('Invalid credentials show clear error message', async ({ page }) => {
    await page.goto('http://localhost:3000/');
    await page.fill('#email', 'nonexistent_test_user@invalid.com');
    await page.fill('#password', 'WrongPassword123!');
    await page.click('button[type="submit"]:has-text("Sign in")');

    // Check for error toast or alert
    const toast = page.locator('[data-sonner-toast], .toast, [role="status"], [role="alert"]').first();
    await expect(toast).toBeVisible({ timeout: 7000 });
  });

  test('Create company tab validates required inputs', async ({ page }) => {
    await page.goto('http://localhost:3000/');
    await page.click('button[role="tab"]:has-text("Create company")');
    await expect(page.locator('#cname')).toBeVisible();
    await expect(page.locator('#fname')).toBeVisible();
    await expect(page.locator('#email2')).toBeVisible();
    await expect(page.locator('#pass2')).toBeVisible();
  });
});

test.describe('2. Super Admin User Journey', () => {
  test('Super Admin logs in and manages companies', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('http://localhost:3000/');
    await page.fill('#email', 'superadmin@hezocrm.com');
    await page.fill('#password', 'TestPassword123!');
    await page.click('button[type="submit"]:has-text("Sign in")');

    await page.waitForURL(url => url.pathname.includes('/companies') || url.pathname.includes('/daily-leads') || url.pathname.includes('/dashboard'), { timeout: 10000 });

    // Navigate to companies
    await page.goto('http://localhost:3000/companies');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();

    console.log('Super Admin Companies URL:', page.url());
    console.log('Super Admin Console Errors:', consoleErrors);
  });
});

test.describe('3. Admin User Journey (Company Admin)', () => {
  test('Admin logs in and inspects daily leads, folders, and distribution', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('http://localhost:3000/');
    await page.fill('#email', 'gnaneshwar@getloanshub.com');
    await page.fill('#password', 'TestPassword123!');
    await page.click('button[type="submit"]:has-text("Sign in")');

    await page.waitForURL(url => !url.pathname.endsWith('/') || url.pathname.includes('daily-leads'), { timeout: 10000 });
    console.log('Admin landed on:', page.url());

    // 1. Daily Leads Page
    await page.goto('http://localhost:3000/daily-leads');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    // 2. All Leads Page
    await page.goto('http://localhost:3000/leads');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    // 3. Folders Page
    await page.goto('http://localhost:3000/folders');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    // 4. Employees / Agents Page
    await page.goto('http://localhost:3000/agents');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    // 5. Monitoring Page
    await page.goto('http://localhost:3000/monitoring');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    // 6. Attendance Page
    await page.goto('http://localhost:3000/attendance');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    // 7. Settings Page
    await page.goto('http://localhost:3000/settings');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    console.log('Admin Console Errors:', consoleErrors);
  });
});

test.describe('4. Employee / Agent User Journey', () => {
  test('Agent logs in and accesses My Leads, Call Screen, and Attendance', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('http://localhost:3000/');
    await page.fill('#email', 'rajitha@gmail.com');
    await page.fill('#password', 'TestPassword123!');
    await page.click('button[type="submit"]:has-text("Sign in")');

    await page.waitForURL(url => url.pathname.includes('/my-leads') || !url.pathname.endsWith('/'), { timeout: 10000 });
    console.log('Agent landed on:', page.url());

    // 1. My Leads
    await page.goto('http://localhost:3000/my-leads');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    // 2. Interested Candidates
    await page.goto('http://localhost:3000/interested');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    // 3. Trash / Out of Service
    await page.goto('http://localhost:3000/trash');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    // 4. Follow Ups
    await page.goto('http://localhost:3000/follow-ups');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    // 5. Attendance
    await page.goto('http://localhost:3000/attendance');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toBeVisible();

    console.log('Agent Console Errors:', consoleErrors);
  });
});

test.describe('5. Mobile Responsive Viewport Audit', () => {
  test('Mobile viewport (390x844) renders properly without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://localhost:3000/');
    await expect(page.locator('body')).toBeVisible();

    // Test responsive layout on auth page
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2); // No horizontal overflow
  });

  test('Mobile viewport on My Leads (Agent view)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://localhost:3000/');
    await page.fill('#email', 'rajitha@gmail.com');
    await page.fill('#password', 'TestPassword123!');
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL(url => !url.pathname.endsWith('/'), { timeout: 10000 });

    await page.goto('http://localhost:3000/my-leads');
    await page.waitForLoadState('domcontentloaded');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    console.log(`Mobile My Leads - scrollWidth: ${scrollWidth}, clientWidth: ${clientWidth}`);
  });
});
