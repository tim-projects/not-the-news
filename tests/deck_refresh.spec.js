import { test, expect } from '@playwright/test';

test.describe('Deck Refresh on Empty', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:8085';
  const APP_PASSWORD = "devtestpwd";

  test('should generate and display a new deck after the current one is cleared', async ({ page }) => {
    let consoleLogs = [];
    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location().url
      });
      console.log(`[Browser Console ${msg.type().toUpperCase()}] ${msg.text()}`); // Print immediately
    });

    // --- Login ---
    await page.goto(`${APP_URL}/login.html`, { waitUntil: 'networkidle' });
    await page.fill('#pw', APP_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${APP_URL}/`, { waitUntil: 'networkidle' });

    // --- 0. Reset User State for Clean Test (Keep Feeds) ---
    console.log('[Test] Resetting user state for clean test...');
    
    // Clear backend user state
    await page.request.post(`${APP_URL}/api/user-state`, {
        data: {
            read: [],
            starred: [],
            currentDeckGuids: [],
            shuffledOutGuids: [],
            shuffleCount: 0,
            lastShuffleResetDate: new Date().toDateString()
        }
    });

    await page.evaluate(async () => {
        // Clear local storage state
        localStorage.removeItem('shuffleCount');
        localStorage.removeItem('lastShuffleResetDate');
        localStorage.removeItem('filterMode');
        
        // Clear IndexedDB user stores
        const DB_NAME = 'not-the-news-db';
        const openDB = () => new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        try {
            const db = await openDB();
            const stores = ['read', 'starred', 'currentDeckGuids', 'shuffledOutGuids'];
            const existingStores = Array.from(db.objectStoreNames);
            const storesToClear = stores.filter(s => existingStores.includes(s));
            
            if (storesToClear.length > 0) {
                const tx = db.transaction(storesToClear, 'readwrite');
                await Promise.all(storesToClear.map(s => tx.objectStore(s).clear()));
                await new Promise((resolve) => { tx.oncomplete = resolve; });
            }
            db.close();
        } catch (e) {
            console.error('Error clearing IDB:', e);
        }
    });
    
    // Reload to apply reset
    await page.reload({ waitUntil: 'networkidle' });

    // --- 1. Initial Load ---
    console.log('[Test] Waiting for initial deck to load...');
    await page.waitForSelector('#items .entry', { state: 'visible', timeout: 15000 });
    const initialEntryElements = await page.locator('#items .entry').all();
    const initialEntryCount = initialEntryElements.length;
    console.log(`[Test] Initial deck loaded with ${initialEntryCount} items.`);
    expect(initialEntryCount).toBeGreaterThan(0); 

    // Capture initial read count
    const initialReadCountText = await page.$eval('select#filter-selector option[value="read"]', el => el.textContent);
    const initialReadCountMatch = initialReadCountText.match(/\((\d+)\)/);
    const initialReadCount = initialReadCountMatch ? parseInt(initialReadCountMatch[1]) : 0;
    console.log(`[Test] Initial total read count: ${initialReadCount}`);

    // --- 2. Mark all items as read ---
    console.log(`[Test] Marking all ${initialEntryCount} items as read...`);
    for (let i = 0; i < initialEntryCount; i++) {
        // We always click the FIRST unread button
        const firstUnreadButton = page.locator('#items .entry .read-button:not(.read)').first();
        
        await expect(firstUnreadButton).toBeVisible({ timeout: 5000 });
        
        const entry = page.locator('#items .entry').first();
        const guid = await entry.getAttribute('data-guid');
        console.log(`[Test] Clicking unread button ${i + 1}/${initialEntryCount} (GUID: ${guid})`);
        
        await firstUnreadButton.click();
        
        // Wait for the entry to be removed from the DOM (since we are in unread mode)
        await expect(page.locator(`#items .entry[data-guid="${guid}"]`)).toBeHidden({ timeout: 5000 });
        
        // Short wait for stability
        await page.waitForTimeout(200); 
    }
    console.log('[Test] All items marked as read.');
    
    // --- 3. Assertions ---
    console.log('[Test] Verifying deck refresh...');

    // Verify the 'Read' count in the filter dropdown has increased
    await expect(async () => {
        const text = await page.$eval('select#filter-selector option[value="read"]', el => el.textContent);
        const match = text.match(/\((\d+)\)/);
        const count = match ? parseInt(match[1]) : 0;
        console.log(`[Test] Current total read count: ${count}`);
        expect(count).toBeGreaterThanOrEqual(initialReadCount + initialEntryCount);
    }).toPass({ timeout: 10000 });

    console.log('[Test] Read count verified.');

    // Verify that a new deck is generated and displayed
    console.log('[Test] Waiting for new deck to be displayed...');
    // We wait for new '.entry' elements to appear.
    await page.waitForSelector('#items .entry', { state: 'visible', timeout: 15000 });
    const finalEntryCount = await page.locator('#items .entry').count();
    console.log(`[Test] New deck displayed with ${finalEntryCount} items.`);
    expect(finalEntryCount).toBeGreaterThan(0);
  });
});
