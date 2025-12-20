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

    // --- Interact with app to create some state ---
    // Ensure there are feed items to interact with
    await page.waitForSelector('.entry', { state: 'visible', timeout: 10000 });
    // Star the first item
    await page.click('.entry:first-child .star');
    // Mark the second item as read
    await page.click('.entry:nth-child(2) .read-button');

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
    expect(clearingIndexedDB).toBe(true);
    expect(backendReset).toBe(true);

    // --- Verify application state after reset ---
    // Ensure starred count is 0
    await page.waitForSelector('select#filter-selector option[value="starred"]');
    const starredOptionText = await page.$eval('select#filter-selector option[value="starred"]', el => el.textContent);
    expect(starredOptionText).toContain('Starred (0)');

    // Ensure unread count is 0
    const unreadOptionText = await page.$eval('select#filter-selector option[value="unread"]', el => el.textContent);
    expect(unreadOptionText).toContain('Unread (0)'); // This assumes no new items are loaded immediately.

    // Ensure the main feed is empty (no visible entry elements)
    await page.waitForSelector('#items'); // Wait for the main feed container to be present
    const entryElementsCount = await page.locator('#items .entry').count();
    expect(entryElementsCount).toBe(0); // If feed is truly empty after reset
  });
});
