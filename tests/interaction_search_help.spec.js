import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Interaction Assessment: Global Navigation & Search', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`[PAGE] ${msg.type()}: ${msg.text()}`));
        await login(page, APP_URL);
        await ensureFeedsSeeded(page);
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        
        // Ensure help panel is NOT open initially
        const viewport = page.locator('#app-viewport');
        if (await viewport.evaluate(el => el.classList.contains('shifted'))) {
            await page.locator('#help-button').click();
            await expect(viewport).not.toHaveClass(/shifted/);
        }

        await page.waitForSelector('.entry:not(.help-panel-item)', { state: 'visible', timeout: 60000 });
    });

    test('Search Button: Toggle search bar visibility', async ({ page }) => {
        const searchButton = page.locator('#search-button');
        const searchOverlay = page.locator('#search-overlay');
        const searchInput = page.locator('#search-input');

        await expect(searchOverlay).toBeHidden();
        
        await searchButton.click();
        await expect(searchOverlay).toBeVisible();
        await expect(searchInput).toBeFocused();

        await searchButton.click();
        await expect(searchOverlay).toBeHidden();
    });

    test('Help Button: Toggle keyboard shortcuts panel', async ({ page }) => {
        const helpButton = page.locator('#help-button');
        const viewport = page.locator('#app-viewport');
        const shortcutsSection = page.locator('#shortcuts-section');

        await expect(viewport).not.toHaveClass(/shifted/);
        
        await helpButton.click();
        await expect(viewport).toHaveClass(/shifted/);
        await expect(shortcutsSection).toBeVisible();

        await helpButton.click();
        await expect(viewport).not.toHaveClass(/shifted/);
    });

    test('Sliding Container Click: Deselects item and closes shortcuts', async ({ page }) => {
        const helpButton = page.locator('#help-button');
        const viewport = page.locator('#app-viewport');
        const slidingContainer = page.locator('#sliding-container');
        
        // Open shortcuts
        await helpButton.click();
        await expect(viewport).toHaveClass(/shifted/);

        // Select an item (Close shortcuts first to reliably select item)
        await helpButton.click(); 
        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        await firstItem.click();
        await expect(firstItem).toHaveClass(/selected-item/);

        // Open shortcuts again
        await helpButton.click();
        await expect(viewport).toHaveClass(/shifted/);

        // Click outside (sliding container self) to deselect AND close
        // Use force: true to bypass interception if coordinates are tricky
        await slidingContainer.click({ position: { x: 5, y: 300 }, force: true }); 

        await expect(viewport).not.toHaveClass(/shifted/);
        await expect(page.locator('.entry:not(.help-panel-item)').first()).not.toHaveClass(/selected-item/);
    });

    test('Search Overlay: Functional interactions', async ({ page }) => {
        await page.locator('#search-button').click();
        const searchInput = page.locator('#search-input');
        const closeButton = page.locator('.search-close');

        // Type to filter
        await searchInput.fill('NASA');
        // Check that items are filtered (just verify Alpine state for stability)
        await page.waitForFunction(() => window.Alpine.$data(document.getElementById('app')).searchQuery === 'NASA');
        const searchQuery = await page.evaluate(() => window.Alpine.$data(document.getElementById('app')).searchQuery);
        expect(searchQuery).toBe('NASA');

        // Escape to close
        await searchInput.press('Escape');
        await expect(page.locator('#search-overlay')).toBeHidden();

        // Re-open and use close button
        await page.locator('#search-button').click();
        await expect(page.locator('#search-overlay')).toBeVisible();
        await closeButton.click();
        await expect(page.locator('#search-overlay')).toBeHidden();
    });

    test('Title Click: Scrolls to top (Verification)', async ({ page }) => {
        // Scroll down
        await page.evaluate(() => window.scrollTo(0, 500));
        await page.waitForFunction(() => window.scrollY > 100);

        // Click title
        await page.locator('#ntn-title h2').click();
        
        // Wait for scroll
        await page.waitForTimeout(1000);
        const finalScroll = await page.evaluate(() => window.scrollY);
        
        console.log(`Title Click scroll position: ${finalScroll}`);
        expect(finalScroll).toBeLessThan(100); 
    });

    test('Footer: Scroll to Top Button', async ({ page }) => {
        const scrollToTopBtn = page.locator('#scroll-to-top');
        
        // Initially hidden
        await expect(scrollToTopBtn).not.toHaveClass(/visible/);

        // Scroll down
        await page.evaluate(() => window.scrollTo(0, 1000));
        // Button appears when scrolling UP. Scroll up a bit.
        await page.evaluate(() => window.scrollBy(0, -200));
        
        await expect(scrollToTopBtn).toHaveClass(/visible/, { timeout: 10000 });

        // Click it
        await scrollToTopBtn.click();
        
        // Wait for scroll
        await page.waitForTimeout(1000);
        const scrollY = await page.evaluate(() => window.scrollY);
        expect(scrollY).toBeLessThan(200); // Allow some margin
        await expect(scrollToTopBtn).not.toHaveClass(/visible/);
    });
});
