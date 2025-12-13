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
                try {
                    const json = await response.json();
                    console.log(`Response (XHR/Fetch): ${response.status()} ${response.url()}\nBody: ${JSON.stringify(json, null, 2)}`);
                } catch (e) {
                    // Not all XHR/Fetch responses are JSON, log as text
                    console.log(`Response (XHR/Fetch): ${response.status()} ${response.url()}\nBody: ${await response.text()}`);
                }
            } else {
                console.log(`Response: ${response.status()} ${response.url()}`);
            }
        });

        page.on('console', message => {
            console.log(`Console ${message.type().toUpperCase()}: ${message.text()}`);
        });

        console.log('Navigating to login page...');
        await page.goto(`${APP_URL}/login.html`, { timeout: 60000 }); // Increased timeout for goto
        console.log('Login page loaded.');

        // Attempting login via API call...
        console.log('Attempting login via API call...');
        const loginResponse = await request.post(`${APP_URL}/api/login`, {
            data: { password: APP_PASSWORD },
            headers: { 'Content-Type': 'application/json' }
        });

        await expect(loginResponse.status()).toBe(200);
        console.log(`Login API call successful with status: ${loginResponse.status()}`);

        // --- NEW: Extract and set authentication cookie ---
        const setCookieHeader = loginResponse.headers()['set-cookie'];
        if (setCookieHeader) {
            console.log(`Debug: Raw Set-Cookie header: ${setCookieHeader}`);
            // Assuming the 'auth' cookie is the one we need and it's the first in the header
            const authCookieString = setCookieHeader.split(',').find(s => s.trim().startsWith('auth='));
            if (authCookieString) {
                console.log(`Debug: Auth cookie string found: ${authCookieString}`);
                const parts = authCookieString.split(';');
                const nameValue = parts[0].trim().split('=');
                const cookieName = nameValue[0];
                const cookieValue = nameValue[1];

                let domain = new URL(APP_URL).hostname; // Derive domain from APP_URL
                let path = '/';
                
                // Attempt to parse domain and path from cookie string
                parts.slice(1).forEach(part => {
                    const trimmedPart = part.trim();
                    if (trimmedPart.toLowerCase().startsWith('domain=')) {
                        domain = trimmedPart.substring(7);
                    } else if (trimmedPart.toLowerCase().startsWith('path=')) {
                        path = trimmedPart.substring(5);
                    }
                });

                console.log(`Debug: Attempting to add cookie - Name: ${cookieName}, Value: ${cookieValue}, Domain: ${domain}, Path: ${path}`);
                // Add the cookie to the Playwright page context
                await page.context().addCookies([
                    {
                        name: cookieName,
                        value: cookieValue,
                        domain: domain,
                        path: path,
                        expires: -1 // Session cookie (or derive from attributes if present)
                    }
                ]);
                console.log(`Authentication cookie '${cookieName}' set in browser context.`);
                const currentCookies = await page.context().cookies();
                console.log('Debug: Cookies in browser context after adding auth cookie:', JSON.stringify(currentCookies, null, 2));
            } else {
                console.error('Error: Auth cookie not found in Set-Cookie header!');
            }
        } else {
            console.error('Error: No Set-Cookie header found in login response!');
        }
        // --- END NEW ---

        // After successful API login and cookie setup, navigate to the main app URL
        console.log('Navigating to main app URL after successful login API call and cookie setup...');
        await page.goto(APP_URL, { timeout: 60000 });
        console.log('Navigated to main app URL.');

        // --- NEW: Unregister all service workers as a diagnostic step ---
        console.log('Attempting to unregister all service workers...');
        await page.evaluate(() => {
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(registrations => {
                    for (let registration of registrations) {
                        registration.unregister();
                        console.log('Service Worker unregistered:', registration.scope);
                    }
                });
            }
        });
        await page.waitForTimeout(1000); // Give some time for unregistration to take effect
        console.log('Service worker unregistration attempted.');
        // --- END NEW ---


        // Waiting strategy
        console.log('Login submitted. Adding 40-second wait to allow app to fully initialize and sync...');
        await page.waitForTimeout(40000); // Crude wait for app to settle. 
        console.log('40-second wait completed.');

        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        console.log('Loading screen not visible.');

        await expect(page.locator('#header')).toBeVisible({ timeout: 60000 });
        console.log('Header is visible. Main UI rendered.');
        
        await page.waitForLoadState('networkidle', { timeout: 60000 });
        console.log('Network is idle.');
    }); // Correctly close beforeEach

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

        await expect(saveButton).toHaveText('RSS Feeds saved!'); // Changed saveMessage to saveButton
        // Verify message disappears after a short while (assuming it does)
        await expect(saveButton).toBeHidden(); // Changed saveMessage to saveButton
    });

    test('should save Keyword Blacklist', async ({ page }) => {
        await page.locator('#settings-button').click();
        await page.locator('#configure-keyword-blacklist-btn').click();

        const textarea = page.locator('#keywords-settings-block textarea');
        const saveButton = page.locator('#keywords-settings-block .save-message');

        await textarea.fill('keyword1\nkeyword2');
        await saveButton.click();

        await expect(saveButton).toHaveText('Keywords saved!'); // Changed saveMessage to saveButton
        // Verify message disappears after a short while (assuming it does)
        await expect(saveButton).toBeHidden(); // Changed saveMessage to saveButton
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

    test.afterEach(async ({ page }, testInfo) => {
        if (testInfo.status !== testInfo.expectedStatus) {
            console.log(`Test failed: ${testInfo.title}. Taking screenshot...`);
            await page.screenshot({ path: `test-results/screenshots/${testInfo.title.replace(/\s+/g, '-')}-failed.png` });
            console.log(`Screenshot taken for failed test: test-results/screenshots/${testInfo.title.replace(/\s+/g, '-')}-failed.png`);
        }
    });
});