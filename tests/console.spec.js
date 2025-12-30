import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

test.describe('Console Logs Capture', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:8085';

  test('should capture console logs after clicking settings cog after login', async ({ page }) => {
    let consoleMessages = [];

    page.on('console', msg => {
      consoleMessages.push(`[Console ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    await login(page, APP_URL);
    await ensureFeedsSeeded(page);

    consoleMessages = []; 

    await page.waitForSelector('#settings-button', { state: 'visible', timeout: 5000 });
    await page.click('#settings-button');
    await page.waitForTimeout(1000); 

    console.log('\n--- Console Logs After Clicking Settings Cog ---');
    consoleMessages.forEach(msg => console.log(msg));
    console.log('--- End Console Logs After Clicking Settings Cog ---\n');
  });
});