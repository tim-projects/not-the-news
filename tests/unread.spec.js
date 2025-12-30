import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

test.describe('Unread Items', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:8085';

  test.beforeEach(async ({ page }) => {
    test.setTimeout(60000); 
    
    await login(page, APP_URL);
    await ensureFeedsSeeded(page);

    await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const screenshotName = `${testInfo.title.replace(/\s+/g, '-')}-failure.png`;
      await page.screenshot({ path: `test-results/${screenshotName}` });
      console.log(`Screenshot saved to test-results/${screenshotName}`);
    }
  });

  test('should display unread items', async ({ page }) => {
    // Wait for the feed to load
    await page.waitForSelector('.item', { state: 'visible', timeout: 60000 });

    // Check if there are any unread items
    const items = page.locator('.item:not(.help-panel-item)');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });
});
