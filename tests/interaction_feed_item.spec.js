import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Interaction Assessment: Feed Items', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`[PAGE] ${msg.type()}: ${msg.text()}`));
        await login(page, APP_URL);
        await ensureFeedsSeeded(page);
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await page.waitForSelector('.entry:not(.help-panel-item)', { state: 'visible', timeout: 60000 });
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
});
