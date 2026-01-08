import { expect } from '@playwright/test';

export async function login(page, appUrl) {
    const APP_PASSWORD = "devtestpwd";
    
    console.log('Navigating to login page...');
    await page.goto(`${appUrl}/login.html`, { timeout: 60000 });
    
    // Wait for script to attach listeners
    await page.waitForSelector('#login-form[data-auth-ready="true"]', { timeout: 15000 });

    // Attempt login via UI bypass
    await page.fill('#email', 'test@example.com');
    await page.fill('#pw', APP_PASSWORD);
    await page.click('#login-btn');
    
    // Wait for redirect to home
    await page.waitForURL(`${appUrl}/`, { timeout: 15000 });
    
    // Ensure Alpine is ready
    await page.waitForFunction(() => window.Alpine !== undefined, { timeout: 30000 });
}

export async function ensureFeedsSeeded(page) {
    console.log('Checking if feeds are seeded...');
    const feedsCount = await page.evaluate(async () => {
        const app = window.Alpine.$data(document.getElementById('app'));
        if (!app) {
            console.log('[ensureFeedsSeeded] Alpine app not found');
            return 0;
        }
        let attempts = 0;
        while (typeof app.rssFeedsInput !== 'string' && attempts < 20) {
            console.log(`[ensureFeedsSeeded] Waiting for rssFeedsInput, attempt ${attempts}...`);
            if (app.loadRssFeeds) await app.loadRssFeeds();
            if (typeof app.rssFeedsInput === 'string') break;
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }
        console.log(`[ensureFeedsSeeded] current rssFeedsInput: "${app.rssFeedsInput}"`);
        return (app.rssFeedsInput || "").trim().length;
    });

    if (feedsCount === 0) {
        console.log('Seeding feeds via Alpine...');
        await page.evaluate(async () => {
            const app = window.Alpine.$data(document.getElementById('app'));
            app.rssFeedsInput = 'https://news.ycombinator.com/rss';
            console.log('[ensureFeedsSeeded] Saving RSS feeds...');
            await app.saveRssFeeds();
            console.log('[ensureFeedsSeeded] RSS feeds saved.');
        });
        // Wait longer for sync and deck generation
        console.log('Waiting 10s for initial sync and deck generation...');
        await page.waitForTimeout(10000);
    } else {
        console.log(`Feeds already seeded (length: ${feedsCount}).`);
    }
}