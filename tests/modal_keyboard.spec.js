const { test, expect } = require('@playwright/test');

const APP_URL = process.env.APP_URL || 'http://localhost:8085';
const APP_PASSWORD = "devtestpwd";

test.describe('Modal Keyboard Interaction', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the login page
    await page.goto(`${APP_URL}/login.html`);

    // Fill the password and click login
    await page.fill('#pw', APP_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for navigation to the main page
    await page.waitForURL(APP_URL);
    // Wait for loading screen to be hidden
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 30000 });
    // Wait for the app viewport to be visible
    await page.waitForSelector('#app-viewport', { state: 'visible', timeout: 10000 });
    // Wait for the app to load - using specific selector to avoid help panel
    await page.waitForSelector('#app > main > .item.entry', { state: 'visible', timeout: 30000 });
  });

  test('should close settings modal with Escape key', async ({ page }) => {
    // Open settings
    await page.click('#settings-button');
    await expect(page.locator('.modal-content')).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    // Modal should be hidden
    await expect(page.locator('.modal-content')).not.toBeVisible();
  });

  test('should not scroll main feed with ArrowDown when settings modal is open', async ({ page }) => {
    // Open settings
    await page.click('#settings-button');
    await expect(page.locator('.modal-content')).toBeVisible();

    // Get initial scroll position
    const initialScroll = await page.evaluate(() => window.scrollY);

    // Press ArrowDown
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500);

    // Scroll position should not change
    const finalScroll = await page.evaluate(() => window.scrollY);
    expect(finalScroll).toBe(initialScroll);
  });
});
