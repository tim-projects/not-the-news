// www/js/ui/uiInitializers.js

import { dbPromise, loadStateValue, saveStateValue, bufferedChanges } from '../data/database.js';
import { getSyncToggle, getSyncText, getImagesToggle, getImagesText, getThemeToggle, getThemeText, getShuffleCountDisplay, getMainSettingsBlock, getRssSettingsBlock, getKeywordsSettingsBlock, getBackButton, getRssFeedsTextarea, getKeywordsBlacklistTextarea, getConfigureRssButton, getConfigureKeywordsButton, getSaveKeywordsButton, getSaveRssButton } from './uiElements.js';
import { loadShuffleState, saveShuffleState } from '../helpers/userStateUtils.js';
import { loadConfigFile, saveConfigFile } from '../helpers/apiUtils.js';
// --- UPDATED IMPORT: Use createStatusBarMessage instead of createAndShowSaveMessage ---
import { createStatusBarMessage, attachScrollToTopHandler } from './uiUpdaters.js'; // Assuming attachScrollToTopHandler is also available
// --- END UPDATED IMPORT ---

/**
 * Generic function to set up a boolean toggle UI element and sync its state with IndexedDB.
 * @param {object} app - The Alpine.js app state object.
 * @param {Function} getToggleEl - Function returning the toggle DOM element.
 * @param {Function} getTextEl - Function returning the text display DOM element.
 * @param {string} dbKey - The key to use in the 'userState' object store for this setting.
 * @param {Function} [onToggleCb] - Optional callback function to execute when the toggle changes.
 */
export async function setupBooleanToggle(app, getToggleEl, getTextEl, dbKey, onToggleCb = () => {}) {
    const toggleEl = getToggleEl();
    const textEl = getTextEl();

    if (!toggleEl || !textEl) return;

    const db = await dbPromise;
    app[dbKey] = await loadStateValue(db, dbKey, true); // Default to true if not found
    toggleEl.checked = app[dbKey];
    textEl.textContent = app[dbKey] ? 'yes' : 'no';

    toggleEl.addEventListener('change', async () => {
        app[dbKey] = toggleEl.checked;
        await saveStateValue(db, dbKey, app[dbKey]);
        textEl.textContent = app[dbKey] ? 'yes' : 'no';
        bufferedChanges.push({ key: 'settings', value: { [dbKey]: app[dbKey] } });
        onToggleCb(app[dbKey]);
    });
}

export async function initSyncToggle(app) {
    await setupBooleanToggle(app, getSyncToggle, getSyncText, 'syncEnabled', (enabled) => {
        if (enabled && app.initApp) app.initApp(); // Assuming app.initApp triggers a sync
    });
}

export async function initImagesToggle(app) {
    await setupBooleanToggle(app, getImagesToggle, getImagesText, 'imagesEnabled');
}

export async function initTheme(app) {
    const htmlEl = document.documentElement;
    const toggle = getThemeToggle(); // Assumed to get the theme switch element
    const text = getThemeText();     // Assumed to get an element to display theme name

    if (!toggle || !text) return;

    const db = await dbPromise; // Assumed to be an IndexedDB promise
    let storedTheme = await loadStateValue(db, 'theme', null); // Loads theme from DB, defaults to null

    let activeThemeIsDark;

    // --- CRITICAL CHANGE HERE ---
    if (storedTheme === 'light') {
        // User explicitly chose light mode
        activeThemeIsDark = false;
    } else {
        // If storedTheme is 'dark' OR null (no saved preference), default to dark.
        activeThemeIsDark = true;
    }
    // --- END CRITICAL CHANGE ---

    htmlEl.classList.add(activeThemeIsDark ? 'dark' : 'light');
    toggle.checked = activeThemeIsDark;
    text.textContent = activeThemeIsDark ? 'dark' : 'light';

    toggle.addEventListener('change', async () => {
        const newTheme = toggle.checked ? 'dark' : 'light';
        htmlEl.classList.toggle('dark', toggle.checked);
        htmlEl.classList.toggle('light', !toggle.checked);

        await saveStateValue(db, 'theme', newTheme);
        text.textContent = newTheme;
        // Assuming bufferedChanges is defined elsewhere
        // bufferedChanges.push({ key: 'settings', value: { theme: newTheme } });
    });
}

