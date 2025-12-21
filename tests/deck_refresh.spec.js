import { test, expect } from '@playwright/test';

test.describe('Deck Refresh on Empty', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:8085';
  const APP_PASSWORD = "devtestpwd";

  test('should generate and display a new deck after the current one is cleared', async ({ page }) => {
    // --- Login ---
    await page.goto(`${APP_URL}/login.html`, { waitUntil: 'networkidle' });
    await page.fill('#pw', APP_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${APP_URL}/`, { waitUntil: 'networkidle' });

    // --- 1. Initial Load ---
    console.log('[Test] Waiting for initial deck to load...');
    await page.waitForSelector('#items .entry', { state: 'visible', timeout: 15000 });
    const initialEntryElements = await page.locator('#items .entry').all();
    const initialEntryCount = initialEntryElements.length;
    console.log(`[Test] Initial deck loaded with ${initialEntryCount} items.`);
    expect(initialEntryCount).toBeGreaterThan(0); // Make sure we have items to interact with

    // --- 2. Mark all items as read ---
    console.log(`[Test] Marking all ${initialEntryCount} items as read...`);
    for (let i = 0; i < initialEntryCount; i++) {
        // Always click the first read button in the list, as the list re-renders.
        const firstReadButton = page.locator('#items .entry .read-button').first();
        await firstReadButton.evaluate(button => button.click());
        // Give time for the UI to update and remove the item
        await page.waitForTimeout(200); 
    }
    console.log('[Test] All items marked as read.');
    
    // Give time for the deck to become empty and the app to react
    await page.waitForTimeout(2000); 

    // --- 3. Assertions ---
    console.log('[Test] Verifying deck refresh...');

    // Verify the 'Read' count in the filter dropdown

    const readOptionText = await page.$eval('select#filter-selector option[value="read"]', el => el.textContent);
    expect(readOptionText).toContain(`Read (${initialEntryCount})`);

    // Verify the current deck in the UI is empty now
    // We expect the old items to be gone
    const intermediateEntryCount = await page.locator('#items .entry').count();
    console.log(`[Test] Intermediate entry count (should be 0): ${intermediateEntryCount}`);
    expect(intermediateEntryCount).toBe(0);

    // Verify that a new deck is generated and displayed
    console.log('[Test] Waiting for new deck to be displayed...');
    // We wait for new '.entry' elements to appear, different from the old ones.
    // The total number might be different, but it should be greater than 0.
    await page.waitForSelector('#items .entry', { state: 'visible', timeout: 10000 });
    const finalEntryCount = await page.locator('#items .entry').count();
    console.log(`[Test] New deck displayed with ${finalEntryCount} items.`);
    expect(finalEntryCount).toBeGreaterThan(0);
  });
});
