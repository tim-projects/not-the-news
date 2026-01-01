import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Font Size Scaling', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, APP_URL);
        await ensureFeedsSeeded(page);
        await expect(page.locator('#header')).toBeVisible();
    });

    test('should scale font size using the slider', async ({ page }) => {
        // Open settings
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();

        // Go to Appearance
        await page.locator('#configure-appearance-btn').click();
        await expect(page.locator('#appearance-settings-block')).toBeVisible();

        const slider = page.locator('#font-size-slider');
        await expect(slider).toBeVisible();

        const getFS = async () => parseFloat(await page.evaluate(() => getComputedStyle(document.body).fontSize));

        // 1. Initial font size at 100%
        await slider.fill('100');
        await slider.dispatchEvent('change');
        const size100 = await getFS();

        // 2. Change font size to 150%
        await slider.fill('150');
        await slider.dispatchEvent('change');
        // Wait for potential network sync
        await page.waitForTimeout(2000);
        const size150 = await getFS();

        // Verify ratio (approximately 1.5)
        expect(size150 / size100).toBeCloseTo(1.5, 1);

        // 3. Reload and verify persistence
        await page.reload(); await expect(page.locator("#loading-screen")).not.toBeVisible({ timeout: 60000 });
        await expect(page.locator('#header')).toBeVisible();

        const fontScale = await page.evaluate(() => {
            return getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim();
        });
        expect(fontScale).toBe('1.5');
        
        const sizeAfterReload = await getFS();
        expect(sizeAfterReload).toBeCloseTo(size150, 1);
    });
});
