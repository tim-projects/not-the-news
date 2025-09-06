import { test, expect } from '@playwright/test';

test.describe('UI Elements and Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await page.waitForTimeout(5000);
        await page.goto(process.env.APP_URL);
        // Wait for the app to load and the loading screen to disappear
        await page.waitForLoadState('networkidle');
        await expect(page.locator('#loading-screen')).not.toBeVisible();
    });

    test('should display header elements', async ({ page }) => {
        await expect(page.locator('#header')).toBeVisible();
        await expect(page.locator('#ntn-title')).toHaveText('Not The News');
        await expect(page.locator('#shuffle-button')).toBeVisible();
        await expect(page.locator('#settings-button')).toBeVisible();
    });

    test('should open and close settings modal', async ({ page }) => {
        await page.locator('#settings-button').click();
        await expect(page.locator('.modal')).toBeVisible();
        await expect(page.locator('#main-settings')).toBeVisible();

        await page.locator('.modal-content .close').click();
        await expect(page.locator('.modal')).toBeHidden();
    });

    test('should change filter mode', async ({ page }) => {
        await page.locator('#settings-button').click();
        await expect(page.locator('#filter-selector')).toBeVisible();

        // Change to Starred filter
        await page.locator('#filter-selector').selectOption('starred');
        // Close settings to see effect on main page
        await page.locator('.modal-content .close').click();
        // Re-open settings to verify selected option
        await page.locator('#settings-button').click();
        await expect(page.locator('#filter-selector')).toHaveValue('starred');
    });

    test('should toggle sync enabled', async ({ page }) => {
        await page.locator('#settings-button').click();
        const syncToggle = page.locator('#sync-toggle');
        const syncText = page.locator('#sync-text');

        // Initial state (assuming default is On)
        await expect(syncText).toHaveText('On');
        await expect(syncToggle).toBeChecked();

        // Toggle Off
        await syncToggle.uncheck();
        await expect(syncText).toHaveText('Off');
        await expect(syncToggle).not.toBeChecked();

        // Toggle On
        await syncToggle.check();
        await expect(syncText).toHaveText('On');
        await expect(syncToggle).toBeChecked();
    });

    test('should toggle images enabled', async ({ page }) => {
        await page.locator('#settings-button').click();
        const imagesToggle = page.locator('#images-toggle');
        const imagesText = page.locator('#images-text');

        // Initial state (assuming default is On)
        await expect(imagesText).toHaveText('On');
        await expect(imagesToggle).toBeChecked();

        // Toggle Off
        await imagesToggle.uncheck();
        await expect(imagesText).toHaveText('Off');
        await expect(imagesToggle).not.toBeChecked();

        // Toggle On
        await syncToggle.check();
        await expect(imagesText).toHaveText('On');
        await expect(imagesToggle).toBeChecked();
    });

    test('should toggle open URLs in new tab', async ({ page }) => {
        await page.locator('#settings-button').click();
        const newTabToggle = page.locator('#open-urls-in-new-tab-toggle');
        const newTabText = page.locator('#open-urls-in-new-tab-text');

        // Initial state (assuming default is Yes)
        await expect(newTabText).toHaveText('Yes');
        await expect(newTabToggle).toBeChecked();

        // Toggle No
        await newTabToggle.uncheck();
        await expect(newTabText).toHaveText('No');
        await expect(newTabToggle).not.toBeChecked();

        // Toggle Yes
        await newTabToggle.check();
        await expect(newTabText).toHaveText('Yes');
        await expect(newTabToggle).toBeChecked();
    });

    test('should navigate to RSS feeds configuration', async ({ page }) => {
        await page.locator('#settings-button').click();
        await page.locator('#configure-rss-feeds-btn').click();
        await expect(page.locator('#rss-settings-block')).toBeVisible();
        await expect(page.locator('#main-settings')).toBeHidden();
        await expect(page.locator('#back-button')).toBeVisible();

        // Go back
        await page.locator('#back-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();
        await expect(page.locator('#rss-settings-block')).toBeHidden();
    });

    test('should navigate to Keyword Blacklist configuration', async ({ page }) => {
        await page.locator('#settings-button').click();
        await page.locator('#configure-keyword-blacklist-btn').click();
        await expect(page.locator('#keywords-settings-block')).toBeVisible();
        await expect(page.locator('#main-settings')).toBeHidden();
        await expect(page.locator('#back-button')).toBeVisible();

        // Go back
        await page.locator('#back-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();
        await expect(page.locator('#keywords-settings-block')).toBeHidden();
    });

    test('should save RSS feeds', async ({ page }) => {
        await page.locator('#settings-button').click();
        await page.locator('#configure-rss-feeds-btn').click();

        const textarea = page.locator('#rss-settings-block textarea');
        const saveButton = page.locator('#rss-settings-block .save-message');

        await textarea.fill('http://example.com/feed1\nhttp://example.com/feed2');
        await saveButton.click();

        await expect(saveMessage).toHaveText('RSS Feeds saved!');
        // Verify message disappears after a short while (assuming it does)
        await expect(saveMessage).toBeHidden();
    });

    test('should save Keyword Blacklist', async ({ page }) => {
        await page.locator('#settings-button').click();
        await page.locator('#configure-keyword-blacklist-btn').click();

        const textarea = page.locator('#keywords-settings-block textarea');
        const saveButton = page.locator('#keywords-settings-block .save-message');

        await textarea.fill('keyword1\nkeyword2');
        await saveButton.click();

        await expect(saveMessage).toHaveText('Keywords saved!');
        // Verify message disappears after a short while (assuming it does)
        await expect(saveMessage).toBeHidden();
    });

    test('should scroll to top', async ({ page }) => {
        // Scroll down to make the button visible
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(page.locator('#scroll-to-top')).toBeVisible();

        await page.locator('#scroll-to-top').click();
        // Verify scroll position is at top
        await page.waitForFunction(() => window.scrollY === 0);
    });

    // Test for individual item interactions (star, read/unread)
    test('should star and unstar an item', async ({ page }) => {
        // Ensure there's at least one item to interact with
        await page.waitForSelector('.item');
        const firstItemGuid = await page.locator('.item').first().getAttribute('data-guid');
        const starButton = page.locator(`.item[data-guid="${firstItemGuid}"] .star`);

        // Star the item
        await starButton.click();
        await expect(starButton).toHaveClass(/starred/);

        // Unstar the item
        await starButton.click();
        await expect(starButton).not.toHaveClass(/starred/);
    });

    test('should mark an item as read and unread (via close button)', async ({ page }) => {
        await page.waitForSelector('.item');
        const initialGuid = await page.locator('.item').first().getAttribute('data-guid');
        const closeButton = page.locator(`.item[data-guid="${initialGuid}"] .close`);

        // Mark as read
        await closeButton.click();
        // Verify visual change: item should have 'read' class
        await expect(closeButton).toHaveClass(/read/);

        // Verify item disappears from "Unread" view
        // This requires checking the count of unread items or waiting for it to be hidden
        // For now, we'll just check the class, as the filtering is handled by Alpine.js

        // Mark as unread
        await closeButton.click();
        await expect(closeButton).not.toHaveClass(/read/);
    });

    test('should mark an item as read and unread (via read-toggle button)', async ({ page }) => {
        await page.waitForSelector('.item');
        const initialGuid = await page.locator('.item').first().getAttribute('data-guid');
        const readToggleButton = page.locator(`.item[data-guid="${initialGuid}"] .read-toggle`);

        // Mark as read
        await readToggleButton.click();
        // Verify visual change: item should have 'read' class
        await expect(readToggleButton).toHaveClass(/read/);

        // Mark as unread
        await readToggleButton.click();
        await expect(readToggleButton).not.toHaveClass(/read/);
    });
});
