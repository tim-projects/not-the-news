import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';
const APP_PASSWORD = "devtestpwd";

test.describe('Theme Functionality', () => {
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

    test('should allow changing theme style', async ({ page }) => {
        // Open settings
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();

        // Ensure theme style selector is visible
        const themeSelector = page.locator('#theme-style-selector');
        await expect(themeSelector).toBeVisible();

        // Switch to Light mode first to test light themes
        const themeToggle = page.locator('#theme-toggle');
        const themeText = page.locator('#theme-text');
        
        // If dark (checked), click slider to make light
        if (await themeToggle.isChecked()) {
            await page.locator('#theme-toggle + .slider').click();
            await expect(themeText).toHaveText('light');
        }

        // Wait for the option to be available in the DOM
        const morningOption = themeSelector.locator('option[value="morning"]');
        await morningOption.waitFor({ state: 'attached' });

        // Select 'Morning' theme
        await themeSelector.selectOption('morning');
        
        // Debug: Check select value
        const selectValue = await themeSelector.inputValue();
        console.log(`Select value after selection: ${selectValue}`);

        // Force change event if needed
        // await themeSelector.dispatchEvent('change');

        // Close settings
        await page.locator('.modal-content .close').click();

        // Verify html class
        const classList = await page.locator('html').getAttribute('class');
        console.log(`Current HTML classes: ${classList}`);
        await expect(page.locator('html')).toHaveClass(/theme-morning/);
        await expect(page.locator('html')).toHaveClass(/light/);

        // Verify background color variable (Morning theme: --bg: #e6efff)
        const html = page.locator('html');
        const bgColor = await html.evaluate((el) => {
            return getComputedStyle(el).getPropertyValue('--bg').trim();
        });
        expect(bgColor).toBe('#e6efff');
    });

    test('should allow changing dark theme style', async ({ page }) => {
        // Open settings
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();

        // Ensure theme style selector is visible
        const themeSelector = page.locator('#theme-style-selector');
        await expect(themeSelector).toBeVisible();

        // Switch to Dark mode
        const themeToggle = page.locator('#theme-toggle');
        const themeText = page.locator('#theme-text');
        
        // If light (unchecked), click slider to make dark
        if (!(await themeToggle.isChecked())) {
            await page.locator('#theme-toggle + .slider').click();
            await expect(themeText).toHaveText('dark');
        }

        // Select 'Dracula' theme
        await themeSelector.selectOption('dracula');

        // Close settings
        await page.locator('.modal-content .close').click();

        // Verify html class
        await expect(page.locator('html')).toHaveClass(/theme-dracula/);
        await expect(page.locator('html')).toHaveClass(/dark/);

        // Verify background color variable (Dracula theme: --bg: #282a36)
        const html = page.locator('html');
        const bgColor = await html.evaluate((el) => {
            return getComputedStyle(el).getPropertyValue('--bg').trim();
        });
        expect(bgColor).toBe('#282a36');
    });
});