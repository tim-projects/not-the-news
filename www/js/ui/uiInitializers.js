// www/js/ui/uiInitializers.js

import {
    // db, // --- FIX: Changed from dbPromise to db --- // REMOVED
    loadSimpleState, // --- FIX: Changed from loadStateValue ---
    saveSimpleState, // --- FIX: Changed from saveStateValue ---
    addPendingOperation, // --- FIX: Add addPendingOperation for buffering ---
    getBufferedChangesCount, // --- FIX: Use the function to get count ---
    processPendingOperations,
    pullUserState, // Add pullUserState if it's used directly here
    performFullSync, // Add performFullSync if it's used directly here
    isOnline // --- NEW: Import isOnline ---
} from '../data/database.js';

import { getSyncToggle, getSyncText, getImagesToggle, getImagesText, getThemeToggle, getThemeText, getShuffleCountDisplay, getMainSettingsBlock, getRssSettingsBlock, getKeywordsSettingsBlock, getBackButton, getRssFeedsTextarea, getKeywordsBlacklistTextarea, getConfigureRssButton, getConfigureKeywordsButton, getSaveKeywordsButton, getSaveRssButton } from './uiElements.js';
import { loadShuffleState, saveShuffleState } from '../helpers/userStateUtils.js';
import { loadConfigFile, saveConfigFile } from '../helpers/apiUtils.js';
// --- UPDATED IMPORT: Use createStatusBarMessage instead of createAndShowSaveMessage ---
import { createStatusBarMessage, attachScrollToTopHandler } from './uiUpdaters.js'; // Assuming attachScrollToTopHandler is also available
// --- END UPDATED IMPORT ---

/**
 * Generic function to set up a boolean toggle UI element and sync its state with IndexedDB.
 * @param {object} app - The Alpine.js app state object.
 * @param {IDBDatabase} db - The IndexedDB database instance. // --- NEW: db parameter ---
 * @param {Function} getToggleEl - Function returning the toggle DOM element.
 * @param {Function} getTextEl - Function returning the text display DOM element.
 * @param {string} dbKey - The key to use in the 'userState' object store for this setting.
 * @param {Function} [onToggleCb] - Optional callback function to execute when the toggle changes.
 */
export async function setupBooleanToggle(app, db, getToggleEl, getTextEl, dbKey, onToggleCb = () => {}) { // --- NEW: db parameter ---
    const toggleEl = getToggleEl();
    const textEl = getTextEl();

    if (!toggleEl || !textEl) return;

    // --- FIX: Use 'db' directly and loadSimpleState ---
    app[dbKey] = (await loadSimpleState(db, dbKey)).value; // Default to 'true' usually handled by USER_STATE_DEFS default
    if (app[dbKey] === undefined || app[dbKey] === null) {
        // Fallback for initial load if USER_STATE_DEFS default isn't picked up or if it's a new key
        app[dbKey] = true; // Or appropriate default for your boolean setting
    }
    toggleEl.checked = app[dbKey];
    textEl.textContent = app[dbKey] ? 'yes' : 'no';

    toggleEl.addEventListener('change', async () => {
        app[dbKey] = toggleEl.checked;
        await saveSimpleState(db, dbKey, app[dbKey]); // --- FIX: Use saveSimpleState ---

        // --- FIX: Buffer the change using addPendingOperation ---
        await addPendingOperation(db, {
            type: 'simpleUpdate',
            key: dbKey,
            value: app[dbKey]
        });
        // Attempt immediate sync for user-initiated changes
        if (await isOnline()) { // --- NEW: Use isOnline() ---
            try {
                await processPendingOperations(db);
            } catch (syncErr) {
                console.error("Failed to immediately sync toggle change, operation remains buffered:", syncErr);
            }
        }
        // --- END FIX ---

        textEl.textContent = app[dbKey] ? 'yes' : 'no';
        onToggleCb(app[dbKey]);
    });
}

export async function initSyncToggle(app, db) { // --- NEW: db parameter ---
    await setupBooleanToggle(app, db, getSyncToggle, getSyncText, 'syncEnabled', async (enabled) => { // Added async // --- NEW: Pass db ---
        if (enabled) {
            console.log("Sync enabled, triggering full sync from initSyncToggle.");
            // Ensure db is ready, though it should be by this point
            if (db) {
                await performFullSync(app, db); // Full sync includes user state and feed // --- NEW: Pass db ---
            }
        }
    });
}

export async function initImagesToggle(app, db) { // --- NEW: db parameter ---
    await setupBooleanToggle(app, db, getImagesToggle, getImagesText, 'imagesEnabled'); // --- NEW: Pass db ---
}

export async function initTheme(app, db) { // --- NEW: db parameter ---
    const htmlEl = document.documentElement;
    const toggle = getThemeToggle(); // Assumed to get the theme switch element
    const text = getThemeText();     // Assumed to get an element to display theme name

    if (!toggle || !text) return;

    // --- FIX: Use 'db' directly and loadSimpleState ---
    let storedThemeResult = await loadSimpleState(db, 'theme'); // Loads theme from DB, defaults to null for unset
    let storedTheme = storedThemeResult.value;

    let activeThemeIsDark;

    // --- CRITICAL CHANGE HERE ---
    if (storedTheme === 'light') {
        // User explicitly chose light mode
        activeThemeIsDark = false;
    } else {
        // If storedTheme is 'dark' OR null/undefined (no saved preference), default to dark.
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

        await saveSimpleState(db, 'theme', newTheme); // --- FIX: Use saveSimpleState ---
        
        // --- FIX: Buffer the change using addPendingOperation for theme ---
        await addPendingOperation(db, {
            type: 'simpleUpdate',
            key: 'theme',
            value: newTheme
        });
        // Attempt immediate sync for user-initiated changes
        if (await isOnline()) { // --- NEW: Use isOnline() ---
            try {
                await processPendingOperations(db);
            } catch (syncErr) {
                console.error("Failed to immediately sync theme change, operation remains buffered:", syncErr);
            }
        }
        // --- END FIX ---

        text.textContent = newTheme;
    });
}

export async function initScrollPosition(app, db) { // --- NEW: db parameter ---
    window.requestAnimationFrame(async () => {
        const lastViewedItemIdResult = await loadSimpleState(db, 'lastViewedItemId');
        const lastViewedItemId = lastViewedItemIdResult.value;

        const lastViewedItemOffsetResult = await loadSimpleState(db, 'lastViewedItemOffset');
        const lastViewedItemOffset = lastViewedItemOffsetResult.value;

        if (lastViewedItemId) {
            const targetEl = document.querySelector(`.entry[data-guid="${lastViewedItemId}"]`);
            if (targetEl) {
                targetEl.scrollIntoView();
                if (lastViewedItemOffset) {
                    window.scrollBy(0, lastViewedItemOffset);
                }
            }
        }
    });
}

export async function initShuffleCount(app, db) { // --- NEW: db parameter ---
    // db is already available from import
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