import { test, expect } from '@playwright/test';

test.describe('Reset Application Data', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:8085';
  const APP_PASSWORD = "devtestpwd";

  test('should call resetApplicationData and handle confirmation', async ({ page }) => {
    let consoleLogs = [];
    let networkRequests = [];
    let networkResponses = [];

    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location().url
      });
    });

    page.on('request', request => {
      networkRequests.push(`[Request] ${request.method()} ${request.url()}`);
    });

    page.on('response', async response => {
      networkResponses.push(`[Response] ${response.status()} ${response.url()}`);
    });

    // Handle the confirmation dialog
    page.on('dialog', async dialog => {
      console.log(`[Test] Dialog appeared: ${dialog.type()} - ${dialog.message()}`);
      if (dialog.type() === 'confirm') {
        await dialog.accept(); // Accept the confirmation
      }
    });

    // --- Login ---
    await page.goto(`${APP_URL}/login.html`, { waitUntil: 'networkidle' });
    await page.fill('#pw', APP_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${APP_URL}/`, { waitUntil: 'networkidle' });

    consoleLogs = []; // Clear for next step

    // --- Open Settings Modal ---
    await page.waitForSelector('#settings-button', { state: 'visible', timeout: 5000 });
    await page.click('#settings-button');
    
    // Wait for the settings modal content to be visible
    await page.waitForSelector('.modal-content', { state: 'visible', timeout: 5000 });
    
    // Wait for the reset button to be visible and enabled before clicking
    await page.waitForSelector('#reset-app-button', { state: 'visible', timeout: 5000 });
    
    // Click the reset button
    await page.click('#reset-app-button');

    // Wait for potential asynchronous operations and page reload
    try {
        await page.waitForURL(`${APP_URL}/`, { waitUntil: 'networkidle', timeout: 5000 });
    } catch (e) {
        console.log('[Test] Timeout waiting for page reload, checking logs anyway.');
    }

    // Assertions to check console output
    const resetCalled = consoleLogs.some(log => log.text.includes('resetApplicationData called.'));
    const userConfirmed = consoleLogs.some(log => log.text.includes('User confirmed reset: true'));
    const clearingIndexedDB = consoleLogs.some(log => log.text.includes('Clearing IndexedDB databases...'));
    const backendReset = networkResponses.some(res => res.includes('/api/admin/reset-app') && res.includes('200'));

    console.log('\n--- Console Logs ---');
    consoleLogs.forEach(log => {
      console.log(`[${log.type}] ${log.text}`);
    });
    console.log('--------------------\n');

    console.log('\n--- Network Responses ---');
    networkResponses.forEach(res => console.log(res));
    console.log('------------------------\n');

    expect(resetCalled).toBe(true);
    expect(userConfirmed).toBe(true);
    expect(backendReset).toBe(true);
  });
});
