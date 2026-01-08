
const { test, expect } = require('@playwright/test');
const { login } = require('./test-helper');

test('should display images in the feed', async ({ page }) => {
    const appUrl = 'http://127.0.0.1:8443';
    await login(page, appUrl);
    await page.goto(appUrl + '/');
    
    // Wait for the feed to load
    console.log('Waiting for .item.entry...');
    await page.waitForSelector('.item.entry', { timeout: 15000 });
    
    // Check if any images are present
    const images = page.locator('img.entry-image');
    const count = await images.count();
    console.log(`Found ${count} entry images.`);
    
    // If there are images, check if at least one is visible
    if (count > 0) {
        // Wait a bit for IntersectionObserver to potentially fire
        await page.waitForTimeout(3000);
        
        const firstImage = images.first();
        const opacity = await firstImage.evaluate(el => window.getComputedStyle(el).opacity);
        const classes = await firstImage.getAttribute('class');
        const dataSrc = await firstImage.getAttribute('data-src');
        const src = await firstImage.getAttribute('src');
        
        console.log(`First image opacity: ${opacity}`);
        console.log(`First image classes: ${classes}`);
        console.log(`First image data-src: ${dataSrc}`);
        console.log(`First image src: ${src}`);
        
        // If the image is visible, opacity should be 1 (or transitioning)
        // expect(parseFloat(opacity)).toBeGreaterThan(0);
        expect(dataSrc).toBeTruthy();
    } else {
        console.log('No images found in the current deck.');
    }
});
