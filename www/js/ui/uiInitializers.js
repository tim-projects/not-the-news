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

        if (lastViewedItemId) {
            const targetEl = document.querySelector(`.entry[data-guid="${lastViewedItemId}"]`);
            if (targetEl) {
                targetEl.scrollIntoView();
            }
        }
    });
}

export async function initShuffleCount(app) {
    const { shuffleCount: count, lastShuffleResetDate: lastReset, itemsClearedCount: clearedCount } = await loadShuffleState(); // MODIFIED
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let newShuffleCount = count;
    let newItemsClearedCount = clearedCount;
    let shouldReset = false;

    // Check if lastReset is not today (or null/undefined)
    if (!lastReset || new Date(lastReset).toDateString() !== today.toDateString()) {
        shouldReset = true;
    }

    if (shouldReset) {
        newShuffleCount = 2; // Reset to 2 daily
        newItemsClearedCount = 0; // Reset cleared items count daily
        await saveShuffleState(newShuffleCount, today, newItemsClearedCount); // Save reset state
    } else {
        // If it's the same day, ensure initial load sets it correctly if it was somehow 0 but should be 2
        if (newShuffleCount === 0 && newItemsClearedCount === 0) {
             newShuffleCount = 2; // If just initialized and it's 0, set to 2.
             await saveShuffleState(newShuffleCount, today, newItemsClearedCount);
        }
    }

    app.shuffleCount = newShuffleCount; // Update Alpine state
    // app.itemsClearedCount = newItemsClearedCount; // Not strictly necessary to expose to Alpine, but good for debugging if desired

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
            await saveConfigFile('feeds.txt', content);
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