import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';
const APP_PASSWORD = "devtestpwd";

test.describe('Theme Style Persistence', () => {
    test.beforeEach(async ({ page, request }) => {
        // Login flow
        await page.goto(`${APP_URL}/login.html`);
        const loginResponse = await request.post(`${APP_URL}/api/login`, {
            data: { password: APP_PASSWORD },
            headers: { 'Content-Type': 'application/json' }
        });
        await expect(loginResponse.status()).toBe(200);

        // Set cookie manually
        const setCookieHeader = loginResponse.headers()['set-cookie'];
        if (setCookieHeader) {
            const authCookieString = setCookieHeader.split(',').find(s => s.trim().startsWith('auth='));
            if (authCookieString) {
                const parts = authCookieString.split(';');
                const nameValue = parts[0].trim().split('=');
                await page.context().addCookies([{
                    name: nameValue[0],
                    value: nameValue[1],
                    domain: new URL(APP_URL).hostname,
                    path: '/',
                    expires: -1
                }]);
            }
        }

        await page.goto(APP_URL);
        await expect(page.locator('#header')).toBeVisible();
    });

    test('should remember separate theme styles for light and dark modes', async ({ page }) => {
        // 1. Ensure we are in Light mode
        const themeToggle = page.locator('#theme-toggle');
        const themeText = page.locator('#theme-text');
        
        // If dark (checked), click slider to make light
        if (await themeToggle.isChecked()) {
            // Settings might not be open yet if we just loaded
            // We need to check if settings is open, or open it
            const settingsModal = page.locator('.modal');
            if (!(await settingsModal.isVisible())) {
                 await page.locator('#settings-button').click();
                 await expect(page.locator('#main-settings')).toBeVisible();
            }
            await page.locator('#theme-toggle + .slider').click();
            await expect(themeText).toHaveText('light');
            // Close settings to start fresh
            await page.locator('.modal-content .close').click();
        }

        // 2. Open Settings and Select 'Morning' for Light mode
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();
        const themeSelector = page.locator('#theme-style-selector');
        
        const morningOption = themeSelector.locator('option[value="morning"]');
        await morningOption.waitFor({ state: 'attached' });
        await themeSelector.selectOption('morning');
        
        // Close settings
        await page.locator('.modal-content .close').click();
        await expect(page.locator('html')).toHaveClass(/theme-morning/);

        // 3. Switch to Dark mode
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();
        await page.locator('#theme-toggle + .slider').click();
        await expect(themeText).toHaveText('dark');

        // 4. Select 'Dracula' for Dark mode
        const draculaOption = themeSelector.locator('option[value="dracula"]');
        await draculaOption.waitFor({ state: 'attached' });
        await themeSelector.selectOption('dracula');

        // Close settings
        await page.locator('.modal-content .close').click();
        await expect(page.locator('html')).toHaveClass(/theme-dracula/);

        // 5. Switch back to Light mode
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();
        await page.locator('#theme-toggle + .slider').click();
        await expect(themeText).toHaveText('light');
        await page.locator('.modal-content .close').click();

        // 6. Verify 'Morning' is restored (NOT 'Dracula' or 'original')
        await expect(page.locator('html')).toHaveClass(/theme-morning/);
        await expect(page.locator('html')).not.toHaveClass(/theme-dracula/);

        // 7. Switch back to Dark mode
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();
        await page.locator('#theme-toggle + .slider').click();
        await expect(themeText).toHaveText('dark');
        await page.locator('.modal-content .close').click();

        // 8. Verify 'Dracula' is restored
        await expect(page.locator('html')).toHaveClass(/theme-dracula/);
        await expect(page.locator('html')).not.toHaveClass(/theme-morning/);
    });
});
