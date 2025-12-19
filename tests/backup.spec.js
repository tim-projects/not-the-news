// @filepath: tests/backup.spec.js
import { test, expect } from '@playwright/test';

test.describe('Backup Configuration Button', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:8085';
  const APP_PASSWORD = "devtestpwd";

  test('should trigger a backup download and log events', async ({ page }) => {
    let consoleMessages = [];
    let networkRequests = [];
    let networkResponses = [];

    page.on('console', msg => {
      consoleMessages.push(`[Console ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    page.on('request', request => {
      networkRequests.push(`[Request] ${request.method()} ${request.url()}`);
    });

    page.on('response', async response => {
      networkResponses.push(`[Response] ${response.status()} ${response.url()}`);
      // Log response body for specific endpoints if needed
      if (response.url().includes('/api/admin/config-backup')) {
        try {
          const body = await response.json();
          networkResponses.push(`  [Response Body] ${JSON.stringify(body)}`);
        } catch (e) {
          networkResponses.push(`  [Response Body] (Non-JSON or empty)`);
        }
      }
    });

    // --- Login ---
    await page.goto(`${APP_URL}/login.html`, { waitUntil: 'networkidle' });
    await page.fill('#pw', APP_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${APP_URL}/`, { waitUntil: 'networkidle' });

    console.log('\n--- Initial Console Logs (After Login) ---');
    consoleMessages.forEach(msg => console.log(msg));
    console.log('--- End Initial Console Logs ---\n');

    consoleMessages = []; // Clear for next step
    networkRequests = [];
    networkResponses = [];

    // --- Open Settings Modal ---
    await page.waitForSelector('#settings-button', { state: 'visible', timeout: 5000 });
    await page.click('#settings-button');
    await page.waitForSelector('.modal', { state: 'visible', timeout: 5000 }); // Wait for modal to appear
    
    // Check if the modal content is visible
    await page.waitForSelector('#main-settings', { state: 'visible', timeout: 5000 });


    console.log('\n--- Console Logs (After Opening Settings) ---');
    consoleMessages.forEach(msg => console.log(msg));
    console.log('--- End Console Logs ---\n');

    consoleMessages = []; // Clear for next step
    networkRequests = [];
    networkResponses = [];

    // --- Click Backup Button ---
    // Wait for the backup button to be visible and enabled within the modal
    await page.waitForSelector('#backup-config-button', { state: 'visible', timeout: 5000 });
    await page.click('#backup-config-button');

    // Wait briefly for potential asynchronous operations or downloads
    await page.waitForTimeout(2000); 

    console.log('\n--- Console Logs (After Clicking Backup Button) ---');
    consoleMessages.forEach(msg => console.log(msg));
    console.log('--- End Console Logs ---\n');

    console.log('\n--- Network Requests (After Clicking Backup Button) ---');
    networkRequests.forEach(req => console.log(req));
    console.log('--- End Network Requests ---\n');

    console.log('\n--- Network Responses (After Clicking Backup Button) ---');
    networkResponses.forEach(res => console.log(res));
    console.log('--- End Network Responses ---\n');

    // We expect a download to be initiated, but Playwright doesn't directly
    // capture downloads initiated by `a.click()` on a Blob URL.
    // Instead, we'll look for console messages indicating success/failure
    // and a successful network response from /api/admin/config-backup.
    expect(networkResponses.some(res => res.includes('/api/admin/config-backup') && res.includes('200'))).toBeTruthy();
    expect(consoleMessages.some(msg => msg.includes('Configuration backed up successfully!'))).toBeTruthy();
  });
});