export async function initScrollPosition(app) {
    const db = await dbPromise;
    const savedScrollY = await loadStateValue(db, 'feedScrollY', '0');

    if (!savedScrollY || savedScrollY === '0') return;

    window.requestAnimationFrame(async () => {
        const savedLink = await loadStateValue(db, 'feedVisibleLink', '');
        if (savedLink) {
            const targetEl = document.querySelector(`.entry[data-link="${savedLink}"]`);
            if (targetEl) {
                targetEl.scrollIntoView({ block: 'start' });
                return;
            }
        }
        const yPos = Number(savedScrollY) || 0;
        if (yPos) window.scrollTo({ top: yPos });
    });
}

export async function initShuffleCount(app) {
    const db = await dbPromise;
    const { shuffleCount: count, lastShuffleResetDate: lastReset } = await loadShuffleState(db);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let shouldReset = false;
    if (!lastReset || lastReset.toDateString() !== today.toDateString()) {
        shouldReset = true;
    }

    if (shouldReset) {
        app.shuffleCount = 2;
        await saveShuffleState(db, app.shuffleCount, today);
    } else {
        app.shuffleCount = count;
    }

    const shuffleDisplay = getShuffleCountDisplay();
    if (shuffleDisplay) shuffleDisplay.textContent = app.shuffleCount;
}

export async function initConfigPanelListeners(app) {
    const rssBtn = getConfigureRssButton();
    rssBtn?.addEventListener('click', async () => {
        const data = await loadConfigFile('feeds.txt');
        app.rssFeedsInput = data.content || "";
        app.modalView = 'rss';
    });

    const keywordsBtn = getConfigureKeywordsButton();
    keywordsBtn?.addEventListener('click', async () => {
        const data = await loadConfigFile('filter_keywords.txt');
        app.keywordBlacklistInput = (data.content || "").split(/\r?\n/).filter(Boolean).sort().join("\n");
        app.modalView = 'keywords';
    });

    const backBtn = getBackButton();
    backBtn?.addEventListener('click', () => { app.modalView = 'main'; });

    const saveKeywordsBtn = getSaveKeywordsButton();
    saveKeywordsBtn?.addEventListener("click", async () => {
        const kwArea = getKeywordsBlacklistTextarea();
        const content = kwArea?.value || app.keywordBlacklistInput;
        try {
            await saveConfigFile('filter_keywords.txt', content);
            app.keywordBlacklistInput = content;
            // --- UPDATED CALL: Use createStatusBarMessage ---
            createStatusBarMessage("Keywords saved.", 'success'); // Pass message and type
            // --- END UPDATED CALL ---
        } catch (err) {
            console.error(err);
            // --- UPDATED CALL: Use createStatusBarMessage for error ---
            createStatusBarMessage("Error saving keywords!", 'error'); // Pass message and type
            // --- END UPDATED CALL ---
        }
    });

    const saveRssBtn = getSaveRssButton();
    saveRssBtn?.addEventListener("click", async () => {
        const rssArea = getRssFeedsTextarea();
        const content = rssArea?.value || app.rssFeedsInput;
        try {
            await saveConfigFile('feeds.txt', content);
            app.rssFeedsInput = content;
            // --- UPDATED CALL: Use createStatusBarMessage ---
            createStatusBarMessage("RSS feeds saved.", 'success'); // Pass message and type
            // --- END UPDATED CALL ---
        } catch (err) {
            console.error(err);
            // --- UPDATED CALL: Use createStatusBarMessage for error ---
            createStatusBarMessage("Error saving RSS feeds!", 'error'); // Pass message and type
            // --- END UPDATED CALL ---
        }
    });
}
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // Prevent default prompt
  deferredPrompt = e; // Save the event
  // Show a custom install button (e.g., in your UI)
  const installButton = document.getElementById('install-button');
  if (installButton) { // Check if the button exists before trying to display/add listener
    installButton.style.display = 'block';
    installButton.addEventListener('click', () => {
      deferredPrompt.prompt(); // Show the install prompt
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('PWA installed');
        } else {
          console.log('PWA installation dismissed');
        }
        deferredPrompt = null;
      });
    });
  }
});