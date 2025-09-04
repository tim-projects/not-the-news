import { test, expect } from '@playwright/test';

test.describe('Unread Items', () => {
  test.use({ ignoreHTTPSErrors: true });

  const APP_URL = 'https://news.loveopenly.net';
  const APP_PASSWORD = 'SmjHH2Hd'; // From run.sh

  test.beforeEach(async ({ page }) => {
    test.setTimeout(60000); // Increase timeout to 60 seconds
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

  test('should mark an item as read and unread', async ({ page }) => {
    // Wait for the loading screen to disappear
    await page.waitForSelector('#loading-screen', { state: 'hidden' });

    // Wait for the feed to load
    await page.waitForSelector('#items');

    // Ensure we are in the "Unread" filter mode initially
    await page.selectOption('#filter-selector', 'unread');
    await page.waitForTimeout(500); // Give UI time to update

    // Find the first unread item
    const firstUnreadItem = page.locator('#items > .item:not(.read)').first();
    await expect(firstUnreadItem).toBeVisible();
    const initialGuid = await firstUnreadItem.getAttribute('data-guid');

    // Mark the item as read
    await firstUnreadItem.locator('.read-toggle').click();
    await page.waitForTimeout(500); // Give UI time to update

    // Verify visual change: item should have 'read' class
    await expect(firstUnreadItem).toHaveClass(/.*read/);

    // Verify item disappears from "Unread" view (it should still be in the DOM but hidden by filter)
    // We can't directly check visibility if it's filtered out, so we'll check its presence in the 'all' view later.

    // Change filter to "All"
    await page.selectOption('#filter-selector', 'all');
    await page.waitForTimeout(500); // Give UI time to update

    // Find the item again in "All" view and verify it's marked as read
    const itemInAllView = page.locator(`#items > .item[data-guid="${initialGuid}"]`);
    await expect(itemInAllView).toBeVisible();
    await expect(itemInAllView).toHaveClass(/.*read/);

    // Mark the item as unread
    await itemInAllView.locator('.read-toggle').click();
    await page.waitForTimeout(500); // Give UI time to update

    // Verify visual change: item should NOT have 'read' class
    await expect(itemInAllView).not.toHaveClass(/.*read/);

    // Change filter back to "Unread"
    await page.selectOption('#filter-selector', 'unread');
    await page.waitForTimeout(500); // Give UI time to update

    // Verify item reappears in "Unread" view
    const itemInUnreadView = page.locator(`#items > .item[data-guid="${initialGuid}"]`);
    await expect(itemInUnreadView).toBeVisible();
    await expect(itemInUnreadView).not.toHaveClass(/.*read/);
  });
});