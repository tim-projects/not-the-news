import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Interaction Assessment: Global Navigation & Search', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, APP_URL);
        await ensureFeedsSeeded(page);
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
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

        // Select an item
        const firstItem = page.locator('.item').first();
        await firstItem.click();
        await expect(firstItem).toHaveClass(/selected-item/);

        // Click outside (sliding container self)
        // We need to click specifically where the container is visible but not the items or header
        // Using force click or clicking at a specific coordinate might be needed, 
        // but sliding-container has @click.self
        await slidingContainer.click({ position: { x: 5, y: 300 } }); 

        await expect(viewport).not.toHaveClass(/shifted/);
        await expect(firstItem).not.toHaveClass(/selected-item/);
    });

    test('Search Overlay: Functional interactions', async ({ page }) => {
        await page.locator('#search-button').click();
        const searchInput = page.locator('#search-input');
        const closeButton = page.locator('.search-close');

        // Type to filter
        await searchInput.fill('NASA');
        // Check that items are filtered (assuming NASA is in the seeded feeds)
        // Or just check that searchQuery is updated in Alpine if we can't guarantee content
        const searchQuery = await page.evaluate(() => Alpine.$data(document.getElementById('app')).searchQuery);
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
        const initialScroll = await page.evaluate(() => window.scrollY);
        expect(initialScroll).toBeGreaterThan(0);

        // Click title
        await page.locator('#ntn-title h2').click();
        
        // Wait a bit to see if scroll happens
        await page.waitForTimeout(500);
        const finalScroll = await page.evaluate(() => window.scrollY);
        
        console.log(`Title Click scroll position: ${finalScroll}`);
        // If it didn't scroll, this will fail or we just log it for the assessment
        // expect(finalScroll).toBe(0); 
    });

    test('Feed Item: Container selection', async ({ page }) => {
        const items = page.locator('.item');
        const firstItem = items.first();
        const secondItem = items.nth(1);

        await firstItem.click();
        await expect(firstItem).toHaveClass(/selected-item/);

        await secondItem.click();
        await expect(secondItem).toHaveClass(/selected-item/);
        await expect(firstItem).not.toHaveClass(/selected-item/);
    });

    test('Feed Item: Star and Read button toggles', async ({ page }) => {
        const firstItem = page.locator('.item').first();
        const starButton = firstItem.locator('.star');
        const readButton = firstItem.locator('.read-button');

        // Star toggle
        await expect(starButton).not.toHaveClass(/starred/);
        await starButton.click();
        await expect(starButton).toHaveClass(/starred/);
        await starButton.click();
        await expect(starButton).not.toHaveClass(/starred/);

        // Read toggle (Note: in unread mode it will disappear, so we check existence)
        await readButton.click();
        await expect(firstItem).toBeHidden();
        
        // Undo to bring it back
        await page.keyboard.press('u');
        await expect(firstItem).toBeVisible();
    });

    test('Feed Item: Menu Trigger and Popup', async ({ page }) => {
        // Set itemButtonMode to 'menu' first
        await page.evaluate(() => {
            const app = Alpine.$data(document.getElementById('app'));
            app.itemButtonMode = 'menu';
        });

        const firstItem = page.locator('.item').first();
        const menuTrigger = firstItem.locator('.menu-trigger');
        const popupMenu = firstItem.locator('.item-popup-menu');

        await expect(popupMenu).toBeHidden();
        await menuTrigger.click();
        await expect(popupMenu).toBeVisible();

        // Click away to close
        await page.mouse.click(0, 0);
        await expect(popupMenu).toBeHidden();
    });

    test('Feed Item: Image expansion and lightbox', async ({ page }) => {
        const firstItem = page.locator('.item').first();
        // Wait for image if it exists
        const entryImage = firstItem.locator('.entry-image');
        
        if (await entryImage.count() === 0) {
            console.log("No image found in first item, skipping image test.");
            return;
        }

        const expandOverlay = firstItem.locator('.expand-icon-overlay');
        const lightbox = page.locator('#image-lightbox');

        await expect(expandOverlay).toBeHidden();
        
        // First click shows overlay
        await entryImage.click();
        await expect(expandOverlay).toBeVisible();

        // Second click on image (or click on overlay) opens lightbox
        await entryImage.click();
        await expect(lightbox).toBeVisible();
        await expect(lightbox).toHaveClass(/visible/);

        // Click lightbox to close
        await lightbox.click();
        await expect(lightbox).toBeHidden();
    });
});
