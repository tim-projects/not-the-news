import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';
const APP_PASSWORD = "devtestpwd";

test.describe('Theme Style Persistence', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to the login page
        await page.goto(`${APP_URL}/login.html`);

        // Fill the password and click login
        await page.fill('#pw', APP_PASSWORD);
        await page.click('button[type="submit"]');

        // Wait for navigation to the main page
        await page.waitForURL(APP_URL);
        // Wait for loading screen to be hidden
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 30000 });
        // Wait for the app viewport to be visible
        await page.waitForSelector('#app-viewport', { state: 'visible', timeout: 30000 });
        // Wait for any data-guid element to be visible
        await page.locator('[data-guid]').first().waitFor({ state: 'visible', timeout: 30000 });
    });

    test('should remember separate theme styles for light and dark modes', async ({ page }) => {
        // Open Settings
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();

        const themeSelector = page.locator('#theme-style-selector');
        await expect(themeSelector).toBeVisible();

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
        expect(await themeSelector.inputValue()).toBe('morning');

        // 5. Test specific issue: Reverting to Original Dark when set to Original Light
        
        // Set to Original Light
        await page.evaluate(async () => {
            const app = window.Alpine.$data(document.querySelector('#app'));
            await app.updateThemeAndStyle('original', 'light');
        });
        
        await expect(page.locator('html')).toHaveClass(/light/);
        await expect(page.locator('html')).not.toHaveClass(/theme-/);
        
        // Check state before reload
        const currentStyle = await page.evaluate(() => window.Alpine.$data(document.querySelector('#app')).themeStyle);
        expect(currentStyle).toBe('original');
        
        // Reload page to test initialization
        await page.reload();
        await page.waitForSelector('#loading-screen', { state: 'hidden', timeout: 30000 });
        await page.waitForSelector('.item.entry', { state: 'visible', timeout: 30000 });
        
        // Style should STILL be original
        const styleAfterReload = await page.evaluate(() => window.Alpine.$data(document.querySelector('#app')).themeStyle);
        const themeAfterReload = await page.evaluate(() => window.Alpine.$data(document.querySelector('#app')).theme);
        
        expect(styleAfterReload).toBe('original');
        expect(themeAfterReload).toBe('light');
    });
});
