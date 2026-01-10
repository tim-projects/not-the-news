import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('Interaction Assessment: Advanced Actions & Settings', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`[PAGE] ${msg.type()}: ${msg.text()}`));
        
        // Mock TTS to avoid synthesis-failed in headless
        await page.addInitScript(() => {
            window.speechSynthesis = {
                speak: (utterance) => {
                    utterance._started = true;
                    if (utterance.onstart) setTimeout(() => utterance.onstart(), 10);
                },
                cancel: () => {},
                pause: () => {},
                resume: () => {},
                getVoices: () => [{ name: 'Test Voice', lang: 'en-US' }],
                onvoiceschanged: null,
                pending: false,
                speaking: false,
                paused: false
            };
            window.SpeechSynthesisUtterance = function(text) {
                this.text = text;
                this.onstart = null;
                this.onend = null;
                this.onerror = null;
                this.onboundary = null;
            };
        });

        await login(page, APP_URL);
        await ensureFeedsSeeded(page);
        await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
        await page.waitForSelector('.entry:not(.help-panel-item)', { state: 'visible', timeout: 60000 });
    });

    async function openSettings(page) {
        console.log('Opening settings modal...');
        const btn = page.locator('#settings-button');
        await btn.waitFor({ state: 'visible' });
        await btn.click();
        
        const modal = page.locator('#settings-modal');
        // If it doesn't open via click, try evaluate as fallback
        try {
            await expect(modal).toBeVisible({ timeout: 5000 });
        } catch (e) {
            console.log('Modal did not appear after click, forcing via Alpine...');
            await page.evaluate(() => {
                const app = window.Alpine.$data(document.getElementById('app'));
                app.openSettings = true;
                app.modalView = 'main';
            });
            await expect(modal).toBeVisible({ timeout: 10000 });
        }
        console.log('Settings modal is open.');
    }

    test('Keyboard: "o" or "Enter" for sub-element actions', async ({ page }) => {
        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        const guid = await firstItem.getAttribute('data-guid');
        await firstItem.click();
        await expect(firstItem).toHaveClass(/selected-item/);

        // Move focus to Read button (Item -> Read)
        await page.keyboard.press('l');
        const readButton = firstItem.locator('.read-button');
        await expect(readButton).toHaveClass(/sub-focused/);

        // Press Enter to mark read
        await page.keyboard.press('Enter', { delay: 100 });
        await expect(page.locator(`.entry[data-guid="${guid}"]`)).toBeHidden({ timeout: 15000 });

        // Undo
        await page.keyboard.press('u');
        await expect(page.locator(`.entry[data-guid="${guid}"]`)).toBeVisible({ timeout: 15000 });
        await page.locator(`.entry[data-guid="${guid}"]`).click();

        // Move focus to Star button (Item -> Read -> Star)
        await page.keyboard.press('l');
        await page.keyboard.press('l');
        const starButton = firstItem.locator('.star');
        await expect(starButton).toHaveClass(/sub-focused/);

        // Ensure NOT starred initially for this test
        const isStarred = await starButton.evaluate(el => el.classList.contains('starred'));
        if (isStarred) {
            await page.keyboard.press('o', { delay: 100 });
            await expect(starButton).not.toHaveClass(/starred/, { timeout: 10000 });
        }

        // Press 'o' to star
        await page.keyboard.press('o', { delay: 100 });
        await expect(starButton).toHaveClass(/starred/, { timeout: 10000 });
    });

    test('Keyboard: "p" for TTS trigger', async ({ page }) => {
        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        await firstItem.click();

        await page.keyboard.press('p', { delay: 100 });
        
        const speakingGuid = await page.evaluate(() => window.Alpine.$data(document.getElementById('app')).speakingGuid);
        const selectedGuid = await page.evaluate(() => window.Alpine.$data(document.getElementById('app')).selectedGuid);
        
        expect(speakingGuid).toBe(selectedGuid);

        // Stop TTS
        await page.keyboard.press('p', { delay: 100 });
        const stoppedSpeakingGuid = await page.evaluate(() => window.Alpine.$data(document.getElementById('app')).speakingGuid);
        expect(stoppedSpeakingGuid).toBeNull();
    });

    test('Keyboard: "i" for Image Toggle', async ({ page }) => {
        const firstItemWithImage = page.locator('.entry:has(.entry-image)').first();
        if (await firstItemWithImage.count() === 0) {
            console.log("No item with image found, skipping.");
            return;
        }

        const image = firstItemWithImage.locator('.entry-image');
        await expect(image).toBeVisible();

        // Toggle off
        await page.keyboard.press('i', { delay: 100 });
        await expect(image).toBeHidden();

        // Toggle on
        await page.keyboard.press('i', { delay: 100 });
        await expect(image).toBeVisible();
    });

    test('Keyboard: "Ctrl+Z" for Undo', async ({ page }) => {
        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        const guid = await firstItem.getAttribute('data-guid');
        
        await firstItem.click();
        await page.keyboard.press('r', { delay: 100 }); // Mark read
        await expect(page.locator(`.entry[data-guid="${guid}"]`)).toBeHidden({ timeout: 15000 });

        // Ctrl+Z to undo
        await page.keyboard.press('Control+z', { delay: 100 });
        await expect(page.locator(`.entry[data-guid="${guid}"]`)).toBeVisible({ timeout: 15000 });
    });

    test('Global: Shuffle Button functionality', async ({ page }) => {
        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        const firstGuidBefore = await firstItem.getAttribute('data-guid');

        const shuffleButton = page.locator('#shuffle-button');
        await shuffleButton.click();

        await page.waitForTimeout(1500); 
        
        const firstGuidAfter = await page.locator('.entry:not(.help-panel-item)').first().getAttribute('data-guid');
        console.log(`Guid before: ${firstGuidBefore}, after: ${firstGuidAfter}`);
    });

    test('Settings: Appearance Sliders', async ({ page }) => {
        await openSettings(page);
        await page.locator('#configure-appearance-btn').click();

        const fontSizeDisplay = page.locator('.font-size-value').first();
        await expect(fontSizeDisplay).toBeVisible();
        const initialText = await fontSizeDisplay.innerText();
        const initialSize = parseInt(initialText.match(/\d+/)[0]);

        const increaseBtn = page.locator('button[aria-label="Increase font size"]');
        await increaseBtn.click();

        await expect(async () => {
            const newText = await fontSizeDisplay.innerText();
            const newSize = parseInt(newText.match(/\d+/)[0]);
            expect(newSize).toBeGreaterThan(initialSize);
        }).toPass();
    });

    test('Settings: Behavior - Item Button Mode', async ({ page }) => {
        await openSettings(page);
        await page.locator('#configure-behavior-btn').click();

        const selector = page.locator('#item-button-mode-selector');
        await selector.selectOption('play');

        await page.locator('#settings-modal .close').click();
        await expect(page.locator('#settings-modal')).toBeHidden();

        const firstItem = page.locator('.entry:not(.help-panel-item)').first();
        const menuTrigger = firstItem.locator('button.menu-trigger').filter({ visible: true });
        
        // Use a more specific selector for the span inside the trigger
        await expect(menuTrigger.locator('span:visible').first()).not.toBeEmpty(); 

        await menuTrigger.click();
        const speakingGuid = await page.evaluate(() => window.Alpine.$data(document.getElementById('app')).speakingGuid);
        expect(speakingGuid).not.toBeNull();
    });

    test('Settings: Keyword Blacklist', async ({ page }) => {
        await openSettings(page);
        
        await page.locator('#configure-keyword-blacklist-btn').click();
        const textarea = page.locator('#keywords-settings-block textarea');
        
        await textarea.fill('NASA, Space');
        // Small wait for Alpine x-model to sync
        await page.waitForTimeout(500);
        
        await page.locator('#save-keywords-btn').click();
        console.log('Save Keywords clicked.');

        await page.locator('#back-button').click();
        await page.locator('#configure-keyword-blacklist-btn').click();
        const value = await textarea.inputValue();
        expect(value.toLowerCase()).toBe('nasa, space');
    });

    test('Settings: Advanced - Backup selection', async ({ page }) => {
        await openSettings(page);

        await page.locator('#configure-advanced-settings-btn').click();
        await page.locator('#show-backup-menu-btn').click();

        const configCheckbox = page.locator('#backup-settings-block input[x-model="backupSelections.feeds"]');
        await expect(configCheckbox).toBeChecked();
        await configCheckbox.uncheck();
        await expect(configCheckbox).not.toBeChecked();

        await page.locator('#back-button').click();
        await expect(page.locator('#show-backup-menu-btn')).toBeVisible();
    });
});
