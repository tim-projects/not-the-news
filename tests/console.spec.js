// @filepath: tests/console.spec.js
import { test, expect } from '@playwright/test';

test.describe('Console Logs Capture', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:8085'; // Use APP_URL from env or default to http://localhost:8085
  const APP_PASSWORD = "devtestpwd"; // Use hardcoded dev password

  test('should capture console logs after login', async ({ page }) => {
    const consoleMessages = [];

    page.on('console', msg => {
      consoleMessages.push(`[Console ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    await page.goto(`${APP_URL}/login.html`, { waitUntil: 'networkidle' });

    // Fill in the password and submit the form
    await page.fill('#pw', APP_PASSWORD); // Use #pw as per other tests
    await page.click('button[type="submit"]');

    // Wait for navigation to the main page
    await page.waitForURL(`${APP_URL}/`, { waitUntil: 'networkidle' });

    console.log('\n--- Captured Console Logs ---');
    consoleMessages.forEach(msg => console.log(msg));
    console.log('--- End Captured Console Logs ---\n');

    // Assert that there are no critical errors (you can refine this later)
    const criticalErrors = consoleMessages.filter(msg => msg.includes('Uncaught DOMException') || msg.includes('Failed to load'));
    expect(criticalErrors.length).toBe(0);
  });
});