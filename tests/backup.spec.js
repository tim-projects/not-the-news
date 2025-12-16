import { test, expect } from '@playwright/test';

test.describe('Backup Configuration', () => {
  test('should initiate download of config file', async ({ page }) => {
    let consoleLogs = [];
    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location().url
      });
    });

    // Listen for network requests to the backup endpoint
    let backupRequest;
    page.on('request', request => {
      if (request.url().includes('/api/admin/config-backup')) {
        backupRequest = request;
      }
    });

    // Listen for network responses from the backup endpoint
    let backupResponse;
    page.on('response', response => {
      if (response.url().includes('/api/admin/config-backup')) {
        backupResponse = response;
      }
    });

        await page.goto('http://localhost:8085/index.html');

        await page.waitForLoadState('networkidle'); // Wait for network to be idle

    

        // Click the cog wheel button to open settings

        await page.click('.cog-wheel-button');

        // Wait for the settings modal content to be visible

        await page.waitForSelector('.modal-content', { state: 'visible' });

    

        // Wait for the backup button to be visible and enabled
    await page.waitForSelector('#backup-config-button', { state: 'visible' });

    // Click the backup button
    await page.click('#backup-config-button');

    // Wait for network activity related to the backup request to settle
    await page.waitForLoadState('networkidle');

    // Wait for a short period to allow console logs to be captured
    await page.waitForTimeout(1000);

    // Assertions
    expect(consoleLogs.some(log => log.text.includes('backupConfig called.'))).toBe(true);
    expect(consoleLogs.some(log => log.text.includes('Fetching config for backup from: /api/admin/config-backup'))).toBe(true);

    expect(backupRequest, 'Backup API request should have been made').toBeDefined();
    expect(backupResponse, 'Backup API response should have been received').toBeDefined();
    expect(backupResponse.ok(), 'Backup API response should be OK').toBe(true);

    // Check for success message
    expect(consoleLogs.some(log => log.text.includes('Configuration backed up successfully!'))).toBe(true);

    // Output all console logs for review
    console.log('\n--- Console Logs ---');
    consoleLogs.forEach(log => {
      console.log(`[${log.type}] ${log.text}`);
    });
    console.log('--------------------\n');
  });
});
