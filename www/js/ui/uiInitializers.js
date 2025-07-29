// www/js/ui/uiInitializers.js

import {
    loadSimpleState,
    saveSimpleState,
    addPendingOperation,
    getBufferedChangesCount,
    processPendingOperations,
    pullUserState,
    performFullSync,
    isOnline
} from '../data/database.js';

import { getSyncToggle, getSyncText, getImagesToggle, getImagesText, getThemeToggle, getThemeText, getShuffleCountDisplay, getMainSettingsBlock, getRssSettingsBlock, getKeywordsSettingsBlock, getBackButton, getRssFeedsTextarea, getKeywordsBlacklistTextarea, getConfigureRssButton, getConfigureKeywordsButton, getSaveKeywordsButton, getSaveRssButton } from './uiElements.js';
import { loadShuffleState, saveShuffleState } from '../helpers/userStateUtils.js';
import { loadConfigFile, saveConfigFile } from '../helpers/apiUtils.js';
import { createStatusBarMessage, attachScrollToTopHandler } from './uiUpdaters.js';

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

    app[dbKey] = (await loadSimpleState(dbKey)).value;
    if (app[dbKey] === undefined || app[dbKey] === null) {
        app[dbKey] = true;
    }
    toggleEl.checked = app[dbKey];
    textEl.textContent = app[dbKey] ? 'yes' : 'no';

    toggleEl.addEventListener('change', async () => {
        app[dbKey] = toggleEl.checked;
        await saveSimpleState(dbKey, app[dbKey]);

        await addPendingOperation({
            type: 'simpleUpdate',
            key: dbKey,
            value: app[dbKey]
        });
        if (await isOnline()) {
            try {
                await processPendingOperations();
            } catch (syncErr) {
                console.error("Failed to immediately sync toggle change, operation remains buffered:", syncErr);
            }
        }

        textEl.textContent = app[dbKey] ? 'yes' : 'no';
        onToggleCb(app[dbKey]);
    });
}

export async function initSyncToggle(app) {
    await setupBooleanToggle(app, getSyncToggle, getSyncText, 'syncEnabled', async (enabled) => {
        if (enabled) {
            console.log("Sync enabled, triggering full sync from initSyncToggle.");
            await performFullSync(app);
        }
    });
}

export async function initImagesToggle(app) {
    await setupBooleanToggle(app, getImagesToggle, getImagesText, 'imagesEnabled');
}

export async function initTheme(app) {
    const htmlEl = document.documentElement;
    const toggle = getThemeToggle();
    const text = getThemeText();

    if (!toggle || !text) return;

    let storedThemeResult = await loadSimpleState('theme');
    let storedTheme = storedThemeResult.value;

    let activeThemeIsDark;

    if (storedTheme === 'light') {
        activeThemeIsDark = false;
    } else {
        activeThemeIsDark = true;
    }

    htmlEl.classList.add(activeThemeIsDark ? 'dark' : 'light');
    toggle.checked = activeThemeIsDark;
    text.textContent = activeThemeIsDark ? 'dark' : 'light';

    toggle.addEventListener('change', async () => {
        const newTheme = toggle.checked ? 'dark' : 'light';
        htmlEl.classList.toggle('dark', toggle.checked);
        htmlEl.classList.toggle('light', !toggle.checked);

        await saveSimpleState('theme', newTheme);

        await addPendingOperation({
            type: 'simpleUpdate',
            key: 'theme',
            value: newTheme
        });
        if (await isOnline()) {
            try {
                await processPendingOperations();
            } catch (syncErr) {
                console.error("Failed to immediately sync theme change, operation remains buffered:", syncErr);
            }
        }

        text.textContent = newTheme;
    });
}

export async function initScrollPosition(app) {
    window.requestAnimationFrame(async () => {
        const lastViewedItemIdResult = await loadSimpleState('lastViewedItemId');
        const lastViewedItemId = lastViewedItemIdResult.value;

        // Proceed only if a lastViewedItemId exists and app.entries has been populated
        if (lastViewedItemId && app.entries && app.entries.length > 0) {
            // For efficient lookup of hidden items
            const hiddenGuids = new Set(app.hidden.map(item => item.id));

            // Check if the target item exists in the current feed entries
            const targetEntry = app.entries.find(entry => entry.guid === lastViewedItemId);

            // If the item exists and is NOT hidden, attempt to scroll to it
            if (targetEntry && !hiddenGuids.has(lastViewedItemId)) {
                const targetEl = document.querySelector(`.entry[data-guid="${lastViewedItemId}"]`);
                if (targetEl) {
                    // Scroll the found element into view, aligning its top with the viewport top
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    console.log(`Scrolled to last viewed item: ${lastViewedItemId}`);
                } else {
                    console.log(`Target element with GUID ${lastViewedItemId} not found in DOM.`);
                }
            } else {
                if (!targetEntry) {
                    console.log(`Last viewed item GUID ${lastViewedItemId} not found in app.entries.`);
                } else { // targetEntry exists but is hidden
                    console.log(`Last viewed item GUID ${lastViewedItemId} is hidden. Not scrolling.`);
                }
            }
        } else {
            console.log("No lastViewedItemId found or app.entries is empty. Not attempting scroll to a specific item.");
        }
    });
}

