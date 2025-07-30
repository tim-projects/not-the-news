// www/js/ui/uiInitializers.js

import {
    loadSimpleState,
    saveSimpleState,
    addPendingOperation, // This is exported from dbSyncOperations via database.js
    getBufferedChangesCount,
    processPendingOperations, // This is exported from dbSyncOperations via database.js
    pullUserState, // This is exported from dbSyncOperations via database.js
    performFullSync, // This is exported from dbSyncOperations via database.js
    isOnline // This is exported from dbCore via database.js
} from '../data/database.js'; // Consolidated import from the barrel file

import { getSyncToggle, getSyncText, getImagesToggle, getImagesText, getThemeToggle, getThemeText, getShuffleCountDisplay, getMainSettingsBlock, getRssSettingsBlock, getKeywordsSettingsBlock, getBackButton, getRssFeedsTextarea, getKeywordsBlacklistTextarea, getConfigureRssButton, getConfigureKeywordsButton, getSaveKeywordsButton, getSaveRssButton } from './uiElements.js';
import { loadShuffleState, saveShuffleState } from '../helpers/userStateUtils.js'; // These are correct for shuffle state (simple values)
import { loadConfigFile, saveConfigFile } from '../helpers/apiUtils.js'; // Assuming this interacts with API, not IndexedDB directly
import { createStatusBarMessage, attachScrollToTopHandler } from './uiUpdaters.js';

/**
 * Generic function to set up a boolean toggle UI element and sync its state with IndexedDB.
 * @param {object} app - The Alpine.js app state object.
 * @param {Function} getToggleEl - Function returning the toggle DOM element.
 * @param {Function} getTextEl - Function returning the text display DOM element.
 * @param {string} dbKey - The key to use in the 'userSettings' object store for this setting.
 * @param {Function} [onToggleCb] - Optional callback function to execute when the toggle changes.
 */
export async function setupBooleanToggle(app, getToggleEl, getTextEl, dbKey, onToggleCb = () => {}) {
    const toggleEl = getToggleEl();
    const textEl = getTextEl();

    if (!toggleEl || !textEl) return;

    // Load initial state from IndexedDB
    const loadedState = await loadSimpleState(dbKey);
    app[dbKey] = loadedState.value;

    // Provide a default if the value is undefined or null (e.g., first run)
    if (app[dbKey] === undefined || app[dbKey] === null) {
        // This default should ideally come from USER_STATE_DEFS in dbUserState.js
        // For boolean toggles, 'true' is a common safe default.
        // It's safer to read the default from USER_STATE_DEFS directly if possible,
        // but for now, hardcoding 'true' here works if not explicitly set elsewhere.
        app[dbKey] = true; // Fallback default
        // Immediately save the default to ensure it's persisted and queued for sync
        await saveSimpleState(dbKey, app[dbKey]);
    }

    // Set UI based on loaded/default state
    toggleEl.checked = app[dbKey];
    textEl.textContent = app[dbKey] ? 'yes' : 'no';

    toggleEl.addEventListener('change', async () => {
        app[dbKey] = toggleEl.checked;
        await saveSimpleState(dbKey, app[dbKey]); // saveSimpleState already handles queuing for sync
        textEl.textContent = app[dbKey] ? 'yes' : 'no';
        onToggleCb(app[dbKey]);
    });
}

export async function initSyncToggle(app) {
    await setupBooleanToggle(app, getSyncToggle, getSyncText, 'syncEnabled', async (enabled) => {
        if (enabled) {
            console.log("Sync enabled, triggering full sync from initSyncToggle.");
            // Assuming performFullSync itself handles queuing operations and processing them
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

    // Determine the active theme based on stored value or default to 'dark' if none
    if (storedTheme === 'light') {
        activeThemeIsDark = false;
    } else { // 'dark', null, or undefined
        activeThemeIsDark = true;
    }

    htmlEl.classList.add(activeThemeIsDark ? 'dark' : 'light');
    toggle.checked = activeThemeIsDark;
    text.textContent = activeThemeIsDark ? 'dark' : 'light';

    toggle.addEventListener('change', async () => {
        const newTheme = toggle.checked ? 'dark' : 'light';
        htmlEl.classList.toggle('dark', toggle.checked);
        htmlEl.classList.toggle('light', !toggle.checked);

        await saveSimpleState('theme', newTheme); // saveSimpleState already handles queuing for sync
        text.textContent = newTheme;
    });
}

export async function initScrollPosition(app) {
    window.requestAnimationFrame(async () => {
        const lastViewedItemIdResult = await loadSimpleState('lastViewedItemId');
        const lastViewedItemId = lastViewedItemIdResult.value; // This should be a GUID

        // Ensure app.entries and app.hidden are populated before proceeding
        // app.entries is populated by processFeedData in app.js.
        // app.hidden is populated by loadHiddenItems in app.js and updated by toggleHidden in userStateUtils.js.
        if (lastViewedItemId && app.entries && app.entries.length > 0 && app.hidden) {
            // app.hidden now stores objects like { guid: '...', hiddenAt: '...' }
            // So, create a Set of GUIDs for efficient lookup.
            const hiddenGuids = new Set(app.hidden.map(item => item.guid)); // ***CHANGED: item.id to item.guid***

            // Check if the target item exists in the current feed entries
            // app.entries items have a 'guid' property.
            const targetEntry = app.entries.find(entry => entry.guid === lastViewedItemId);

            // If the item exists and is NOT hidden, attempt to scroll to it
            if (targetEntry && !hiddenGuids.has(lastViewedItemId)) {
                // Select element using data-guid attribute, which should match the RSS item's GUID
                const targetEl = document.querySelector(`.entry[data-guid="${lastViewedItemId}"]`);
                if (targetEl) {
                    // Scroll the found element into view, aligning its top with the viewport top
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

                    // Additionally, load and apply scroll offset if available
                    const lastViewedItemOffsetResult = await loadSimpleState('lastViewedItemOffset');
                    const lastViewedItemOffset = lastViewedItemOffsetResult.value;
                    if (typeof lastViewedItemOffset === 'number' && lastViewedItemOffset > 0) {
                        window.scrollTo({
                            top: window.scrollY + lastViewedItemOffset,
                            behavior: 'smooth'
                        });
                        console.log(`Scrolled to last viewed item: ${lastViewedItemId} with offset: ${lastViewedItemOffset}`);
                    } else {
                        console.log(`Scrolled to last viewed item: ${lastViewedItemId}`);
                    }
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
            console.log("No lastViewedItemId found, app.entries is empty, or app.hidden is not loaded. Not attempting scroll to a specific item.");
        }
    });
}

export async function initConfigPanelListeners(app) {
    const rssBtn = getConfigureRssButton();
    rssBtn?.addEventListener('click', async () => {
        // loadSimpleState returns an object { value, lastModified }
        const data = await loadSimpleState('rssFeeds');
        // 'rssFeeds' simple state stores the content as a string directly.
        app.rssFeedsInput = data.value || ""; // ***CHANGED: data.content to data.value***
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
                // If it was stored as a single string (e.g., with newlines), split and sort
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
            await saveSimpleState('keywordBlacklist', keywordsArray); // saveSimpleState handles queuing
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
            await saveSimpleState('rssFeeds', content); // saveSimpleState handles queuing
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