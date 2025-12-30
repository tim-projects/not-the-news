import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

test.describe('Backup Configuration Button', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:8085';

  test('should trigger a backup download and log events', async ({ page }) => {
    let consoleMessages = [];
    let networkResponses = [];

    page.on('console', msg => {
      consoleMessages.push(`[Console ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    page.on('response', async response => {
      networkResponses.push(`[Response] ${response.status()} ${response.url()}`);
    });

    await login(page, APP_URL);
    await ensureFeedsSeeded(page);

    // --- Open Settings Modal ---
    await page.waitForSelector('#settings-button', { state: 'visible', timeout: 5000 });
    await page.click('#settings-button');
    await page.waitForSelector('.modal', { state: 'visible', timeout: 5000 });
    
    // Go to Advanced
    await page.locator('#configure-advanced-settings-btn').click();
    await expect(page.locator('#advanced-settings-block')).toBeVisible();

    // --- Click Backup Button ---
    const downloadPromise = page.waitForEvent('download');
    await page.click('#backup-config-button');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/not-the-news-config-backup-\d{4}-\d{2}-\d{2}T.*\.json/);
    expect(consoleMessages.some(msg => msg.includes('Configuration backed up successfully!'))).toBeTruthy();
  });
});
