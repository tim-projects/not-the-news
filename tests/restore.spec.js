// @filepath: tests/restore.spec.js
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Restore Configuration Button', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:8085';
  const APP_PASSWORD = "devtestpwd";
  const sampleConfigFile = path.join(__dirname, 'sample_config.json');

  test('should restore configuration from a file and log events', async ({ page }) => {
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
      if (response.url().includes('/api/admin/config-restore')) {
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

    consoleMessages = []; // Clear for next step

    // --- Open Settings Modal ---
    await page.waitForSelector('#settings-button', { state: 'visible', timeout: 5000 });
    await page.click('#settings-button');
    await page.waitForSelector('.modal', { state: 'visible', timeout: 5000 });
    await page.waitForSelector('#main-settings', { state: 'visible', timeout: 5000 });

    consoleMessages = []; // Clear for next step
    networkRequests = [];
    networkResponses = [];

    // --- Click Restore Button and Upload File ---
    await page.waitForSelector('input[type="file"]', { state: 'hidden' });

    // Set the file to the hidden file input
    await page.setInputFiles('input[type="file"]', sampleConfigFile);
    
    // Wait briefly for potential asynchronous operations
    await page.waitForTimeout(2000);

    console.log('\n--- Console Logs (After Restoring Config) ---');
    consoleMessages.forEach(msg => console.log(msg));
    console.log('--- End Console Logs ---\n');

    console.log('\n--- Network Requests (After Restoring Config) ---');
    networkRequests.forEach(req => console.log(req));
    console.log('--- End Network Requests ---\n');

    console.log('\n--- Network Responses (After Restoring Config) ---');
    networkResponses.forEach(res => console.log(res));
    console.log('--- End Network Responses ---\n');
    
    // Check for successful network response
    expect(networkResponses.some(res => res.includes('/api/admin/config-restore') && res.includes('200'))).toBeTruthy();
    
    // Check for success message in console
    expect(consoleMessages.some(msg => msg.includes('Configuration restored successfully!'))).toBeTruthy();
  });
});
