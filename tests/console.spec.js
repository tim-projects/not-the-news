// @filepath: tests/console.spec.js
import { test, expect } from '@playwright/test';

test.describe('Console Logs Capture', () => {
  test('should capture console logs after login', async ({ page }) => {
    const consoleMessages = [];

    page.on('console', msg => {
      consoleMessages.push(`[Console ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    await page.goto('https://localhost:8443/login.html', { waitUntil: 'networkidle' });

    // Fill in the password and submit the form
    await page.fill('#password', 'SmjHH2Hd');
    await page.click('button[type="submit"]');

    // Wait for navigation to the main page
    await page.waitForURL('https://localhost:8443/', { waitUntil: 'networkidle' });

    console.log('\n--- Captured Console Logs ---');
    consoleMessages.forEach(msg => console.log(msg));
    console.log('--- End Captured Console Logs ---\n');

    // Assert that there are no critical errors (you can refine this later)
    const criticalErrors = consoleMessages.filter(msg => msg.includes('Uncaught DOMException') || msg.includes('Failed to load'));
    expect(criticalErrors.length).toBe(0);
  });
});

