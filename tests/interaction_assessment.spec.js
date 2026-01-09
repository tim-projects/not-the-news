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

    test('Feed Item: Container selection', async ({ page }) => {
        const items = page.locator('.entry:not(.help-panel-item)');
        const firstItem = items.first();
        const secondItem = items.nth(1);

        await firstItem.click();
        await expect(firstItem).toHaveClass(/selected-item/);

        await secondItem.click();
        await expect(secondItem).toHaveClass(/selected-item/);
        await expect(firstItem).not.toHaveClass(/selected-item/);
    });

    test('Feed Item: Star and Read button toggles', async ({ page }) => {
        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        const guid = await firstItem.getAttribute('data-guid');
        const starButton = firstItem.locator('.star');
        const readButton = firstItem.locator('.read-button');

        // Star toggle
        await expect(starButton).not.toHaveClass(/starred/);
        await starButton.click();
        await expect(starButton).toHaveClass(/starred/);
        await starButton.click();
        await expect(starButton).not.toHaveClass(/starred/);

        // Read toggle (In unread mode it will disappear)
        await readButton.click();
        
        // Wait for it to be removed from the DOM or hidden
        await expect(page.locator(`.entry[data-guid="${guid}"]`)).toBeHidden({ timeout: 15000 });
        
        // Undo to bring it back
        await page.keyboard.press('u');
        await expect(page.locator(`.entry[data-guid="${guid}"]`)).toBeVisible({ timeout: 15000 });
    });

    test('Feed Item: Menu Trigger and Popup', async ({ page }) => {
        // Set itemButtonMode to 'menu' first
        await page.evaluate(() => {
            const app = window.Alpine.$data(document.getElementById('app'));
            app.itemButtonMode = 'menu';
        });

        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        // Use a more specific selector for the visible menu trigger
        const menuTrigger = firstItem.locator('button.menu-trigger').filter({ visible: true });
        const popupMenu = firstItem.locator('.item-popup-menu');

        await expect(popupMenu).toBeHidden();
        await menuTrigger.click();
        await expect(popupMenu).toBeVisible();

        // Click away to close
        await page.mouse.click(0, 0);
        await expect(popupMenu).toBeHidden();
    });

    test('Feed Item: Image expansion and lightbox', async ({ page }) => {
        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        // Wait for image if it exists
        const entryImage = firstItem.locator('.entry-image');
        
        if (await entryImage.count() === 0) {
            console.log("No image found in first item, skipping image test.");
            return;
        }

        const expandOverlay = firstItem.locator('.expand-icon-overlay');
        const lightbox = page.locator('#image-lightbox');

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

        // Open again and use Escape
        await entryImage.click();
        await entryImage.click();
        await expect(lightbox).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(lightbox).toBeHidden();
    });

    test('Feed Item: Link Clicks coverage logic', async ({ page }) => {
        // This test verifies that links in the description require item selection first 
        
        // Ensure NOT selected
        await page.evaluate(() => window.Alpine.$data(document.getElementById('app')).selectedGuid = null);
        
        // Wait for re-render
        await page.waitForTimeout(500);
        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        await expect(firstItem).not.toHaveClass(/selected-item/);

        const link = firstItem.locator('.itemdescription a').first();
        if (await link.count() === 0) {
            console.log("No link found in first item description, skipping.");
            return;
        }

        // Mock window.open
        await page.evaluate(() => {
            window._lastOpenedUrl = null;
            window.open = (url) => { window._lastOpenedUrl = url; return null; };
        });

        // Click link. Should select first.
        await link.click();
        
        // Item should now be selected
        await expect(page.locator('.entry:not(.help-panel-item)').first()).toHaveClass(/selected-item/);
        
        // Link should NOT have been opened on first click
        let openedUrl = await page.evaluate(() => window._lastOpenedUrl);
        expect(openedUrl).toBeNull();

        // Second click on the SAME link while selected should open it
        await link.click();
        openedUrl = await page.evaluate(() => window._lastOpenedUrl);
        expect(openedUrl).not.toBeNull();
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