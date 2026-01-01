import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Feature Verification Tests', () => {

    let consoleLogs = [];
    let dialogMessages = [];
    let downloads = [];

    test.beforeEach(async ({ page }) => {
        consoleLogs = [];
        dialogMessages = [];
        downloads = [];

        page.on('console', message => {
            consoleLogs.push({ type: message.type(), text: message.text() });
        });

        page.on('dialog', async dialog => {
            dialogMessages.push({ type: dialog.type(), message: dialog.message() });
            await dialog.accept();
        });
        
        page.on('download', async download => {
            downloads.push(download);
        });

        await login(page, APP_URL);
        await ensureFeedsSeeded(page);

        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await expect(page.locator('#header')).toBeVisible({ timeout: 60000 });
        await page.waitForSelector('.item', { state: 'visible', timeout: 60000 });
    });

    test('should show confirmation dialog and log output for Reset button', async ({ page }) => {
        await page.locator('#settings-button').click();
        await expect(page.locator('.modal')).toBeVisible();

        // Go to Advanced
        await page.locator('#configure-advanced-settings-btn').click();
        await expect(page.locator('#advanced-settings-block')).toBeVisible();

        const resetButton = page.locator('#reset-app-button');
        await expect(resetButton).toBeVisible();

        // Prepare for reload - wait for URL to be the same again after reload
        const reloadPromise = page.waitForURL(APP_URL, { timeout: 60000 });
        await resetButton.click();

        expect(dialogMessages.some(d => d.type === 'confirm')).toBe(true);
        expect(dialogMessages.find(d => d.type === 'confirm').message).toContain('Are you sure you want to reset the application?');

        expect(consoleLogs.some(log => log.text.includes('resetApplicationData called.'))).toBe(true);
        
        await reloadPromise;
        await expect(page.locator('#loading-screen')).toBeVisible({ timeout: 10000 });
    });

    test('should initiate download and log output for Backup button', async ({ page }) => {
        await page.locator('#settings-button').click();
        await expect(page.locator('.modal')).toBeVisible();

        // Go to Advanced
        await page.locator('#configure-advanced-settings-btn').click();
        await expect(page.locator('#advanced-settings-block')).toBeVisible();

        const backupButton = page.locator('#backup-config-button');
        await expect(backupButton).toBeVisible();

        // Start waiting for download before clicking
        const downloadPromise = page.waitForEvent('download');
        await backupButton.click();
        const download = await downloadPromise;

        expect(consoleLogs.some(log => log.text.includes('backupConfig called.'))).toBe(true);
        // Updated regex to handle ISO-like format with 'T' and time
        expect(download.suggestedFilename()).toMatch(/not-the-news-config-backup-\d{4}-\d{2}-\d{2}T.*\.json/);
    });

    test('should verify read item highlight styling', async ({ page }) => {
        // Switch to 'all' filter mode and ensure dark mode
        await page.locator('#settings-button').click();
        await page.locator('#filter-selector').selectOption('all');
        
        // Ensure Original Dark theme for consistent testing of gold color
        await page.locator('#configure-appearance-btn').click();
        const themeSelector = page.locator('#theme-style-selector');
        await themeSelector.selectOption('originalDark');
        await themeSelector.dispatchEvent('change');
        await page.waitForTimeout(2000); // Wait for theme to apply
        
        await page.locator('.modal-content .close').click();

        await page.waitForSelector('.item');
        const firstItemGuid = await page.locator('.item').first().getAttribute('data-guid');
        const readButton = page.locator(`.item[data-guid="${firstItemGuid}"] .read-button`);

        await readButton.click();
        // Move mouse away to avoid hover styles
        await page.mouse.move(0, 0);
        
        // Wait for class and color to apply
        await expect(readButton).toHaveClass(/read/);
        await expect(readButton).toHaveCSS('color', 'rgb(255, 215, 0)', { timeout: 15000 });

        const computedStyles = await readButton.evaluate(el => {
            const style = window.getComputedStyle(el);
            const htmlClass = document.documentElement.className;
            return {
                color: style.color,
                htmlClass: htmlClass,
                goldVar: style.getPropertyValue('--gold-color').trim()
            };
        });

        console.log('Read Button Style Info:', computedStyles);
    });
});
