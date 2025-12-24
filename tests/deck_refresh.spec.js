const { test, expect } = require('@playwright/test');

const APP_URL = process.env.APP_URL || 'http://localhost:8085';
const APP_PASSWORD = "devtestpwd";

test.describe('Deck Refresh Logic', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the login page
    await page.goto(`${APP_URL}/login.html`, { waitUntil: 'networkidle' });

    // Fill the password and click login
    await page.fill('#pw', APP_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for navigation to the main page
    await page.waitForURL(APP_URL);
    // Wait for loading screen to be hidden
    await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 30000 });
    // Wait for the app viewport to be visible
    await page.waitForSelector('#app-viewport', { state: 'visible', timeout: 30000 });
    // Wait for the app to load - using data-guid attribute for better reliability
    await page.locator('[data-guid]').first().waitFor({ state: 'visible', timeout: 30000 });
  });

  test('should show a new deck when all items in current deck are marked read', async ({ page }) => {
    const initialFirstItem = await page.locator('.item.entry .itemtitle div').first().innerText();
    console.log(`Initial first item: ${initialFirstItem}`);

    const initialDeckCount = await page.locator('.item.entry').count();
    console.log(`Initial deck count: ${initialDeckCount}`);

    // Mark all items as read using the UI
    for (let i = 0; i < initialDeckCount; i++) {
      // Find the first UNREAD item's read button and click it
      // In unread mode (default), items should disappear after being marked read
      const btn = page.locator('#items > .item.entry:not(.help-panel-item) .itemtitle .read-button').first();
      await btn.click();
      await page.waitForTimeout(500); 
    }

    console.log('Deck cleared, waiting for refresh...');
    
    // Wait for a new set of items to appear (automatic refresh)
    await expect(async () => {
      const currentFirstItem = await page.locator('.item.entry .itemtitle div').first().innerText();
      expect(currentFirstItem).not.toBe(initialFirstItem);
    }).toPass({ timeout: 15000 });
    
    const newDeckCount = await page.locator('.item.entry').count();
    console.log(`New deck count: ${newDeckCount}`);
    expect(newDeckCount).toBeGreaterThan(0);
  });

  test('should show a new deck when shuffle button is clicked', async ({ page }) => {
    const firstItemTitle = await page.locator('.item.entry .itemtitle div').first().innerText();
    console.log(`Initial first item: ${firstItemTitle}`);

    await page.click('#shuffle-button');
    
    // Wait for update
    await expect(async () => {
      const newFirstItemTitle = await page.locator('.item.entry .itemtitle div').first().innerText();
      expect(newFirstItemTitle).not.toBe(firstItemTitle);
    }).toPass({ timeout: 10000 });
  });

  test('should set item opacity to 0.5 when marked as read', async ({ page }) => {
    // Switch to 'all' mode so item doesn't disappear
    await page.selectOption('#filter-selector', 'all');
    await page.waitForTimeout(1000);

    const firstItem = page.locator('.item.entry').first();
    const readButton = firstItem.locator('.read-button');

    // Mark as unread first if it's already read (unlikely but possible in some states)
    const isRead = await firstItem.evaluate(el => el.classList.contains('read'));
    if (isRead) {
        await readButton.click();
        await expect(firstItem).not.toHaveClass(/read/);
        await page.waitForTimeout(500);
    }

    // Verify initial opacity is roughly 0.8 (unselected) or 1.0 (selected)
    const initialOpacity = await firstItem.evaluate(el => window.getComputedStyle(el).opacity);
    console.log(`Initial opacity: ${initialOpacity}`);
    
    // Mark as read
    await readButton.click();
    
    // Wait for class application
    await expect(firstItem).toHaveClass(/read/);
    
    // Verify opacity is 0.5 (when not selected)
    // Deselect it first to be sure
    await page.click('header'); 
    
    const finalOpacity = await firstItem.evaluate(el => window.getComputedStyle(el).opacity);
    console.log(`Final opacity (unselected): ${finalOpacity}`);
    expect(parseFloat(finalOpacity)).toBeCloseTo(0.5, 1);
  });
});
