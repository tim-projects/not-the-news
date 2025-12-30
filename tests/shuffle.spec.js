import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';
const APP_PASSWORD = "devtestpwd";

test.describe('Shuffle Persistence', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`BROWSER CONSOLE: ${msg.text()}`));

        await login(page, APP_URL);
        await ensureFeedsSeeded(page);

        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await expect(page.locator('#header')).toBeVisible();
        
        // Wait for feed items to be visible
        await page.waitForSelector('.item', { state: 'visible', timeout: 60000 });
    });

    test.afterEach(async ({ page }) => {
        // Reset shuffle count via Alpine if still on the page
        try {
            await page.evaluate(async () => {
                const app = window.Alpine.$data(document.getElementById('app'));
                app.shuffleCount = 2;
                await app.saveSimpleSetting('shuffleCount', 2);
            });
        } catch (e) {
            // Ignore if page was closed/navigated
        }
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
            console.log(`First item before shuffle: ${firstItemGuid}`);
            await shuffleButton.click();
            
            // Wait for the first item to actually change in the DOM
            await expect(page.locator('.item').first()).not.toHaveAttribute('data-guid', firstItemGuid || '', { timeout: 10000 });
            
            const newCountText = await shuffleCountSpan.textContent();
            const newCount = parseInt(newCountText || '0');
            expect(newCount).toBe(initialCount - 1);
            
            const secondItemGuid = await page.locator('.item').first().getAttribute('data-guid');
            console.log(`First item after shuffle: ${secondItemGuid}`);
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
