import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

test.describe('Reset Application Data', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:8085';

  test('should call resetApplicationData and handle confirmation', async ({ page }) => {
    let consoleLogs = [];
    let networkResponses = [];

    page.on('console', msg => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });

    page.on('response', async response => {
      networkResponses.push(response.url());
    });

    // Handle the confirmation dialog
    page.on('dialog', async dialog => {
      if (dialog.type() === 'confirm') {
        await dialog.accept();
      }
    });

    await login(page, APP_URL);
    await ensureFeedsSeeded(page);

    // --- Open Settings Modal ---
    await page.waitForSelector('#settings-button', { state: 'visible', timeout: 5000 });
    await page.click('#settings-button');
    await page.waitForSelector('.modal-content', { state: 'visible', timeout: 5000 });
    
    // Go to Advanced
    await page.locator('#configure-advanced-settings-btn').click();
    await expect(page.locator('#advanced-settings-block')).toBeVisible();

    // Click the reset button
    const reloadPromise = page.waitForURL(APP_URL, { timeout: 60000 });
    await page.click('#reset-app-button');
    await reloadPromise;

    // Assertions to check console output
    const resetCalled = consoleLogs.some(log => log.text.includes('resetApplicationData called.'));
    const userConfirmed = consoleLogs.some(log => log.text.includes('User confirmed reset: true'));
    const backendReset = networkResponses.some(url => url.includes('/api/admin/reset-app'));

    expect(resetCalled).toBe(true);
    expect(userConfirmed).toBe(true);
    expect(backendReset).toBe(true);
  });
});