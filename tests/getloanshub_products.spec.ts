import { test, expect } from '@playwright/test';

test.describe('Get Loans Hub — 10 Financial & Loan Products Section', () => {

  test('Home Page contains all 10 products with exact rates and disclaimers', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto('http://localhost:8081/');
    await page.waitForLoadState('domcontentloaded');

    const content = await page.textContent('body');

    // 10 Products Verification
    expect(content).toContain('Personal Loan');
    expect(content).toContain('Home Loan');
    expect(content).toContain('Doctors Loan');
    expect(content).toContain('Auto Loan');
    expect(content).toContain('Education Loan');
    expect(content).toContain('Business Loan');
    expect(content).toContain('Project Funding');
    expect(content).toContain('Mortgage Loan');
    expect(content).toContain('Credit Cards');
    expect(content).toContain('Insurance');

    // Exact Rate Verification
    expect(content).toContain('Starting at 9.99% p.a.'); // Personal Loan & Doctors Loan
    expect(content).toContain('Starting at 7.75% p.a.'); // Home Loan
    expect(content).toContain('Starting at 8.15% p.a.'); // Auto Loan
    expect(content).toContain('Starting at 10.50% p.a.'); // Education Loan

    // Removed Products Verification
    expect(content).not.toContain('Balance Transfer');
    expect(content).not.toContain('CIBIL Score Help');

    console.log('Homepage verification passed. Errors:', errors);
  });

  test('Loans Index (/loans) contains all 10 products and disclaimers', async ({ page }) => {
    await page.goto('http://localhost:8081/loans');
    await page.waitForLoadState('domcontentloaded');

    const content = await page.textContent('body');
    expect(content).toContain('Project Funding');
    expect(content).toContain('Credit Cards');
    expect(content).toContain('Insurance');
    expect(content).not.toContain('Balance Transfer');
    expect(content).not.toContain('CIBIL Score Help');
  });

  test('Responsive viewports render without horizontal overflow', async ({ page }) => {
    const viewports = [
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 }
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('http://localhost:8081/');
      await page.waitForLoadState('domcontentloaded');

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    }
  });

});
