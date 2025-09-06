import { test, expect } from '@playwright/test';

test.describe('Configuration Buttons', () => {
  const APP_URL = process.env.APP_URL || 'https://news.loveopenly.net';
  const APP_PASSWORD = process.env.APP_PASSWORD;

  test.beforeEach(async ({ page }) => {
    // Navigate to the login page
    await page.waitForTimeout(5000);
    await page.goto(`${APP_URL}/login.html`);

    // Fill the password and click login
    await page.fill('#pw', APP_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for navigation to the main page
    await page.waitForURL(APP_URL);
  });

  test('should click configure buttons and log debug messages', async ({ page }) => {
    let rssFeedsContentLogPromise = new Promise(resolve => {
      page.on('console', msg => {
        if (msg.text().includes('[DEBUG] Content for rssFeeds input:')) {
          resolve(msg.text());
        }
        console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
      });
    });

    let keywordBlacklistContentLogPromise = new Promise(resolve => {
      page.on('console', msg => {
        if (msg.text().includes('[DEBUG] Content for keywordBlacklist input:')) {
          resolve(msg.text());
        }
        console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
      });
    });

    // Click the settings button to open the settings panel
    console.log('Clicking "Settings" button...');
    await page.click('#settings-button');
    // Wait for the settings modal to appear
    await page.waitForSelector('.modal-content', { state: 'visible' });
    console.log('Settings modal is visible.');

    // Wait for the RSS Feeds configure button to be visible and clickable
    await page.waitForSelector('#configure-rss-feeds-btn', { state: 'visible' });
    // Click the "Configure RSS Feeds" button
    console.log('Clicking "Configure RSS Feeds" button...');
    await page.click('#configure-rss-feeds-btn');
    console.log('Clicked "Configure RSS Feeds" button.');
    // Wait for the RSS Feeds textarea to be visible and its value to be populated
    await page.waitForFunction(() => {
      const textarea = document.querySelector('#rss-settings-block textarea');
      return textarea && textarea.value.length > 0;
    }, { timeout: 30000 }); // Increased timeout for robustness


    // Click the "Back" button to return to the main settings view
    console.log('Clicking "Back" button...');
    await page.click('#back-button');
    // Wait for the main settings view to be visible again
    await page.waitForSelector('#main-settings', { state: 'visible' });
    console.log('Returned to main settings view.');

    // Wait for the Keyword Blacklist configure button to be visible and clickable
    await page.waitForSelector('#configure-keyword-blacklist-btn', { state: 'visible' });
    // Click the "Configure Keyword Blacklist" button
    console.log('Clicking "Configure Keyword Blacklist" button...');
    await page.click('#configure-keyword-blacklist-btn');
    console.log('Clicked "Configure Keyword Blacklist" button.');
    // Wait for the Keyword Blacklist textarea to be visible and its value to be populated
    await page.waitForFunction(() => {
      const textarea = document.querySelector('#keywords-settings-block textarea');
      return textarea && textarea.value.length > 0;
    }, { timeout: 30000 }); // Increased timeout for robustness


    // Wait for the specific console messages to appear
    const rssFeedsLog = await rssFeedsContentLogPromise;
    const keywordBlacklistLog = await keywordBlacklistContentLogPromise;

    // Assert that the debug messages appeared
    expect(rssFeedsLog).toContain('[DEBUG] Content for rssFeeds input:');
    expect(keywordBlacklistLog).toContain('[DEBUG] Content for keywordBlacklist input:');
  });
});