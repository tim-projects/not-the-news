import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Demo Mode', () => {
    test('should load demo deck for unauthenticated user', async ({ page }) => {
        // Ensure we are logged out by clearing storage
        await page.goto(APP_URL);
        await page.evaluate(() => localStorage.clear());
        await page.reload();

        // Wait for loading screen to hide
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 30000 });

        // Check for demo mode indicators
        const demoFooter = page.locator('.demo-footer');
        await expect(demoFooter).toBeVisible({ timeout: 10000 });
        await expect(demoFooter.locator('p')).toContainText('You are viewing a demo feed.');
        await expect(demoFooter.locator('button')).toContainText('Show More & Login');

        // Verify some items are loaded (demo deck from R2 should have 10 items)
        const entries = page.locator('.entry:not(.help-panel-item)');
        await expect(entries).toHaveCount(10);
        
        // Verify we can see titles
        const firstTitle = entries.first().locator('.itemtitle');
        await expect(firstTitle).toBeVisible();
    });

    test('Show More button should redirect to login', async ({ page }) => {
        await page.goto(APP_URL);
        await page.evaluate(() => localStorage.clear());
        await page.reload();

        await expect(page.locator('.demo-footer button')).toBeVisible();
        
        // Click Show More & Login
        await page.locator('.demo-footer button').click();
        
        // Should be at login page
        await expect(page).toHaveURL(/\/login\.html/);
    });

    test('Interactions should show CTA', async ({ page }) => {
        await page.goto(APP_URL);
        await page.evaluate(() => localStorage.clear());
        await page.reload();

        // 1. Star interaction
        const firstStar = page.locator('.entry .star').first();
        await firstStar.click();
        await expect(page.locator('#cta-modal h2')).toContainText('Unlock Full Features');
        await page.locator('#cta-modal button:has-text("Keep Exploring")').click();
        await expect(page.locator('#cta-modal')).toBeHidden();

        // 2. Read interaction
        const initialCount = await page.locator('.entry:not(.help-panel-item)').count();
        const firstRead = page.locator('.entry .read-button').first();
        await firstRead.click();
        await expect(page.locator('#cta-modal h2')).toContainText('Unlock Full Features');
        await page.locator('#cta-modal button:has-text("Keep Exploring")').click();
        
        // Item should be gone, but deck should still have other items
        await expect(page.locator('.entry:not(.help-panel-item)')).toHaveCount(initialCount - 1);
    });
});
