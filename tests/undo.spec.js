import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';
const APP_PASSWORD = "devtestpwd";

test.describe('Undo Mark as Read', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, APP_URL);
        await ensureFeedsSeeded(page);

        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await page.waitForSelector('.item', { state: 'visible', timeout: 60000 });
    });

    test('should show undo notification when marking an item as read', async ({ page }) => {
        // Ensure filter mode is 'unread'
        await page.locator('#settings-button').click();
        await page.locator('#filter-selector').selectOption('unread');
        await page.locator('.modal-content .close').click();

        await page.waitForSelector('.item');
        const firstItem = page.locator('.item').first();
        const firstGuid = await firstItem.getAttribute('data-guid');
        const readButton = page.locator(`.item[data-guid="${firstGuid}"] .read-button`);

        // Mark as read
        await readButton.click();

        // Verify item is hidden
        await expect(page.locator(`.item[data-guid="${firstGuid}"]`)).toBeHidden();

        // Verify undo notification is visible
        const undoNotification = page.locator('#undo-notification');
        await expect(undoNotification).toBeVisible();
        await expect(undoNotification).toHaveClass(/visible/);

        // Verify undo button text
        const undoButton = undoNotification.locator('.undo-button');
        await expect(undoButton).toContainText('Undo');

        // Verify timer outline is active
        const timerOutline = undoNotification.locator('.undo-timer-outline');
        await expect(timerOutline).toHaveClass(/active/);

        // Verify rx and ry attributes are set dynamically and are reasonable (not 100)
        // Check for presence and value using regex
        await expect(timerOutline).toHaveAttribute('rx', /^(?!100(\.0+)?$)\d+(\.\d+)?$/);
        await expect(timerOutline).toHaveAttribute('ry', /^(?!100(\.0+)?$)\d+(\.\d+)?$/);
        
        // Get values to check they are equal (approximately)
        const rx = await timerOutline.getAttribute('rx');
        const ry = await timerOutline.getAttribute('ry');
        
        const rxNum = parseFloat(rx);
        const ryNum = parseFloat(ry);
        expect(rxNum).toBeGreaterThan(10); 
        expect(Math.abs(rxNum - ryNum)).toBeLessThan(0.1);
    });

    test('should restore item when undo is clicked', async ({ page }) => {
        // Ensure filter mode is 'unread'
        await page.locator('#settings-button').click();
        await page.locator('#filter-selector').selectOption('unread');
        await page.locator('.modal-content .close').click();

        await page.waitForSelector('.item');
        const firstItem = page.locator('.item').first();
        const firstGuid = await firstItem.getAttribute('data-guid');
        const readButton = page.locator(`.item[data-guid="${firstGuid}"] .read-button`);

        // Mark as read
        await readButton.click();
        await expect(page.locator(`.item[data-guid="${firstGuid}"]`)).toBeHidden();

        // Click undo
        await page.locator('#undo-notification .undo-button').click();

        // Verify item is restored
        await expect(page.locator(`.item[data-guid="${firstGuid}"]`)).toBeVisible();

        // Verify undo notification is hidden
        await expect(page.locator('#undo-notification')).toBeHidden();
    });

    test('should restore item to its original position when undo is clicked', async ({ page }) => {
        // Ensure filter mode is 'unread'
        await page.locator('#settings-button').click();
        await page.locator('#filter-selector').selectOption('unread');
        await page.locator('.modal-content .close').click();

        await page.waitForSelector('.item');
        const items = page.locator('.item');
        const count = await items.count();
        if (count < 2) {
            console.log('Not enough items to test position restoration, skipping.');
            return;
        }

        const secondItem = items.nth(1);
        const secondGuid = await secondItem.getAttribute('data-guid');
        const readButton = page.locator(`.item[data-guid="${secondGuid}"] .read-button`);

        // Mark second item as read
        await readButton.click();
        await expect(page.locator(`.item[data-guid="${secondGuid}"]`)).toBeHidden();

        // Click undo
        await page.locator('#undo-notification .undo-button').click();

        // Verify item is restored and is still at index 1
        await expect(page.locator(`.item[data-guid="${secondGuid}"]`)).toBeVisible();
        const restoredItem = page.locator('.item').nth(1);
        const restoredGuid = await restoredItem.getAttribute('data-guid');
        expect(restoredGuid).toBe(secondGuid);
    });

    test('should hide undo notification after 5 seconds', async ({ page }) => {
        await page.waitForSelector('.item');
        const firstItem = page.locator('.item').first();
        const firstGuid = await firstItem.getAttribute('data-guid');
        const readButton = page.locator(`.item[data-guid="${firstGuid}"] .read-button`);

        // Mark as read
        await readButton.click();
        await expect(page.locator('#undo-notification')).toBeVisible();

        // Wait for 5.5 seconds (to be sure)
        await page.waitForTimeout(5500);

        // Verify undo notification is hidden
        await expect(page.locator('#undo-notification')).toBeHidden();
    });
});
