import { test, expect } from '@playwright/test';

test.describe('Reset Application Data', () => {
  test('should call resetApplicationData and handle confirmation', async ({ page }) => {
    let consoleLogs = [];
    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location().url
      });
    });

    // Handle the confirmation dialog
    page.on('dialog', async dialog => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('Are you sure you want to reset the application?');
      await dialog.accept(); // Accept the confirmation
    });

    await page.goto('http://localhost:8085/index.html');
    await page.waitForLoadState('networkidle'); // Wait for network to be idle

    // Click the cog wheel button to open settings
    await page.click('.cog-wheel-button');
    // Wait for the settings modal content to be visible
    await page.waitForSelector('.modal-content', { state: 'visible' });
    // Wait for the reset button to be visible and enabled before clicking
    await page.waitForSelector('#reset-app-button', { state: 'visible' });
    
    // Click the reset button
    await page.click('#reset-app-button');

    // Wait for a short period to allow console logs to be captured
    await page.waitForTimeout(1000); 

    // Assertions to check console output
    const resetCalled = consoleLogs.some(log => log.text.includes('resetApplicationData called.'));
    const userConfirmed = consoleLogs.some(log => log.text.includes('User confirmed reset: true'));
    const clearingIndexedDB = consoleLogs.some(log => log.text.includes('Clearing IndexedDB databases...'));

    expect(resetCalled).toBe(true);
    expect(userConfirmed).toBe(true);
    expect(clearingIndexedDB).toBe(true); // Check if the process started

    // Output all console logs for review
    console.log('\n--- Console Logs ---');
    consoleLogs.forEach(log => {
      console.log(`[${log.type}] ${log.text}`);
    });
    console.log('--------------------\n');
  });
});
