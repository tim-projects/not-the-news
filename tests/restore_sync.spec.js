import { test, expect } from '@playwright/test';
import fs from 'fs';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const APP_PASSWORD = "devtestpwd";
const BACKUP_FILE = 'backup/not-the-news-config-backup-2025-12-22T10-00-55.json';

test.describe('Restore and Sync', () => {
    test('should restore backup and sync new items', async ({ page, request }) => {
        page.on('console', msg => console.log(`BROWSER CONSOLE: ${msg.text()}`));

        // 1. Read backup file
        const backupData = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
        
        // 2. Restore config via API
        console.log("Restoring configuration...");
        const restoreResponse = await request.post(`${APP_URL}/api/admin/config-restore`, {
            data: backupData,
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': APP_PASSWORD
            }
        });
        await expect(restoreResponse.status()).toBe(200);
        console.log("Configuration restored.");

        // 3. Trigger manual sync to generate feed.xml on server
        console.log("Triggering manual feed sync...");
        const syncResponse = await request.post(`${APP_URL}/api/feed-sync`, {
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': APP_PASSWORD
            }
        });
        const syncStatus = syncResponse.status();
        const syncBody = await syncResponse.text();
        console.log(`Manual feed sync status: ${syncStatus}`);
        
        if (syncStatus === 200) {
            const syncResult = JSON.parse(syncBody);
            console.log("Manual sync output:", syncResult.output);
        } else {
            console.error("Manual sync failed:", syncBody);
        }
        await expect(syncStatus).toBe(200);

        // 4. Load the app and login
        await page.goto(`${APP_URL}/login.html`);
        await page.fill('input[type="password"]', APP_PASSWORD);
        await page.click('button[type="submit"]');
        
        // Wait for redirect to index
        await page.waitForURL(APP_URL + '/', { timeout: 10000 });
        
        console.log("Waiting for loading screen to disappear...");
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        
        // 5. Verify items are loaded in UI
        console.log("Checking for items in UI...");
        const items = page.locator('.item');
        await expect(items.first()).toBeVisible({ timeout: 30000 });
        
        const itemCount = await items.count();
        console.log(`Visible items in deck: ${itemCount}`);
        expect(itemCount).toBeGreaterThan(0);

        // 6. Verify content
        const firstTitle = await page.locator('.item .itemtitle div').first().innerText();
        console.log(`First item title: ${firstTitle}`);
        expect(firstTitle.length).toBeGreaterThan(0);
    });
});
