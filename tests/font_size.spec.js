import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';
const APP_PASSWORD = "devtestpwd";

test.describe('Font Size Scaling', () => {
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

    test('should scale font size using the slider', async ({ page }) => {
        // Open settings
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();

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
        const size150 = await getFS();

        // Verify ratio
        expect(size150 / size100).toBeCloseTo(1.5, 1);

        // 3. Reload and verify persistence
        await page.reload();
        await expect(page.locator('#header')).toBeVisible();

        const fontScale = await page.evaluate(() => {
            return getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim();
        });
        expect(fontScale).toBe('1.5');
        
        const sizeAfterReload = await getFS();
        expect(sizeAfterReload).toBeCloseTo(size150, 1);
    });
});