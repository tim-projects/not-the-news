import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:8085'; // Explicitly use HTTP for APP_URL here
const APP_PASSWORD = "devtestpwd";

test.describe('UI Elements and Interactions', () => {
    test.beforeEach(async ({ page, request }) => { // Added 'request' to the fixture
        page.on('request', request => {
            console.log(`Request: ${request.method()} ${request.url()}`);
        });

        page.on('response', async response => {
            const request = response.request();
            // Log only XHR/Fetch responses
            if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
                if (response.status() >= 300 && response.status() <= 399) {
                    console.log(`Response (XHR/Fetch - Redirect): ${response.status()} ${response.url()}`);
                    return;
                }
                try {
                    const json = await response.json();
                    console.log(`Response (XHR/Fetch): ${response.status()} ${response.url()}\nBody: ${JSON.stringify(json, null, 2)}`);
                } catch (e) {
                    // Not all XHR/Fetch responses are JSON, log as text
                    try {
                        const text = await response.text();
                        console.log(`Response (XHR/Fetch): ${response.status()} ${response.url()}\nBody: ${text}`);
                    } catch (err) {
                        console.log(`Response (XHR/Fetch): ${response.status()} ${response.url()}\nBody: [Could not read body: ${err.message}]`);
                    }
                }
            } else {
                console.log(`Response: ${response.status()} ${response.url()}`);
            }
        });

        page.on('console', message => {
            console.log(`Console ${message.type().toUpperCase()}: ${message.text()}`);
        });

        console.log('Navigating to login page...');
        await page.goto(`${APP_URL}/login.html`, { timeout: 60000 });
        console.log('Login page loaded.');

        // Attempting login via UI bypass...
        console.log('Attempting login via UI bypass...');
        await page.fill('#email', 'test@example.com');
        await page.fill('#pw', APP_PASSWORD);
        await page.click('#login-btn');

        // Wait for redirect to main app URL
        console.log('Waiting for redirect to main app URL...');
        await page.waitForURL(APP_URL, { timeout: 60000 });
        console.log('Navigated to main app URL.');

        // --- NEW: Unregister all service workers as a diagnostic step ---
        // console.log('Attempting to unregister all service workers...');
        // await page.evaluate(() => {
        //     if ('serviceWorker' in navigator) {
        //         navigator.serviceWorker.getRegistrations().then(registrations => {
        //             for (let registration of registrations) {
        //                 registration.unregister();
        //                 console.log('Service Worker unregistered:', registration.scope);
        //             }
        //         });
        //     }
        // });
        // await page.waitForTimeout(1000); // Give some time for unregistration to take effect
        // console.log('Service worker unregistration attempted.');
        // --- END NEW ---

        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        console.log('Loading screen not visible.');

        await expect(page.locator('#header')).toBeVisible({ timeout: 60000 });
        console.log('Header is visible. Main UI rendered.');
        
        // Removed waitForLoadState('networkidle') as it can hang with Service Workers/Background Sync

        // NEW: Ensure at least one feed is configured
        const configResponse = await page.evaluate(async () => {
            const resp = await fetch('/api/user-state/rssFeeds');
            return await resp.json();
        });
        
        if (!configResponse.value || Object.keys(configResponse.value).length === 0) {
            console.log('No feeds configured in test environment. Adding Hacker News...');
            await page.evaluate(async () => {
                await fetch('/api/user-state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([{
                        type: 'simpleUpdate',
                        key: 'rssFeeds',
                        value: { "Tech": { "Default": [{ "url": "https://news.ycombinator.com/rss" }] } }
                    }])
                });
                // Trigger sync
                await fetch('/api/feed-sync', { method: 'POST' });
            });
            // Wait a moment for worker to finish first sync
            await page.waitForTimeout(5000);
        }

        // NEW: Wait for at least one feed item to be visible
        console.log('Waiting for at least one feed item (.item) to be visible...');
        await page.waitForSelector('.entry:not(.help-panel-item)', { state: 'visible', timeout: 60000 });
        console.log('At least one feed item is visible.');
    }); // Correctly close beforeEach

    test('should display header elements', async ({ page }) => {
        await expect(page.locator('#header')).toBeVisible();
        await expect(page.locator('#ntn-title h2')).toHaveText('Not The News');
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
        await expect(page.locator('.modal')).toBeVisible(); // Ensure modal is open
        await expect(page.locator('#main-settings')).toBeVisible(); // Ensure main settings content is visible
        await expect(page.locator('#filter-selector')).toBeVisible();

        // Change to Starred filter
        await page.locator('#filter-selector').selectOption('starred');
        // Close settings to see effect on main page
        await page.locator('.modal-content .close').click();
        // Re-open settings to verify selected option
        await page.locator('#settings-button').click();
        await expect(page.locator('#main-settings')).toBeVisible(); // Re-ensure main settings content is visible
        await expect(page.locator('#filter-selector')).toHaveValue('starred');
    });

    test('should toggle sync enabled', async ({ page }) => {
        await page.locator('#settings-button').click();
        await expect(page.locator('.modal')).toBeVisible(); // Ensure modal is open
        // Ensure main settings content is visible and then the toggle itself
        await expect(page.locator('#main-settings')).toBeVisible();
        await page.waitForLoadState('networkidle'); // Added explicit wait
        const syncToggle = page.locator('label[for="sync-toggle"]');
        const syncText = page.locator('#sync-text');
        await expect(syncToggle).toBeVisible();
        await expect(syncText).toBeVisible();

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
        await expect(page.locator('.modal')).toBeVisible(); // Ensure modal is open
        await expect(page.locator('#main-settings')).toBeVisible();
        await page.waitForLoadState('networkidle'); // Added explicit wait
        const imagesToggle = page.locator('label[for="images-toggle"]');
        const imagesText = page.locator('#images-text');
        await expect(imagesToggle).toBeVisible();
        await expect(imagesText).toBeVisible();

        // Initial state (assuming default is On)
        await expect(imagesText).toHaveText('On');
        await expect(imagesToggle).toBeChecked();

        // Toggle Off
        await imagesToggle.uncheck();
        await expect(imagesText).toHaveText('Off');
        await expect(imagesToggle).not.toBeChecked();

        // Toggle On
        await imagesToggle.check();
        await expect(imagesText).toHaveText('On');
        await expect(imagesToggle).toBeChecked();
    });

    test('should toggle open URLs in new tab', async ({ page }) => {
        await page.locator('#settings-button').click();
        await expect(page.locator('.modal')).toBeVisible(); // Ensure modal is open
        await expect(page.locator('#main-settings')).toBeVisible();
        await page.waitForLoadState('networkidle'); // Added explicit wait
        const newTabToggle = page.locator('label[for="open-urls-in-new-tab-toggle"]');
        const newTabText = page.locator('#open-urls-in-new-tab-text');
        await expect(newTabToggle).toBeVisible();
        await expect(newTabText).toBeVisible();

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
        await expect(page.locator('.modal')).toBeVisible(); // Ensure modal is open
        await expect(page.locator('#main-settings')).toBeVisible(); // Ensure main settings content is visible
        await page.locator('#configure-rss-feeds-btn').click();
        await expect(page.locator('#main-settings')).toBeHidden();
        await expect(page.locator('#rss-settings-block')).toBeVisible();
        await expect(page.locator('#back-button')).toBeVisible();

        // Go back
        await page.locator('#back-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();
        await expect(page.locator('#rss-settings-block')).toBeHidden();
    });

    test('should navigate to Keyword Blacklist configuration', async ({ page }) => {
        await page.locator('#settings-button').click();
        await expect(page.locator('.modal')).toBeVisible(); // Ensure modal is open
        await expect(page.locator('#main-settings')).toBeVisible(); // Ensure main settings content is visible
        await page.locator('#configure-keyword-blacklist-btn').click();
        await expect(page.locator('#main-settings')).toBeHidden();
        await expect(page.locator('#keywords-settings-block')).toBeVisible();
        await expect(page.locator('#back-button')).toBeVisible();

        // Go back
        await page.locator('#back-button').click();
        await expect(page.locator('#main-settings')).toBeVisible();
        await expect(page.locator('#keywords-settings-block')).toBeHidden();
    });

    test('should save RSS feeds', async ({ page }) => {
        await page.locator('#settings-button').click();
        await expect(page.locator('.modal')).toBeVisible(); 
        await expect(page.locator('#main-settings')).toBeVisible(); 
        await page.locator('#configure-rss-feeds-btn').click();
        await expect(page.locator('#rss-settings-block')).toBeVisible();

        const textarea = page.locator('#rss-settings-block textarea');
        const saveButton = page.locator('#save-rss-btn');
        const statusMessage = page.locator('#sync-status-message');
        
        await expect(textarea).toBeVisible();
        await expect(saveButton).toBeVisible();

        await textarea.fill('https://www.nasa.gov/news-release/feed/\nhttps://www.theverge.com/rss/index.xml');
        await saveButton.click();

        await expect(statusMessage).toBeVisible();
        await expect(statusMessage).toHaveText('RSS Feeds saved!');
    });

    test('should save Keyword Blacklist', async ({ page }) => {
        await page.locator('#settings-button').click();
        await expect(page.locator('.modal')).toBeVisible(); 
        await expect(page.locator('#main-settings')).toBeVisible(); 
        await page.locator('#configure-keyword-blacklist-btn').click();
        await expect(page.locator('#keywords-settings-block')).toBeVisible();

        const textarea = page.locator('#keywords-settings-block textarea');
        const saveButton = page.locator('#save-keywords-btn');
        const statusMessage = page.locator('#sync-status-message');
        
        await expect(textarea).toBeVisible();
        await expect(saveButton).toBeVisible();

        await textarea.fill('keyword1\nkeyword2');
        await saveButton.click();

        await expect(statusMessage).toBeVisible();
        await expect(statusMessage).toHaveText('Keyword Blacklist saved!');
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

    test('should star an item without hiding it', async ({ page }) => {
        await page.waitForSelector('.item');
        const initialItemsCount = await page.locator('.item').count();
        const firstItemGuid = await page.locator('.item').first().getAttribute('data-guid');
        const starButton = page.locator(`.item[data-guid="${firstItemGuid}"] .star`);

        // Star the item
        await starButton.click();
        await expect(starButton).toHaveClass(/starred/);

        // Verify that the item count does not change (item is not hidden)
        const currentItemsCount = await page.locator('.item').count();
        expect(currentItemsCount).toBe(initialItemsCount);

        // Optional: Unstar it to clean up state
        await starButton.click();
        await expect(starButton).not.toHaveClass(/starred/);
    });

    test('should mark an item as read and unread', async ({ page }) => {
        // Ensure filter mode is 'unread'
        await page.locator('#settings-button').click();
        await page.locator('#filter-selector').selectOption('unread');
        await page.locator('.modal-content .close').click();

        await page.waitForSelector('.item');
        const initialItems = await page.locator('.item').all();
        const initialItemsCount = initialItems.length;
        const initialGuid = await initialItems[0].getAttribute('data-guid');
        const readButton = page.locator(`.item[data-guid="${initialGuid}"] .read-button`);
        await expect(readButton).toBeVisible();

        // Mark as read
        await readButton.click();
        // Verify visual change: item should disappear in unread mode
        await expect(page.locator(`.item[data-guid="${initialGuid}"]`)).toBeHidden();
        await expect(page.locator('.item')).toHaveCount(initialItemsCount - 1);
    });



    test('should load and display content when offline', async ({ page, request }) => {
        // 1. Load the app while online to ensure everything is cached
        console.log('Ensuring app is fully loaded while online...');
        await page.goto(APP_URL, { timeout: 60000 });
        await expect(page.locator('#header')).toBeVisible({ timeout: 60000 });
        await page.waitForSelector('.item', { state: 'visible', timeout: 60000 });
        console.log('App loaded online with items.');

        // Wait for Service Worker to be ready and all assets to be cached
        console.log('Waiting for Service Worker to be activated and ready...');
        await page.evaluate(async () => {
            if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.ready;
                // Force activation
                if (registration.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
                // Wait for the active worker to be controller
                if (!navigator.serviceWorker.controller) {
                    await new Promise(resolve => {
                        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
                    });
                }
                console.log('Service Worker is ready and controlling the page.');
            }
        });
        // Give it more time to ensure background caching tasks are done and SW is stable
        await page.waitForTimeout(10000);

        // 2. Set the browser context to offline
        console.log('Setting context to offline...');
        await page.context().setOffline(true);

        // 3. Reload the page while offline
        console.log('Reloading page while offline...');
        // Note: We use goto() because it's handled by the Service Worker for the initial navigation
        await page.goto(APP_URL, { waitUntil: 'load', timeout: 60000 });
        await page.waitForLoadState('load');

        // 4. Verify the app still loads and shows content from IndexedDB
        console.log('Verifying app UI in offline mode...');
        try {
            // Wait for loading screen to disappear
            await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
            await expect(page.locator('#ntn-title')).toHaveText('Not The News', { timeout: 30000 });
        } catch (e) {
            console.log('Failed to find #ntn-title or loading screen did not hide. Current page content:', await page.content());
            throw e;
        }

        // Verify content visibility from IndexedDB FIRST to ensure app is working
        console.log('Verifying content visibility from IndexedDB...');
        const itemSelector = page.locator('.item');
        await expect(itemSelector.first()).toBeVisible({ timeout: 30000 });
        const itemsCount = await itemSelector.count();
        expect(itemsCount).toBeGreaterThan(0);
        console.log(`Successfully verified ${itemsCount} items are visible offline.`);

        // Verify "Offline." status message is visible
        console.log('Verifying offline status message...');
        const syncStatusMessage = page.locator('#sync-status-message');
        await expect(syncStatusMessage).toBeVisible({ timeout: 10000 });
        await expect(syncStatusMessage).toHaveText('Offline.');

        // 5. Cleanup: Set back to online
        await page.context().setOffline(false);
    });

    test.afterEach(async ({ page }, testInfo) => {
        if (testInfo.status !== testInfo.expectedStatus) {
            console.log(`Test failed: ${testInfo.title}. Taking screenshot...`);
            await page.screenshot({ path: `test-results/screenshots/${testInfo.title.replace(/\s+/g, '-')}-failed.png` });
            console.log(`Screenshot taken for failed test: test-results/screenshots/${testInfo.title.replace(/\s+/g, '-')}-failed.png`);
        }
    });
});