import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';

test.describe('Theme Functionality', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, APP_URL);
        await ensureFeedsSeeded(page);
        await expect(page.locator('#header')).toBeVisible();
    });

    test('should allow changing theme style', async ({ page }) => {
        // Open settings
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();

        // Go to Appearance
        await page.locator('#configure-appearance-btn').click();
        await expect(page.locator('#appearance-settings-block')).toBeVisible();

        // Ensure theme style selector is visible
        const themeSelector = page.locator('#theme-style-selector');
        await expect(themeSelector).toBeVisible();

        // Select 'Morning' theme (which is a light theme)
        await themeSelector.selectOption('morning');
        await themeSelector.dispatchEvent('change');
        await page.waitForTimeout(500);
        
        // Close settings
        await page.locator('.modal-content .close').click();

        // Verify html class
        await expect(page.locator('html')).toHaveClass(/theme-morning/);
        await expect(page.locator('html')).toHaveClass(/light/);

        // Verify background color variable (Morning theme: --bg: #e6efff)
        const bgColor = await page.evaluate(() => {
            return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
        });
        expect(bgColor).toBe('#e6efff');
    });

    test('should allow changing dark theme style', async ({ page }) => {
        // Open settings
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();

        // Go to Appearance
        await page.locator('#configure-appearance-btn').click();
        await expect(page.locator('#appearance-settings-block')).toBeVisible();

        // Ensure theme style selector is visible
        const themeSelector = page.locator('#theme-style-selector');
        await expect(themeSelector).toBeVisible();

        // Select 'Dracula' theme (which is a dark theme)
        await themeSelector.selectOption('dracula');
        await themeSelector.dispatchEvent('change');
        await page.waitForTimeout(500);

        // Close settings
        await page.locator('.modal-content .close').click();

        // Verify html class
        await expect(page.locator('html')).toHaveClass(/theme-dracula/);
        await expect(page.locator('html')).toHaveClass(/dark/);

        // Verify background color variable (Dracula theme: --bg: #282a36)
        const bgColor = await page.evaluate(() => {
            return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
        });
        expect(bgColor).toBe('#282a36');
    });
});
