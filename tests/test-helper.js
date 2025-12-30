import { expect } from '@playwright/test';

export async function login(page, appUrl) {
    const APP_PASSWORD = "devtestpwd";
    
    console.log('Navigating to login page...');
    await page.goto(`${appUrl}/login.html`, { timeout: 60000 });
    
    // Wait for login script to be ready
    await page.waitForSelector('#login-form[data-auth-ready="true"]', { timeout: 30000 });

    // Attempt login via UI bypass
    await page.fill('#email', 'test@example.com');
    await page.fill('#pw', APP_PASSWORD);
    await page.click('#login-btn');

    // Wait for redirect to main app URL
    await page.waitForURL(appUrl, { timeout: 60000 });
    
    // Ensure Alpine is ready
    await page.waitForFunction(() => window.Alpine !== undefined, { timeout: 30000 });
}

export async function ensureFeedsSeeded(page) {
    const feedsCount = await page.evaluate(async () => {
        const app = window.Alpine.$data(document.getElementById('app'));
        if (!app) return 0;
        let attempts = 0;
        while (typeof app.rssFeedsInput !== 'string' && attempts < 20) {
            if (app.loadRssFeeds) await app.loadRssFeeds();
            if (typeof app.rssFeedsInput === 'string') break;
            await new Promise(r => setTimeout(r, 200));
            attempts++;
        }
        return (app.rssFeedsInput || "").trim().length;
    });

    if (feedsCount === 0) {
        console.log('Seeding feeds via Alpine...');
        await page.evaluate(async () => {
            const app = window.Alpine.$data(document.getElementById('app'));
            app.rssFeedsInput = 'https://news.ycombinator.com/rss';
            await app.saveRssFeeds();
        });
        // Wait for sync
        await page.waitForTimeout(5000);
    }
}