const { test, expect } = require('@playwright/test');

test.describe('Flick to Select', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8085');
    // Wait for app to initialize and loading screen to disappear
    await page.waitForSelector('#loading-screen', { state: 'hidden' });
    // Ensure there are items
    await page.waitForSelector('.entry');
  });

  test('should select next item on wheel flick down', async ({ page }) => {
    // Get initial selected item
    const firstItem = page.locator('.entry').first();
    const firstGuid = await firstItem.getAttribute('data-guid');
    
    // Ensure first item is selected (auto-select logic)
    await expect(firstItem).toHaveClass(/selected-item/);

    // Simulate wheel flick down
    await page.mouse.wheel(0, 500);
    
    // Wait for selection to change
    const secondItem = page.locator('.entry').nth(1);
    await expect(secondItem).toHaveClass(/selected-item/);
    
    const secondGuid = await secondItem.getAttribute('data-guid');
    expect(secondGuid).not.toBe(firstGuid);
  });

  test('should select previous item on wheel flick up', async ({ page }) => {
    // Select second item first
    const secondItem = page.locator('.entry').nth(1);
    await secondItem.click();
    await expect(secondItem).toHaveClass(/selected-item/);

    // Simulate wheel flick up
    await page.mouse.wheel(0, -500);
    
    // Wait for selection to change back to first
    const firstItem = page.locator('.entry').first();
    await expect(firstItem).toHaveClass(/selected-item/);
  });

  test('should not change selection on small scroll', async ({ page }) => {
    const firstItem = page.locator('.entry').first();
    await expect(firstItem).toHaveClass(/selected-item/);

    // Small scroll (less than 100 threshold)
    await page.mouse.wheel(0, 50);
    
    // Should still be on first item (give it a moment)
    await page.waitForTimeout(500);
    await expect(firstItem).toHaveClass(/selected-item/);
    const secondItem = page.locator('.entry').nth(1);
    await expect(secondItem).not.toHaveClass(/selected-item/);
  });
});
