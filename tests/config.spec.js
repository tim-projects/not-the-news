import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

test.describe('Configuration Buttons', () => {
  const APP_URL = process.env.APP_URL || 'http://localhost:5173';

  test.beforeEach(async ({ page }) => {
    await login(page, APP_URL);
    await ensureFeedsSeeded(page);
  });

  test('should click configure buttons and log debug messages', async ({ page }) => {
    let rssFeedsContentLogPromise = new Promise(resolve => {
      page.on('console', msg => {
        if (msg.text().includes('[DEBUG] Content for rssFeeds input:')) {
          resolve(msg.text());
        }
      });
    });

    let keywordBlacklistContentLogPromise = new Promise(resolve => {
      page.on('console', msg => {
        if (msg.text().includes('[DEBUG] Content for keywordBlacklist input:')) {
          resolve(msg.text());
        }
      });
    });

    // Click the settings button to open the settings panel
    console.log('Clicking "Settings" button...');
    await page.click('#settings-button');
    // Wait for the settings modal to appear
    console.log('Waiting for modal content...');
    await page.waitForSelector('.modal-content', { state: 'visible', timeout: 30000 });
    console.log('Settings modal is visible.');

    // Wait for the RSS Feeds configure button to be visible and clickable
    console.log('Waiting for #configure-rss-feeds-btn...');
    await page.waitForSelector('#configure-rss-feeds-btn', { state: 'visible', timeout: 30000 });
    console.log('Clicking #configure-rss-feeds-btn...');
    await page.click('#configure-rss-feeds-btn');
    
    console.log('Waiting for #back-button...');
    await page.waitForSelector('#back-button', { state: 'visible', timeout: 30000 });
    // Wait for the RSS Feeds textarea to be visible and its value to be populated
    console.log('Waiting for textarea value...');
    await page.waitForFunction(() => {
      const textarea = document.querySelector('#rss-settings-block textarea');
      return textarea && textarea.value.trim().length > 0;
    }, { timeout: 30000 });
    console.log('Textarea value found.');


    // Click the "Back" button to return to the main settings view
    console.log('Clicking "Back" button...');
    await page.click('#back-button');
    console.log('Waiting for #main-settings...');
    await page.waitForSelector('#main-settings', { state: 'visible', timeout: 30000 });

    // Wait for the Keyword Blacklist configure button to be visible and clickable
    console.log('Waiting for #configure-keyword-blacklist-btn...');
    await page.waitForSelector('#configure-keyword-blacklist-btn', { state: 'visible', timeout: 30000 });
    console.log('Clicking #configure-keyword-blacklist-btn...');
    await page.click('#configure-keyword-blacklist-btn');
    
    // Wait for the Keyword Blacklist textarea to be visible and its value to be populated
    console.log('Waiting for keywords textarea value...');
    await page.waitForFunction(() => {
      const textarea = document.querySelector('#keywords-settings-block textarea');
      return textarea && (textarea.value !== undefined);
    }, { timeout: 30000 });
    console.log('Keywords textarea found.');


    // Wait for the specific console messages to appear
    console.log('Awaiting console log promises...');
    const rssFeedsLog = await rssFeedsContentLogPromise;
    console.log('RSS feeds log promise resolved.');
    const keywordBlacklistLog = await keywordBlacklistContentLogPromise;
    console.log('Keyword blacklist log promise resolved.');

    // Assert that the debug messages appeared
    expect(rssFeedsLog).toContain('[DEBUG] Content for rssFeeds input:');
    expect(keywordBlacklistLog).toContain('[DEBUG] Content for keywordBlacklist input:');
  });
});
