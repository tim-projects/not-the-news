import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';
const APP_PASSWORD = "devtestpwd";

test.describe('Shuffle Persistence', () => {
    test.beforeEach(async ({ page, request }) => {
        page.on('console', msg => console.log(`BROWSER CONSOLE: ${msg.text()}`));

        // --- NEW: Restore sample config to ensure feeds exist BEFORE first login ---
        const config = {
            "rssFeeds": [
                "https://www.nasa.gov/news-release/feed/",
                "https://www.theverge.com/rss/index.xml",
                "https://feeds.bbci.co.uk/news/rss.xml",
                "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
            ],
            "keywordBlacklist": ["test"],
            "syncEnabled": true
        };
        const restoreResponse = await request.post(`${APP_URL}/api/admin/config-restore`, {
            data: config,
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': APP_PASSWORD
            }
        });
        await expect(restoreResponse.status()).toBe(200);
        // --- END NEW ---

        // Login flow
        await page.goto(`${APP_URL}/login.html`);
        const loginResponse = await request.post(`${APP_URL}/api/login`, {
            data: { password: APP_PASSWORD },
            headers: { 'Content-Type': 'application/json' }
        });
        await expect(loginResponse.status()).toBe(200);

        const setCookieHeader = loginResponse.headers()['set-cookie'];
        if (setCookieHeader) {
            const authCookieString = setCookieHeader.split(',').find(s => s.trim().startsWith('auth='));
            if (authCookieString) {
                const parts = authCookieString.split(';');
                const nameValue = parts[0].trim().split('=');
                await page.context().addCookies([{
                    name: nameValue[0],
                    value: nameValue[1],
                    domain: new URL(APP_URL).hostname,
                    path: '/',
                    expires: -1
                }]);
            }
        }

        // Trigger explicit sync
        console.log("Triggering manual feed sync...");
        const syncResponse = await request.post(`${APP_URL}/api/feed-sync`, {
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': APP_PASSWORD
            }
        });
        const syncStatus = syncResponse.status();
        const syncBody = await syncResponse.text();
        console.log(`Manual feed sync status: ${syncStatus}`);
        console.log(`Manual feed sync response: ${syncBody}`);
        await expect(syncStatus).toBe(200);

        await page.goto(APP_URL);
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await expect(page.locator('#header')).toBeVisible();
        
        // Wait for feed items to be synced and loaded
        console.log("Waiting for .item to be visible...");
        await page.waitForSelector('.item', { state: 'visible', timeout: 60000 });
        console.log("Feed items visible.");
    });

    test('should decrement shuffle count and persist after refresh', async ({ page }) => {
        const shuffleButton = page.locator('#shuffle-button');
        const shuffleCountSpan = shuffleButton.locator('.shuffle-count');
        
        // 1. Get initial count
        const initialCountText = await shuffleCountSpan.textContent();
        const initialCount = parseInt(initialCountText || '0');
        console.log(`Initial shuffle count: ${initialCount}`);

        if (initialCount === 0) {
            console.log("Shuffle count already 0, skipping decrement test part.");
        } else {
            // 2. Click shuffle
            const firstItemGuid = await page.locator('.item').first().getAttribute('data-guid');
            await shuffleButton.click();
            
            // Wait for toast or deck update
            await page.waitForTimeout(1000); 
            
            const newCountText = await shuffleCountSpan.textContent();
            const newCount = parseInt(newCountText || '0');
            expect(newCount).toBe(initialCount - 1);
            
            const secondItemGuid = await page.locator('.item').first().getAttribute('data-guid');
            expect(secondItemGuid).not.toBe(firstItemGuid);

            // 3. Refresh and check count
            await page.reload();
            await expect(page.locator('#header')).toBeVisible();
            await page.waitForSelector('.item', { state: 'visible' });
            
            const countAfterRefresh = parseInt(await shuffleCountSpan.textContent() || '0');
            expect(countAfterRefresh).toBe(newCount);
            
            const guidAfterRefresh = await page.locator('.item').first().getAttribute('data-guid');
            expect(guidAfterRefresh).toBe(secondItemGuid);
        }
    });

    test('should respect shuffle limit and not reset on refresh', async ({ page }) => {
        const shuffleButton = page.locator('#shuffle-button');
        const shuffleCountSpan = shuffleButton.locator('.shuffle-count');

        // Exhaust shuffles
        let count = parseInt(await shuffleCountSpan.textContent() || '0');
        while (count > 0) {
            await shuffleButton.click();
            await page.waitForTimeout(500); // Small delay between clicks
            count = parseInt(await shuffleCountSpan.textContent() || '0');
        }
        
        expect(count).toBe(0);

        // Try to shuffle again (should not work)
        await shuffleButton.click();
        await page.waitForTimeout(500);
        expect(parseInt(await shuffleCountSpan.textContent() || '0')).toBe(0);

        // Refresh
        await page.reload();
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await expect(page.locator('#header')).toBeVisible();
        
        // Count should still be 0
        const finalCount = parseInt(await shuffleCountSpan.textContent() || '0');
        expect(finalCount).toBe(0);
    });
});
