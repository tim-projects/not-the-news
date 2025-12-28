import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:8085';

test.describe('Authentication Flow', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', message => {
            console.log(`[Browser Console] ${message.type().toUpperCase()}: ${message.text()}`);
        });
        await page.goto(`${APP_URL}/login.html`);
    });

    test('should show error on empty login', async ({ page }) => {
        await page.click('#login-btn');
        const message = page.locator('#auth-message');
        await expect(message).toBeVisible();
        await expect(message).toContainText('Email and password required');
    });

    test('should show error on invalid credentials', async ({ page }) => {
        await page.fill('#email', 'nonexistent@example.com');
        await page.fill('#pw', 'wrongpassword');
        await page.click('#login-btn');
        
        const message = page.locator('#auth-message');
        await expect(message).toBeVisible({ timeout: 10000 });
        // Error message depends on Firebase response
        await expect(message).not.toBeEmpty();
    });

    test('should attempt signup', async ({ page }) => {
        const testEmail = `test-${Date.now()}@example.com`;
        await page.fill('#email', testEmail);
        await page.fill('#pw', 'testpassword123');
        
        console.log(`Attempting signup with ${testEmail}`);
        await page.click('#signup-btn');
        
        // If signup is disabled or fails, we should see an error
        const message = page.locator('#auth-message');
        await expect(message).toBeVisible({ timeout: 15000 });
        
        const text = await message.textContent();
        console.log(`Signup response message: ${text}`);
        
        if (text?.includes('Account created')) {
            await page.waitForURL(`${APP_URL}/`, { timeout: 15000 });
            await expect(page).toHaveURL(`${APP_URL}/`);
        }
    });

    test('should login via bypass account', async ({ page }) => {
        await page.fill('#email', 'test@example.com');
        await page.fill('#pw', 'devtestpwd');
        await page.click('#login-btn');
        
        await page.waitForURL(`${APP_URL}/`, { timeout: 15000 });
        await expect(page).toHaveURL(`${APP_URL}/`);
    });

    test('should logout from settings', async ({ page }) => {
        // First login
        await page.fill('#email', 'test@example.com');
        await page.fill('#pw', 'devtestpwd');
        await page.click('#login-btn');
        await page.waitForURL(`${APP_URL}/`);

        // Open settings
        await page.click('#settings-button');
        await page.click('#configure-advanced-settings-btn');
        
        // Click logout
        await page.click('#logout-button');
        
        // Should redirect to login
        await page.waitForURL(/.*login.html/);
        await expect(page).toHaveURL(/.*login.html/);
    });
});
