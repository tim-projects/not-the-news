import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

test.describe('Flick to Select', () => {
  const APP_URL = 'http://localhost:5173';

  test.beforeEach(async ({ page }) => {
    await login(page, APP_URL);
    await ensureFeedsSeeded(page);
    // Ensure there are items
    await page.waitForSelector('.entry', { state: 'visible', timeout: 60000 });
  });

  test('should select next item on wheel flick down', async ({ page }) => {
    // Get initial selected item
    const items = page.locator('.entry:not(.help-panel-item)');
    const firstItem = items.first();
    const firstGuid = await firstItem.getAttribute('data-guid');
    
    // Ensure first item is selected (auto-select logic)
    await expect(firstItem).toHaveClass(/selected-item/);

    // Simulate wheel flick down
    await page.mouse.wheel(0, 500);
    
    // Wait for selection to change
    const secondItem = items.nth(1);
    await expect(secondItem).toHaveClass(/selected-item/);
    
    const secondGuid = await secondItem.getAttribute('data-guid');
    expect(secondGuid).not.toBe(firstGuid);
  });

  test('should select previous item on wheel flick up', async ({ page }) => {
    // Select second item first
    const items = page.locator('.entry:not(.help-panel-item)');
    const secondItem = items.nth(1);
    await secondItem.click();
    await expect(secondItem).toHaveClass(/selected-item/);

    // Simulate wheel flick up
    await page.mouse.wheel(0, -500);
    
    // Wait for selection to change back to first
    const firstItem = items.first();
    await expect(firstItem).toHaveClass(/selected-item/);
  });

  test('should not change selection on small scroll', async ({ page }) => {
    const items = page.locator('.entry:not(.help-panel-item)');
    const firstItem = items.first();
    await expect(firstItem).toHaveClass(/selected-item/);

    // Small scroll (less than 100 threshold)
    await page.mouse.wheel(0, 50);
    
    // Should still be on first item (give it a moment)
    await page.waitForTimeout(500);
    await expect(firstItem).toHaveClass(/selected-item/);
    const secondItem = items.nth(1);
    await expect(secondItem).not.toHaveClass(/selected-item/);
  });
});