import { test, expect } from '@playwright/test';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test('Firestore Connection Proof', async ({ page }) => {
    page.on('console', msg => console.log('Browser:', msg.text()));
    page.on('pageerror', err => console.error('Browser Error:', err.message));

    console.log('Proof: Navigating to login...');
    await page.goto(`${APP_URL}/login.html`);
    await page.waitForSelector('#login-form[data-auth-ready="true"]');

    console.log('Proof: Logging in with bypass...');
    await page.fill('#email', 'test@example.com');
    await page.fill('#pw', 'devtestpwd');
    await page.click('#login-btn');

    // Wait for a terminal auth status
    console.log('Proof: Waiting for auth status update...');
    await page.waitForFunction(() => {
        const btn = document.querySelector('#login-btn');
        return btn && btn.dataset.authStatus && btn.dataset.authStatus.startsWith('success');
    }, { timeout: 20000 }).catch(e => console.error('Timed out waiting for success status. Status is:', page.locator('#login-btn').getAttribute('data-auth-status')));

    await page.waitForURL(`${APP_URL}/`, { timeout: 30000 });

    console.log('Proof: Opening settings to trigger a Firestore write...');
    await page.click('#settings-button');
    await page.click('#configure-custom-css-btn');
    
    const uniqueValue = `/* Firestore Test ${Date.now()} */`;
    console.log(`Proof: Attempting to save unique CSS value: ${uniqueValue}`);
    
    await page.fill('#css-settings-block textarea', uniqueValue);
    
    // Listen for the network response from the worker
    const savePromise = page.waitForResponse(response => 
        response.url().includes('/api/profile') && 
        response.request().method() === 'POST' &&
        response.status() === 200
    );

    await page.click('#save-css-btn');
    const response = await savePromise;
    console.log('Proof: Received 200 OK from Worker for user-state save.');

    const resultBody = await response.json();
    console.log('Proof: Worker Response Body:', JSON.stringify(resultBody));

    console.log('Proof: Reloading page to verify persistence from Firestore...');
    await page.reload();
    await page.waitForSelector('#header');
    
    // Open settings again
    await page.click('#settings-button');
    await page.click('#configure-custom-css-btn');
    
    const savedValue = await page.inputValue('#css-settings-block textarea');
    console.log('Proof: Value retrieved after reload:', savedValue);

    expect(savedValue).toContain(uniqueValue);
    console.log('SUCCESS: Firestore connection and persistence verified!');
});
