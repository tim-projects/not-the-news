import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';

test.describe('Modal Keyboard Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, APP_URL);
    await ensureFeedsSeeded(page);
    await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
    await page.locator('[data-guid]').first().waitFor({ state: 'visible', timeout: 30000 });
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