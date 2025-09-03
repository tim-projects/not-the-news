import { test, expect } from '@playwright/test';

test.describe('Unread Items', () => {
  const APP_URL = 'https://news.loveopenly.net';
  const APP_PASSWORD = 'SmjHH2Hd'; // From run.sh

  test.beforeEach(async ({ page }) => {
    // Navigate to the login page
    await page.goto(`${APP_URL}/login.html`);

    // Fill the password and click login
    await page.fill('#pw', APP_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for navigation to the main page
    await page.waitForURL(APP_URL);
  });

  test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    // Get a unique name for the screenshot
    const screenshotName = `${testInfo.title.replace(/\s+/g, '-')}-failure.png`;
    await page.screenshot({ path: `test-results/${screenshotName}` });
    console.log(`Screenshot saved to test-results/${screenshotName}`);
  }
});

test('should display unread items', async ({ page }) => {
    page.on('console', msg => {
        console.log(`Browser console log: ${msg.text()}`);
    });
    page.on('console', msg => console.log(msg.text()));

    // Wait for the loading screen to disappear
    await page.waitForSelector('#loading-screen', { state: 'hidden' });

    // Wait for the feed to load
    await page.waitForSelector('#items');

    // Check if there are any unread items
    const unreadItems = await page.locator('#items > .item').count();
    expect(unreadItems).toBeGreaterThan(0);
  });
});