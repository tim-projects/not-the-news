import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test('should redirect unauthenticated users to login page', async ({ page }) => {
    // Clear localStorage to ensure we are unauthenticated
    await page.addInitScript(() => {
        localStorage.removeItem('isAuthenticated');
        localStorage.removeItem('auth'); // Just in case
    });

    console.log(`Navigating to ${APP_URL}/`);
    await page.goto(`${APP_URL}/`);

    // Should be redirected to login.html
    await page.waitForURL(/.*login.html/, { timeout: 10000 });
    expect(page.url()).toContain('login.html');
});

test('should allow authenticated users to access home page', async ({ page }) => {
    // 1. Perform actual login to establish Firebase session
    await page.goto(`${APP_URL}/login.html`);
    await page.fill('#email', 'test@example.com');
    await page.fill('#pw', 'devtestpwd');
    await page.click('#login-btn');
    await page.waitForURL(`${APP_URL}/`);

    // 2. Now reload the page. 
    // The static check in index.html should see 'isAuthenticated' (set by login.ts) 
    // AND the app logic should see the valid Firebase session.
    await page.reload();

    // Should NOT be redirected
    await page.waitForTimeout(2000);
    expect(page.url()).not.toContain('login.html');
    expect(page.url()).toBe(`${APP_URL}/`);
});