export async function initShuffleCount(app) {
    // Load the current state of all shuffle-related values
    let { shuffleCount: currentShuffleCount, lastShuffleResetDate: lastResetDate, itemsClearedCount: currentItemsClearedCount } = await loadShuffleState();

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize 'today' to midnight for comparison

    let newShuffleCount = currentShuffleCount;
    let newItemsClearedCount = currentItemsClearedCount;

    // Determine if a daily reset is needed
    const isNewDay = !lastResetDate || new Date(lastResetDate).toDateString() !== today.toDateString();

    if (isNewDay) {
        newShuffleCount = 2; // Reset shuffleCount to 2 for a new day
        newItemsClearedCount = 0; // Reset itemsClearedCount to 0 for a new day
        // Log for debugging to confirm daily reset
        console.log(`[initShuffleCount] New day detected (${today.toDateString()}). Resetting shuffleCount to ${newShuffleCount} and itemsClearedCount to ${newItemsClearedCount}.`);
        await saveShuffleState(newShuffleCount, today, newItemsClearedCount); // Save the reset state
    } else {
        // If it's the same day, ensure shuffleCount is at least 2 if it's currently 0 (e.g., first load of the app ever)
        // This catches the case where default 0 was loaded before daily reset logic runs for the very first time.
        if (newShuffleCount === 0) {
             newShuffleCount = 2;
             await saveShuffleState(newShuffleCount, today, newItemsClearedCount); // Save to persist this initial adjustment
             console.log(`[initShuffleCount] Initial load on same day, adjusted shuffleCount to ${newShuffleCount}.`);
        }
    }

    // Update the Alpine.js app property
    app.shuffleCount = newShuffleCount;

    // Update the UI display element
    const shuffleDisplay = getShuffleCountDisplay();
    if (shuffleDisplay) {
        shuffleDisplay.textContent = app.shuffleCount;
        console.log(`[initShuffleCount] Display updated to: ${app.shuffleCount}`);
    }
}

export async function initConfigPanelListeners(app) {
    const rssBtn = getConfigureRssButton();
    rssBtn?.addEventListener('click', async () => {
        const data = await loadSimpleState('rssFeeds');
        app.rssFeedsInput = data.content || "";
        app.modalView = 'rss';
    });

    const keywordsBtn = getConfigureKeywordsButton();
    keywordsBtn?.addEventListener('click', async () => {
        const data = await loadSimpleState('keywordBlacklist');
        // If data.value is an array, join it with newlines. If it's a string, use it directly.
        // If it's null/undefined, default to an empty string.
        let blacklistContent = "";
        if (data.value) {
            if (Array.isArray(data.value)) {
                blacklistContent = data.value.filter(Boolean).sort().join("\n");
            } else if (typeof data.value === 'string') {
                blacklistContent = data.value.split(/\r?\n/).filter(Boolean).sort().join("\n");
            }
        }
        app.keywordBlacklistInput = blacklistContent;
        app.modalView = 'keywords';
    });

    const backBtn = getBackButton();
    backBtn?.addEventListener('click', () => { app.modalView = 'main'; });

    const saveKeywordsBtn = getSaveKeywordsButton();
    saveKeywordsBtn?.addEventListener("click", async () => {
        const kwArea = getKeywordsBlacklistTextarea();
        const content = kwArea?.value || app.keywordBlacklistInput;
        // Convert the string content to an array of keywords, filtering out empty strings
        const keywordsArray = content.split(/\r?\n/).map(keyword => keyword.trim()).filter(Boolean);
        try {
            await saveSimpleState('keywordBlacklist', keywordsArray);
            app.keywordBlacklistInput = keywordsArray.sort().join("\n"); // Update app state with sorted array
            createStatusBarMessage("Keywords saved.", 'success');
        } catch (err) {
                console.error(err);
                createStatusBarMessage("Error saving keywords!", 'error');
            }
    });

    const saveRssBtn = getSaveRssButton();
    saveRssBtn?.addEventListener("click", async () => {
        const rssArea = getRssFeedsTextarea();
        const content = rssArea?.value || app.rssFeedsInput;
        try {
            await saveSimpleState('rssFeeds', content);
            app.rssFeedsInput = content;
            createStatusBarMessage("RSS feeds saved.", 'success');
        } catch (err) {
                console.error(err);
                createStatusBarMessage("Error saving RSS feeds!", 'error');
            }
    });
}
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installButton = document.getElementById('install-button');
    if (installButton) {
        installButton.style.display = 'block';
        installButton.addEventListener('click', () => {
            deferredPrompt.prompt();
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