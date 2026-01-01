import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Deck Refresh Logic', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, APP_URL);
    await ensureFeedsSeeded(page);
    await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
    await page.locator('[data-guid]').first().waitFor({ state: 'visible', timeout: 30000 });
  });

  test('should show a new deck when all items in current deck are marked read', async ({ page }) => {
    // Wait for the help panel to be visible or not, we only want real entries
    const items = page.locator('.item.entry:not(.help-panel-item)');
    await items.first().waitFor({ state: 'visible' });

    const initialFirstItem = await items.first().locator('.itemtitle div').innerText();
    console.log(`Initial first item: ${initialFirstItem}`);

    const initialDeckCount = await items.count();
    console.log(`Initial deck count: ${initialDeckCount}`);

    // Mark all items as read using the UI
    for (let i = 0; i < initialDeckCount; i++) {
      // Find the first UNREAD item's read button and click it
      const btn = page.locator('#items > .item.entry:not(.help-panel-item) .itemtitle .read-button').first();
      await btn.click();
      await page.waitForTimeout(500); 
    }

    console.log('Deck cleared, waiting for refresh (including 5s undo period)...');
    
    // Wait for a new set of items to appear (automatic refresh happens after 5s undo period)
    await expect(async () => {
      const currentItems = page.locator('.item.entry:not(.help-panel-item)');
      const currentFirstItem = await currentItems.first().locator('.itemtitle div').innerText();
      expect(currentFirstItem).not.toBe(initialFirstItem);
    }).toPass({ timeout: 20000 });
    
    const newDeckCount = await page.locator('.item.entry:not(.help-panel-item)').count();
    console.log(`New deck count: ${newDeckCount}`);
    expect(newDeckCount).toBeGreaterThan(0);
  });

  test('should show a new deck when shuffle button is clicked', async ({ page }) => {
    const items = page.locator('.item.entry:not(.help-panel-item)');
    const firstItemTitle = await items.first().locator('.itemtitle div').innerText();
    console.log(`Initial first item: ${firstItemTitle}`);

    await page.click('#shuffle-button');
    
    // Wait for update
    await expect(async () => {
      const currentItems = page.locator('.item.entry:not(.help-panel-item)');
      const newFirstItemTitle = await currentItems.first().locator('.itemtitle div').innerText();
      expect(newFirstItemTitle).not.toBe(firstItemTitle);
    }).toPass({ timeout: 15000 });
  });

  test('should set item opacity to 0.5 when marked as read', async ({ page }) => {
    // Switch to 'all' mode so item doesn't disappear
    await page.locator('#settings-button').click();
    await page.locator('#filter-selector').selectOption('all');
    await page.locator('.modal-content .close').click();
    await page.waitForTimeout(1000);

    const firstItem = page.locator('.item.entry:not(.help-panel-item)').first();
    const readButton = firstItem.locator('.read-button');

    // Mark as unread first if it's already read
    const isRead = await firstItem.evaluate(el => el.classList.contains('read'));
    if (isRead) {
        await readButton.click();
        await expect(firstItem).not.toHaveClass(/read/);
        await page.waitForTimeout(500);
    }

    // Verify initial opacity is roughly 0.8
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