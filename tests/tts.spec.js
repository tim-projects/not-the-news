const { test, expect } = require('@playwright/test');

test.describe('Text to Speech (TTS)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8085');
    await page.waitForSelector('#loading-screen', { state: 'hidden' });
    await page.waitForSelector('.entry');
  });

  test('should trigger speech synthesis on play button click', async ({ page }) => {
    // Monitor window.speechSynthesis calls
    const speechCalls = await page.evaluate(() => {
      const calls = [];
      const originalSpeak = window.speechSynthesis.speak;
      window.speechSynthesis.speak = (utterance) => {
        calls.push(utterance.text);
        // We don't actually speak in the test environment to avoid hangs or missing hardware issues
        // But we simulate the 'end' event to let the UI state update
        setTimeout(() => {
          const event = new Event('end');
          utterance.dispatchEvent(event);
          if (utterance.onend) utterance.onend(event);
        }, 100);
      };
      return calls;
    });

    // Find first play button and click it
    const playButton = page.locator('.play-button').first();
    await playButton.click();

    // Check if the UI reflects speaking state
    await expect(playButton).toHaveClass(/speaking/);

    // Verify if speak was called with expected text (roughly)
    const callsCount = await page.evaluate(() => {
        // This is tricky because we need to access the closure above. 
        // Let's redefine the monitor in a more accessible way.
        return window._speechCalls ? window._speechCalls.length : 0;
    });

    // Re-doing the monitor properly
    await page.evaluate(() => {
        window._speechCalls = [];
        const originalSpeak = window.speechSynthesis.speak;
        window.speechSynthesis.speak = (utterance) => {
            window._speechCalls.push(utterance.text);
            setTimeout(() => {
                if (utterance.onend) utterance.onend(new Event('end'));
            }, 50);
        };
    });

    await playButton.click(); // Toggle off
    await playButton.click(); // Toggle on again

    const textCalled = await page.evaluate(() => window._speechCalls[0]);
    expect(textCalled).toBeTruthy();
    expect(textCalled.length).toBeGreaterThan(10);
    
    // Wait for it to finish speaking (simulated)
    await expect(playButton).not.toHaveClass(/speaking/);
  });

  test('check available voices', async ({ page }) => {
    const voices = await page.evaluate(() => {
        return window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang }));
    });
    console.log('Available voices:', voices);
    // Note: getVoices() can be empty until voiceschanged event fires
  });
});
