import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Interaction Assessment: Keyboard Shortcuts', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`[PAGE] ${msg.type()}: ${msg.text()}`));
        await login(page, APP_URL);
        await ensureFeedsSeeded(page);
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await page.waitForSelector('.entry:not(.help-panel-item)', { state: 'visible', timeout: 60000 });
        
        // Ensure help panel is NOT open initially
        const viewport = page.locator('#app-viewport');
        if (await viewport.evaluate(el => el.classList.contains('shifted'))) {
            await page.keyboard.press('Escape');
            await expect(viewport).not.toHaveClass(/shifted/);
        }
    });

    test('Navigation: j/k and ArrowDown/ArrowUp', async ({ page }) => {
        const items = page.locator('.entry:not(.help-panel-item)');
        const firstItem = items.first();
        const secondItem = items.nth(1);

        // Start by selecting the first item
        console.log('Clicking first item...');
        await firstItem.click();
        
        const classes = await firstItem.evaluate(el => el.className);
        console.log(`First item classes: ${classes}`);
        
        await expect(firstItem).toHaveClass(/selected-item/, { timeout: 15000 });

        // j to move down
        await page.keyboard.press('j');
        await expect(secondItem).toHaveClass(/selected-item/, { timeout: 15000 });
        await expect(firstItem).not.toHaveClass(/selected-item/);

        // k to move up
        await page.keyboard.press('k');
        await expect(firstItem).toHaveClass(/selected-item/, { timeout: 15000 });

        // ArrowDown
        await page.keyboard.press('ArrowDown');
        await expect(secondItem).toHaveClass(/selected-item/, { timeout: 15000 });

        // ArrowUp
        await page.keyboard.press('ArrowUp');
        await expect(firstItem).toHaveClass(/selected-item/, { timeout: 15000 });
    });

    test('Action: r/m/Space/n (Mark Read)', async ({ page }) => {
        const items = page.locator('.entry:not(.help-panel-item)');
        const firstItem = items.first();
        const guid = await firstItem.getAttribute('data-guid');

        await firstItem.click();
        await expect(firstItem).toHaveClass(/selected-item/, { timeout: 15000 });
        
        // r to toggle read
        await page.keyboard.press('r');
        await expect(page.locator(`.entry[data-guid="${guid}"]`)).toBeHidden({ timeout: 15000 });

        // u to undo
        await page.keyboard.press('u');
        await expect(page.locator(`.entry[data-guid="${guid}"]`)).toBeVisible({ timeout: 15000 });

        // select it again
        await page.locator(`.entry[data-guid="${guid}"]`).click();
        await expect(page.locator(`.entry[data-guid="${guid}"]`)).toHaveClass(/selected-item/, { timeout: 15000 });

        // Space to mark read and move to next
        const secondItem = items.nth(1);
        const secondGuid = await secondItem.getAttribute('data-guid');
        
        await page.keyboard.press('Space');
        await expect(page.locator(`.entry[data-guid="${guid}"]`)).toBeHidden({ timeout: 15000 });
        await expect(page.locator(`.entry[data-guid="${secondGuid}"]`)).toHaveClass(/selected-item/, { timeout: 15000 });
    });

    test('Action: s/L (Toggle Star)', async ({ page }) => {
        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        const starButton = firstItem.locator('.star');

        await firstItem.click();
        await expect(firstItem).toHaveClass(/selected-item/, { timeout: 15000 });
        
        // s to toggle star
        await expect(starButton).not.toHaveClass(/starred/);
        await page.keyboard.press('s');
        await expect(starButton).toHaveClass(/starred/);
        
        // L to toggle star
        await page.keyboard.press('L');
        await expect(starButton).not.toHaveClass(/starred/);
    });

    test('Utility: / and ? and Escape', async ({ page }) => {
        const searchOverlay = page.locator('#search-overlay');
        const viewport = page.locator('#app-viewport');

        // / to open search
        await page.keyboard.press('/');
        await expect(searchOverlay).toBeVisible();

        // Escape to close search
        await page.keyboard.press('Escape');
        await expect(searchOverlay).toBeHidden();

        // ? to open help
        await page.keyboard.type('?');
        await expect(viewport).toHaveClass(/shifted/);

        // Escape to close help
        await page.keyboard.press('Escape');
        await expect(viewport).not.toHaveClass(/shifted/);
    });

    test('Navigation: Sub-element focus (h/l/Arrows)', async ({ page }) => {
        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        await firstItem.click();
        await expect(firstItem).toHaveClass(/selected-item/, { timeout: 15000 });

        // Default focus is on the item itself (selectedSubElement === 'item')
        await expect(firstItem).toHaveClass(/sub-focused/);

        // l to move right (Item -> Read -> Star -> Play)
        await page.keyboard.press('l');
        await expect(firstItem.locator('.read-button')).toHaveClass(/sub-focused/);

        await page.keyboard.press('l');
        await expect(firstItem.locator('.star')).toHaveClass(/sub-focused/);

        await page.keyboard.press('l');
        // If mode is menu, it's the menu trigger
        const menuTrigger = firstItem.locator('button.menu-trigger').filter({ visible: true });
        await expect(menuTrigger).toHaveClass(/sub-focused/);

        // h to move left
        await page.keyboard.press('h');
        await expect(firstItem.locator('.star')).toHaveClass(/sub-focused/);

        await page.keyboard.press('ArrowLeft');
        await expect(firstItem.locator('.read-button')).toHaveClass(/sub-focused/);

        await page.keyboard.press('ArrowLeft');
        // Moving left from the first button should return focus to the item container
        await expect(firstItem).toHaveClass(/sub-focused/);
    });

    test('Action: t (Scroll Top)', async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 1000));
        await page.waitForFunction(() => window.scrollY > 500);

        await page.keyboard.press('t');
        await page.waitForTimeout(1000);
        const scrollY = await page.evaluate(() => window.scrollY);
        expect(scrollY).toBeLessThan(100);
    });
});
