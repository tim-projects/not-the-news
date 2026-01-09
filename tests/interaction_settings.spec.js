import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Interaction Assessment: Settings Modal', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`[PAGE] ${msg.type()}: ${msg.text()}`));
        await login(page, APP_URL);
        await ensureFeedsSeeded(page);
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await page.waitForSelector('.entry:not(.help-panel-item)', { state: 'visible', timeout: 60000 });
        
        // Open settings
        await page.locator('#settings-button').click();
        await expect(page.locator('#settings-modal')).toBeVisible();
    });

    test('Modal Navigation: Sub-menus and Back button', async ({ page }) => {
        const mainSettings = page.locator('#main-settings');
        const appearanceSettings = page.locator('#appearance-settings-block');
        const backButton = page.locator('#back-button');

        // Navigate to Appearance
        await page.locator('button:has-text("Appearance")').click();
        await expect(mainSettings).toBeHidden();
        await expect(appearanceSettings).toBeVisible();
        await expect(backButton).toBeVisible();

        // Back to Main
        await backButton.click();
        await expect(appearanceSettings).toBeHidden();
        await expect(mainSettings).toBeVisible();
        await expect(backButton).toBeHidden();

        // Navigate to Behavior
        await page.locator('button:has-text("Behavior")').click();
        await expect(page.locator('#behavior-settings-block')).toBeVisible();
        await backButton.click();
        await expect(mainSettings).toBeVisible();
    });

    test('Filter View Selector: Changes feed mode', async ({ page }) => {
        const selector = page.locator('#filter-selector');
        
        // Initial state should be unread
        await expect(selector).toHaveValue('unread');

        // Change to Starred
        await selector.selectOption('starred');
        // Check Alpine state
        await page.waitForFunction(() => window.Alpine.$data(document.getElementById('app')).filterMode === 'starred');
        
        // Close modal
        await page.locator('#settings-modal .close').click();
        
        // Re-open and check persistence in UI
        await page.locator('#settings-button').click();
        await expect(page.locator('#filter-selector')).toHaveValue('starred');
    });

    test('Appearance: Theme and Style selectors', async ({ page }) => {
        await page.locator('button:has-text("Appearance")').click();
        
        const themeSelector = page.locator('#theme-style-selector');
        
        // Change theme style
        await themeSelector.selectOption('dracula');
        await expect(page.locator('html')).toHaveClass(/theme-dracula/);

        // Toggle Light/Dark mode via Alpine (simulating the switch)
        await page.evaluate(() => {
            const app = window.Alpine.$data(document.getElementById('app'));
            app.theme = 'light';
        });
        await expect(page.locator('html')).toHaveClass(/light/);
        
        // themeStyle should have changed to light default if not set, 
        // but let's just verify classes
        const hasLightClass = await page.evaluate(() => document.documentElement.classList.contains('light'));
        expect(hasLightClass).toBe(true);
    });

    test('RSS Feeds: Manual Edit and Save', async ({ page }) => {
        await page.locator('button:has-text("RSS Feeds")').click();
        const textarea = page.locator('textarea').first(); // The manual feeds textarea
        const saveButton = page.locator('button:has-text("Save Feeds")');

        const originalFeeds = await textarea.inputValue();
        const testFeed = 'https://news.google.com/rss';
        
        await textarea.fill(testFeed);
        await saveButton.click();

        // Should show success message or status bar update
        // We check Alpine state for confirmation
        await page.waitForFunction((expected) => {
            const app = window.Alpine.$data(document.getElementById('app'));
            return app.rssFeedsInput === expected;
        }, testFeed);

        // Verify it persisted (re-open)
        await page.locator('#back-button').click();
        await page.locator('button:has-text("RSS Feeds")').click();
        await expect(page.locator('textarea').first()).toHaveValue(testFeed);
        
        // Restore original for other tests stability
        await page.locator('textarea').first().fill(originalFeeds);
        await page.locator('button:has-text("Save Feeds")').click();
    });

    test('Advanced: Reset Application prompt', async ({ page }) => {
        await page.locator('button:has-text("Advanced")').click();
        const resetButton = page.locator('button:has-text("Reset Application")');

        // We mock confirm to say 'No'
        page.on('dialog', dialog => dialog.dismiss());
        await resetButton.click();
        
        // Modal should still be open
        await expect(page.locator('#settings-modal')).toBeVisible();
    });
});
