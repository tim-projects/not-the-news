import { test, expect } from '@playwright/test';
import { login, ensureFeedsSeeded } from './test-helper';

test.describe('Text to Speech (TTS)', () => {
  const APP_URL = 'http://localhost:5173';

  test.beforeEach(async ({ page }) => {
    await login(page, APP_URL);
    await ensureFeedsSeeded(page);
    await expect(page.locator('#loading-screen')).not.toBeVisible({ timeout: 60000 });
    await page.waitForSelector('.entry', { state: 'visible', timeout: 60000 });
  });

  test('should trigger speech synthesis on play button click', async ({ page }) => {
    // Redefine the monitor properly
    await page.evaluate(() => {
        window._speechCalls = [];
        // @ts-ignore
        const originalSpeak = window.speechSynthesis.speak;
        window.speechSynthesis.speak = (utterance) => {
            // @ts-ignore
            window._speechCalls.push(utterance.text);
            setTimeout(() => {
                if (utterance.onend) utterance.onend(new Event('end'));
            }, 50);
        };
    });

    // Find first play button and click it
    const items = page.locator('.entry:not(.help-panel-item)');
    const playButton = items.first().locator('.play-button');
    await playButton.click();

    // Check if the UI reflects speaking state
    await expect(playButton).toHaveClass(/speaking/);

    const textCalled = await page.evaluate(() => window._speechCalls[0]);
    expect(textCalled).toBeTruthy();
    expect(textCalled.length).toBeGreaterThan(10);
    
    // Wait for it to finish speaking (simulated)
    await expect(playButton).not.toHaveClass(/speaking/, { timeout: 10000 });
  });

  test('check available voices', async ({ page }) => {
    const voices = await page.evaluate(() => {
        return window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang }));
    });
    console.log('Available voices:', voices);
  });
});