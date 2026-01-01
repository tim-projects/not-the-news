import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('RSS Content Verification', () => {

    test.beforeEach(async ({ page }) => {
        await login(page, APP_URL);
        
        // Ensure we have a feed with known rich content (The Verge)
        await page.evaluate(async () => {
             const app = window.Alpine.$data(document.getElementById('app'));
             if (app) {
                 // Use The Verge as it has reliable descriptions with images/links
                 app.rssFeedsInput = 'https://www.theverge.com/rss/index.xml';
                 await app.saveRssFeeds();
             }
        });
        await page.waitForTimeout(5000);
    });

    test('should display description content for feed items', async ({ page }) => {
        // Wait for loading screen to hide
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });

        // Wait for items to appear (specifically ones that are not help-panel-item)
        await page.waitForSelector('.entry:not(.help-panel-item)', { state: 'visible', timeout: 60000 });

        // Get the first item's description container
        const firstDescription = page.locator('.itemdescription span').first();
        
        // Wait for it to be visible
        await expect(firstDescription).toBeVisible({ timeout: 10000 });

        // Get the inner HTML/text to verify content exists
        const content = await firstDescription.innerText();
        
        // Assert content is not empty
        expect(content.trim().length).toBeGreaterThan(0);
    });
});
