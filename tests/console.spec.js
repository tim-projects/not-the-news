// @filepath: tests/console.spec.js
import { test, expect } from '@playwright/test';

test.describe('Console Logs Capture for Settings Cog', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:8085'; // Use APP_URL from env or default to http://localhost:8085
  const APP_PASSWORD = "devtestpwd"; // Use hardcoded dev password

  test('should capture console logs after clicking settings cog after login', async ({ page }) => {
    let consoleMessages = [];

    page.on('console', msg => {
      consoleMessages.push(`[Console ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    // --- Login ---
    await page.goto(`${APP_URL}/login.html`, { waitUntil: 'networkidle' });
    await page.fill('#pw', APP_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${APP_URL}/`, { waitUntil: 'networkidle' });

    console.log('\n--- Console Logs After Initial Page Load (After Login) ---');
    consoleMessages.forEach(msg => console.log(msg));
    console.log('--- End Console Logs After Initial Page Load ---\n');

    // Clear messages to capture only logs related to settings cog click
    consoleMessages = []; 

    // --- Click Settings Cog ---
    // Wait for the settings button to be visible and enabled
    await page.waitForSelector('#settings-button', { state: 'visible', timeout: 5000 });
    await page.click('#settings-button');
    
    // Give Alpine.js some time to react and update the DOM/state
    await page.waitForTimeout(1000); 

    console.log('\n--- Console Logs After Clicking Settings Cog ---');
    consoleMessages.forEach(msg => console.log(msg));
    console.log('--- End Console Logs After Clicking Settings Cog ---\n');

    // No assertion needed, just capturing logs for debugging.
  });
});
