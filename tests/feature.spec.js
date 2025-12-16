import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';
const APP_PASSWORD = "devtestpwd";

test.describe('Feature Verification Tests', () => {

    let consoleLogs = [];
    let dialogMessages = [];
    let downloads = [];

    test.beforeEach(async ({ page, request }) => {
        // Clear logs and dialogs for each test
        consoleLogs = [];
        dialogMessages = [];
        downloads = [];

        // --- NEW: Explicitly unregister all service workers ---
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

        page.on('console', message => {
            consoleLogs.push({ type: message.type(), text: message.text() });
            console.log(`[Browser Console ${message.type().toUpperCase()}]: ${message.text()}`);
        });

        page.on('dialog', async dialog => {
            dialogMessages.push({ type: dialog.type(), message: dialog.message() });
            console.log(`[Browser Dialog ${dialog.type().toUpperCase()}]: ${dialog.message()}`);
            await dialog.accept(); // Always accept to allow test to continue
        });
        
        page.on('download', async download => {
            console.log(`[Browser Download]: ${download.suggestedFilename()}`);
            downloads.push(download);
            // You can save the download if needed: await download.saveAs(path.join('test-results/downloads', download.suggestedFilename()));
        });

        // Login routine (copied from ui.spec.js beforeEach)
        await page.goto(`${APP_URL}/login.html`, { timeout: 60000 });
        const loginResponse = await request.post(`${APP_URL}/api/login`, {
            data: { password: APP_PASSWORD },
            headers: { 'Content-Type': 'application/json' }
        });
        await expect(loginResponse.status()).toBe(200);

        const setCookieHeader = loginResponse.headers()['set-cookie'];
        if (setCookieHeader) {
            const authCookieString = setCookieHeader.split(',').find(s => s.trim().startsWith('auth='));
            if (authCookieString) {
                const parts = authCookieString.split(';');
                const nameValue = parts[0].trim().split('=');
                const cookieName = nameValue[0];
                const cookieValue = nameValue[1];
                let domain = new URL(APP_URL).hostname;
                let path = '/';
                parts.slice(1).forEach(part => {
                    const trimmedPart = part.trim();
                    if (trimmedPart.toLowerCase().startsWith('domain=')) domain = trimmedPart.substring(7);
                    else if (trimmedPart.toLowerCase().startsWith('path=')) path = trimmedPart.substring(5);
                });
                await page.context().addCookies([{ name: cookieName, value: cookieValue, domain: domain, path: path, expires: -1 }]);
            }
        }
        await page.goto(APP_URL, { timeout: 60000 });

        // NEW: Fetch and log the content of index.html to verify it's the latest version
        const htmlContent = await page.content();
        console.log('[Playwright Debug]: Fetched index.html content (first 500 chars):\n', htmlContent.substring(0, 500));
        // You can also look for specific strings or patterns in htmlContent to confirm updates

        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await expect(page.locator('#header')).toBeVisible({ timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 60000 });
        await page.waitForSelector('.item', { state: 'visible', timeout: 60000 });
    });

    test('should show confirmation dialog and log output for Reset button', async ({ page }) => {
        await page.locator('#settings-button').click();
        await expect(page.locator('.modal')).toBeVisible();

        const resetButton = page.locator('#reset-app-button');
        await expect(resetButton).toBeVisible();

        await resetButton.click();

        // Check if a confirm dialog was triggered
        expect(dialogMessages.some(d => d.type === 'confirm')).toBe(true);
        expect(dialogMessages.find(d => d.type === 'confirm').message).toContain('Are you sure you want to reset the application?');

        // Check console logs
        expect(consoleLogs.some(log => log.text.includes('resetApplicationData called.'))).toBe(true);
        expect(consoleLogs.some(log => log.text.includes('User confirmed reset: true'))).toBe(true);
        expect(consoleLogs.some(log => log.text.includes('Application reset complete! Reloading...'))).toBe(true);
        
        // As the dialog is accepted, it should proceed with the reset logic and eventually reload
        await page.waitForNavigation(); // Wait for page reload
    });

    test('should initiate download and log output for Backup button', async ({ page }) => {
        await page.locator('#settings-button').click();
        await expect(page.locator('.modal')).toBeVisible();

        const backupButton = page.locator('#backup-config-button');
        await expect(backupButton).toBeVisible();

        await backupButton.click();

        // Check console logs
        expect(consoleLogs.some(log => log.text.includes('backupConfig called.'))).toBe(true);
        expect(consoleLogs.some(log => log.text.includes('Fetching config for backup from: /api/admin/config-backup'))).toBe(true);
        expect(consoleLogs.some(log => log.text.includes('Configuration backed up successfully!'))).toBe(true);

        // Check for download
        expect(downloads.length).toBeGreaterThan(0);
        const downloadedFile = downloads[0];
        expect(downloadedFile.suggestedFilename()).toMatch(/not-the-news-config-backup-\d{4}-\d{2}-\d{2}\.json/);
    });

    test('should verify read item highlight styling', async ({ page }) => {
        await page.waitForSelector('.item');
        const firstItemGuid = await page.locator('.item').first().getAttribute('data-guid');
        const readButton = page.locator(`.item[data-guid="${firstItemGuid}"] .read-button`);

        // Mark item as read
        await readButton.click();

        // Check if 'read' class is present
        await expect(readButton).toHaveClass(/read/);

        // Get computed styles for the highlighted state
        const computedStyles = await readButton.evaluate(el => {
            const style = window.getComputedStyle(el);
            return {
                color: style.color,
                backgroundColor: style.backgroundColor,
                boxShadow: style.boxShadow
            };
        });

        // Assert expected gold color (adjust these RGB values if your --gold-color is different)
        // #FFD700 in RGB is rgb(255, 215, 0)
        expect(computedStyles.color).toBe('rgb(255, 215, 0)'); // var(--gold-color)
        expect(computedStyles.backgroundColor).toMatch(/rgba\(255, 215, 0, 0\.1\)/); // rgba(var(--gold-rgb), 0.1)
        expect(computedStyles.boxShadow).toContain('rgb(255, 215, 0)'); // box-shadow using var(--gold-color)
    });
});
