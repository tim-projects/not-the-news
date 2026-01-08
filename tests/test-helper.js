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
    const state = await page.evaluate(async () => {
        const app = window.Alpine.$data(document.getElementById('app'));
        if (!app) return { seeded: false, count: 0 };
        
        let attempts = 0;
        while ((!app.rssFeedsInput || app.rssFeedsInput.trim().length === 0) && attempts < 10) {
            if (app.loadRssFeeds) await app.loadRssFeeds();
            if (app.rssFeedsInput && app.rssFeedsInput.trim().length > 0) break;
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }
        
        return { 
            seeded: (app.rssFeedsInput || "").trim().length > 0,
            count: app.entries?.length || 0,
            deckCount: app.deck?.length || 0
        };
    });

    if (!state.seeded) {
        console.log('Seeding feeds via Alpine...');
        await page.evaluate(async () => {
            const app = window.Alpine.$data(document.getElementById('app'));
            app.rssFeedsInput = 'https://news.ycombinator.com/rss';
            await app.saveRssFeeds();
        });
        
        // Wait for sync and content - up to 30s
        console.log('Waiting for content to populate...');
        await page.waitForFunction(() => {
            const app = window.Alpine.$data(document.getElementById('app'));
            return app.entries?.length > 0 && app.deck?.length > 0;
        }, { timeout: 30000 }).catch(() => console.warn('Timed out waiting for content population.'));
    } else {
        console.log(`Feeds already seeded. Entries: ${state.count}, Deck: ${state.deckCount}`);
        if (state.count === 0 || state.deckCount === 0) {
             console.log('Feeds seeded but empty. Forcing full sync...');
             await page.evaluate(async () => {
                 const app = window.Alpine.$data(document.getElementById('app'));
                 await app.loadRssFeeds(); // This triggers sync in current implementation
             });
             await page.waitForTimeout(5000);
        }
    }

    // FINAL STATE LOG
    await page.evaluate(() => {
        const app = window.Alpine.$data(document.getElementById('app'));
        console.log(`[ensureFeedsSeeded] FINAL STATE: entries=${app.entries?.length}, deck=${app.deck?.length}, loading=${app.loading}`);
    });
}