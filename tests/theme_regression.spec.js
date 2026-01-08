import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Theme Regression: Original Themes', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, APP_URL);
        await ensureFeedsSeeded(page);
        await expect(page.locator('#header')).toBeVisible();
    });

    test('switching from sepia back to original light should restore original colors', async ({ page }) => {
        // 1. Open settings -> Appearance
        await page.locator('#settings-button').click();
        await page.locator('#configure-appearance-btn').click();

        // 2. Switch to Sepia via Alpine directly
        console.log("Switching to Sepia...");
        await page.evaluate(() => {
            const app = Alpine.$data(document.getElementById('app'));
            app.theme = 'light';
            app.themeStyle = 'sepia';
            app.applyThemeStyle();
        });
        await page.waitForTimeout(1000);
        
        let htmlClass = await page.locator('html').getAttribute('class') || "";
        console.log(`HTML classes after Sepia: ${htmlClass}`);
        expect(htmlClass).toContain('light');
        expect(htmlClass).toContain('theme-sepia');

        // Verify Sepia background
        let bgColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
        console.log(`BG Color after Sepia: ${bgColor}`);
        expect(bgColor.toLowerCase()).toBe('#f4ecd8');

        // 3. Switch to Original Light
        console.log("Switching back to Original Light...");
        await page.evaluate(() => {
            const app = Alpine.$data(document.getElementById('app'));
            app.theme = 'light';
            app.themeStyle = 'originalLight';
            app.applyThemeStyle();
        });
        await page.waitForTimeout(1000);

        htmlClass = await page.locator('html').getAttribute('class') || "";
        console.log(`HTML classes after Original Light: ${htmlClass}`);
        expect(htmlClass).toContain('light');
        expect(htmlClass).toContain('theme-originalLight');
        expect(htmlClass).not.toContain('theme-sepia');

        // Verify Original Light background (--light-bg: #f5f5f5)
        bgColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
        console.log(`BG Color after Original Light: ${bgColor}`);
        if (bgColor.startsWith('rgb')) {
            expect(bgColor).toBe('rgb(245, 245, 245)');
        } else {
            expect(bgColor.toLowerCase()).toBe('#f5f5f5');
        }
    });

    test('switching from dracula back to original dark should restore original colors', async ({ page }) => {
        // 1. Open settings -> Appearance
        await page.locator('#settings-button').click();
        await page.locator('#configure-appearance-btn').click();

        // 2. Switch to Dracula via Alpine
        console.log("Switching to Dracula...");
        await page.evaluate(() => {
            const app = Alpine.$data(document.getElementById('app'));
            app.theme = 'dark';
            app.themeStyle = 'dracula';
            app.applyThemeStyle();
        });
        await page.waitForTimeout(1000);
        
        let htmlClass = await page.locator('html').getAttribute('class') || "";
        console.log(`HTML classes after Dracula: ${htmlClass}`);
        expect(htmlClass).toContain('dark');
        expect(htmlClass).toContain('theme-dracula');

        // Verify Dracula background (--bg: #282a36)
        let bgColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
        console.log(`BG Color after Dracula: ${bgColor}`);
        expect(bgColor.toLowerCase()).toBe('#282a36');

        // 3. Switch to Original Dark
        console.log("Switching back to Original Dark...");
        await page.evaluate(() => {
            const app = Alpine.$data(document.getElementById('app'));
            app.theme = 'dark';
            app.themeStyle = 'originalDark';
            app.applyThemeStyle();
        });
        await page.waitForTimeout(1000);

        htmlClass = await page.locator('html').getAttribute('class') || "";
        console.log(`HTML classes after Original Dark: ${htmlClass}`);
        expect(htmlClass).toContain('dark');
        expect(htmlClass).toContain('theme-originalDark');
        expect(htmlClass).not.toContain('theme-dracula');

        // Verify Original Dark background (--bg: #1A1A1B)
        bgColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
        console.log(`BG Color after Original Dark: ${bgColor}`);
        if (bgColor.startsWith('rgb')) {
            expect(bgColor).toBe('rgb(26, 26, 27)');
        } else {
            expect(bgColor.toLowerCase()).toBe('#1a1a1b');
        }
    });
});
