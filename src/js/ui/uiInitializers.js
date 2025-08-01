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

import {
    getSyncToggle,
    getSyncText,
    getImagesToggle,
    getImagesText,
    getThemeToggle,
    getThemeText,
    getShuffleCountDisplay,
    getMainSettingsBlock,
    getRssSettingsBlock,
    getKeywordsSettingsBlock,
    getBackButton,
    getRssFeedsTextarea,
    getKeywordsBlacklistTextarea,
    getConfigureRssButton, // Corrected: This function was missing from the import list
    getConfigureKeywordsButton,
    getSaveKeywordsButton,
    getSaveRssButton
} from './uiElements.js';

import {
    loadShuffleState,
    saveShuffleState
} from '../helpers/userStateUtils.js';

import {
    loadConfigFile,
    saveConfigFile
} from '../helpers/apiUtils.js';

import {
    createStatusBarMessage,
    attachScrollToTopHandler
} from './uiUpdaters.js';

/**
 * Dispatches a custom event to signal that the core application data has been
 * loaded and is ready for use by the UI.
 * This is crucial for fixing the race condition where UI elements
 * (like count displays) try to update before the data is available.
 */
function dispatchAppDataReady() {
    const event = new CustomEvent('app-data-ready', { bubbles: true });
    document.dispatchEvent(event);
    console.log("Dispatched 'app-data-ready' event.");
}

/**
 * Initializes listeners for data readiness. When the 'app-data-ready' event
 * is received, this function triggers the update for counts and other UI elements.
 * This should be called early in the app's initialization process.
 * @param {object} app - The Alpine.js app state object.
 * @param {Function} updateCountsCb - The callback function to update all counts.
 */
export function initDataReadyListener(app, updateCountsCb) {
    document.addEventListener('app-data-ready', () => {
        // Now that the data is confirmed to be loaded, we can safely
        // call the function that updates the counts.
        // The original log shows this function is likely in main.js, so we pass it as a callback.
        if (typeof updateCountsCb === 'function') {
            console.log("App data is ready, updating counts now.");
            updateCountsCb();
        } else {
            console.error("updateCountsCb function not provided to initDataReadyListener.");
        }
    });
}

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

    if (app[dbKey] === undefined || app[dbKey] === null) {
        // Fallback default, but this should ideally be handled by dbUserState.js
        app[dbKey] = true;
        await saveSimpleState(dbKey, app[dbKey]);
    }

    toggleEl.checked = app[dbKey];
    textEl.textContent = app[dbKey] ? 'yes' : 'no';

    toggleEl.addEventListener('change', async () => {
        app[dbKey] = toggleEl.checked;
        await saveSimpleState(dbKey, app[dbKey]);
        textEl.textContent = app[dbKey] ? 'yes' : 'no';
        onToggleCb(app[dbKey]);
    });
}

export async function initSyncToggle(app) {
    await setupBooleanToggle(app, getSyncToggle, getSyncText, 'syncEnabled', async (enabled) => {
        if (enabled) {
            console.log("Sync enabled, triggering full sync from initSyncToggle.");
            await performFullSync(app);
            // After a full sync, the data is updated, so we dispatch the event.
            dispatchAppDataReady();
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
        text.textContent = newTheme;
    });
}

export async function initScrollPosition(app) {
    window.requestAnimationFrame(async () => {
        const lastViewedItemIdResult = await loadSimpleState('lastViewedItemId');
        const lastViewedItemId = lastViewedItemIdResult.value;

        if (lastViewedItemId && app.entries && app.entries.length > 0 && app.hidden) {
            const hiddenGuids = new Set(app.hidden.map(item => item.guid));
            const targetEntry = app.entries.find(entry => entry.guid === lastViewedItemId);

            if (targetEntry && !hiddenGuids.has(lastViewedItemId)) {
                const targetEl = document.querySelector(`.entry[data-guid="${lastViewedItemId}"]`);
                if (targetEl) {
                    targetEl.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });

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
                } else {
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
        const data = await loadSimpleState('rssFeeds');
        app.rssFeedsInput = data.value || "";
        app.modalView = 'rss';
    });

    const keywordsBtn = getConfigureKeywordsButton();
    keywordsBtn?.addEventListener('click', async () => {
        const data = await loadSimpleState('keywordBlacklist');
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
    backBtn?.addEventListener('click', () => {
        app.modalView = 'main';
    });

    const saveKeywordsBtn = getSaveKeywordsButton();
    saveKeywordsBtn?.addEventListener("click", async () => {
        const kwArea = getKeywordsBlacklistTextarea();
        const content = kwArea?.value || app.keywordBlacklistInput;
        const keywordsArray = content.split(/\r?\n/).map(keyword => keyword.trim()).filter(Boolean);
        try {
            await saveSimpleState('keywordBlacklist', keywordsArray);
            app.keywordBlacklistInput = keywordsArray.sort().join("\n");
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

// Example of a main initialization function that would call our new event dispatcher
// This is a hypothetical function based on the log, as you didn't provide app.js.
// You would place dispatchAppDataReady() in your actual main initialization code
// after all data loading and processing is complete.
export async function initApp(app) {
    // Other setup...
    await performFullSync(app); // Assumed to load feed data, user settings, etc.
    // ... once data is loaded and processed, dispatch the event
    dispatchAppDataReady();
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
