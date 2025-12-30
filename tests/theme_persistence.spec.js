import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';

test.describe('Theme Style Persistence', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, APP_URL);
        await ensureFeedsSeeded(page);
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await page.locator('[data-guid]').first().waitFor({ state: 'visible', timeout: 30000 });
    });

    test('should remember separate theme styles for light and dark modes', async ({ page }) => {
        // Open Settings
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();

        // 1. Select 'Morning' for Light mode
        await page.evaluate(async () => {
            const app = window.Alpine.$data(document.querySelector('#app'));
            await app.updateThemeAndStyle('morning', 'light');
        });
        
        // Wait for class application
        await expect(page.locator('html')).toHaveClass(/theme-morning/);
        await expect(page.locator('html')).toHaveClass(/light/);

        // 2. Select 'Dracula' for Dark mode
        await page.evaluate(async () => {
            const app = window.Alpine.$data(document.querySelector('#app'));
            await app.updateThemeAndStyle('dracula', 'dark');
        });

        // Wait for class application
        await expect(page.locator('html')).toHaveClass(/theme-dracula/);
        await expect(page.locator('html')).toHaveClass(/dark/);

        // 3. Switch back to Light mode
        await page.evaluate(async () => {
            const app = window.Alpine.$data(document.querySelector('#app'));
            await app.updateThemeAndStyle(app.themeStyleLight, 'light');
        });
        
        // 4. Verify 'Morning' is restored (NOT 'Dracula' or 'original')
        await expect(page.locator('html')).toHaveClass(/theme-morning/);
        await expect(page.locator('html')).toHaveClass(/light/);

        // 5. Test specific issue: Reverting to Original Dark when set to Original Light
        
        // Set to Original Light
        await page.evaluate(async () => {
            const app = window.Alpine.$data(document.querySelector('#app'));
            await app.updateThemeAndStyle('originalLight', 'light');
        });
        
        await expect(page.locator('html')).toHaveClass(/light/);
        await expect(page.locator('html')).not.toHaveClass(/theme-/);
        
        // Check state before reload
        const currentStyle = await page.evaluate(() => window.Alpine.$data(document.querySelector('#app')).themeStyle);
        expect(currentStyle).toBe('originalLight');
        
        // Reload page to test initialization
        await page.reload();
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await page.waitForSelector('.item.entry', { state: 'visible', timeout: 30000 });
        
        // Style should STILL be originalLight
        const styleAfterReload = await page.evaluate(() => window.Alpine.$data(document.querySelector('#app')).themeStyle);
        const themeAfterReload = await page.evaluate(() => window.Alpine.$data(document.querySelector('#app')).theme);
        
        expect(styleAfterReload).toBe('originalLight');
        expect(themeAfterReload).toBe('light');
    });
});