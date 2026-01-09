import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Scrolling Regression', () => {
    test.beforeEach(async ({ page }) => {
        // Ensure we are in Demo Mode
        await page.goto(APP_URL);
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 30000 });
    });

    test('should scroll next item into view when pressing j', async ({ page }) => {
        // Get all entries
        const entries = page.locator('.entry:not(.help-panel-item)');
        await expect(entries).toHaveCount(10);

        // First item should be selected by default (or we select it)
        await page.keyboard.press('j');
        const firstGuid = await entries.first().getAttribute('data-guid');
        await expect(entries.first()).toHaveClass(/selected-item/);

        // Move through items and check if they are in viewport
        for (let i = 1; i < 5; i++) {
            await page.keyboard.press('j');
            const currentItem = entries.nth(i);
            await expect(currentItem).toHaveClass(/selected-item/);
            
            // Wait for smooth scroll to finish
            await page.waitForTimeout(500);

            // Check if element is in viewport
            const isInViewport = await currentItem.evaluate((el) => {
                const rect = el.getBoundingClientRect();
                return (
                    rect.top >= 0 &&
                    rect.left >= 0 &&
                    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
                );
            });
            
            // Note: Sticky header might obscure the top, so we might need a more relaxed check
            // but let's start with this.
            
            const box = await currentItem.boundingBox();
            const viewportHeight = page.viewportSize().height;
            
            console.log(`Item ${i} top: ${box.y}, viewport height: ${viewportHeight}`);
            
            // Item should at least have its top part visible (below the header)
            // Header is roughly 60-80px
            expect(box.y).toBeGreaterThan(-10); // Allow slight overshoot
            expect(box.y).toBeLessThan(viewportHeight - 50);
        }
    });

    test('should scroll to top when navigating to first item', async ({ page }) => {
        const entries = page.locator('.entry:not(.help-panel-item)');
        
        // Go to 3rd item
        await page.keyboard.press('j');
        await page.keyboard.press('j');
        await page.keyboard.press('j');
        
        await page.waitForTimeout(500);
        
        // Go back to first item
        await page.keyboard.press('k');
        await page.keyboard.press('k');
        await page.keyboard.press('k');
        
        await page.waitForTimeout(500);
        
        const scrollData = await page.evaluate(() => {
            const viewport = document.getElementById('app-viewport');
            return {
                windowScrollY: window.scrollY,
                viewportScrollTop: viewport ? viewport.scrollTop : null
            };
        });
        console.log(`Scroll Data after returning to top:`, scrollData);
        expect(scrollData.windowScrollY < 100 || (scrollData.viewportScrollTop !== null && scrollData.viewportScrollTop < 100)).toBe(true);
    });
});
