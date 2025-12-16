const { test, expect } = require('@playwright/test');

test.describe('Unread Items', () => {
  // test.use({ ignoreHTTPSErrors: true }); // Handled globally in playwright.config.js

  const APP_URL = process.env.APP_URL || 'http://localhost:8085';
  const APP_PASSWORD = "devtestpwd"; // Consistent with other tests

  test.beforeEach(async ({ page }) => {
    test.setTimeout(60000); // Increase timeout to 60 seconds
    // Navigate to the login page
    await page.goto(`${APP_URL}/login.html`);

    // Fill the password and click login
    await page.fill('#pw', APP_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for navigation to the main page
    await page.waitForURL(APP_URL);

    // Clear the deck on the server
    await page.request.post(`${APP_URL}/api/user-state`, {
      data: [{
        type: 'simpleUpdate',
        key: 'currentDeckGuids',
        value: []
      }]
    });

    await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('not-the-news-db');
        request.onsuccess = (event) => {
          const db = event.target.result;
          const transaction = db.transaction(['currentDeckGuids'], 'readwrite');
          const objectStore = transaction.objectStore('currentDeckGuids');
          const clearRequest = objectStore.clear();
          clearRequest.onsuccess = () => {
            resolve();
          };
          clearRequest.onerror = (event) => {
            reject(event.target.error);
          };
        };
        request.onerror = (event) => {
          reject(event.target.error);
        };
      });
    });

    await page.reload();

    // Open settings
    await page.click('#settings-button');
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