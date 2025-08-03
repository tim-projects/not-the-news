// @filepath: src/js/ui/uiInitializers.js

// Refactored JS: concise, modern, functional, same output.

import {
    loadSimpleState,
    saveSimpleState,
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
    getBackButton,
    getRssFeedsTextarea,
    getKeywordsBlacklistTextarea,
    getConfigureRssButton,
    getConfigureKeywordsButton,
    getSaveKeywordsButton,
    getSaveRssButton
} from './uiElements.js';

import {
    createStatusBarMessage
} from './uiUpdaters.js';

/**
 * Dispatches a custom event to signal that core application data is loaded.
 */
function dispatchAppDataReady() {
    document.dispatchEvent(new CustomEvent('app-data-ready', { bubbles: true }));
    console.log("Dispatched 'app-data-ready' event.");
}

/**
 * Initializes listeners for data readiness to update UI elements.
 * @param {object} app The Alpine.js app state object.
 * @param {Function} updateCountsCb The callback function to update all counts.
 */
export function initDataReadyListener(app, updateCountsCb) {
    document.addEventListener('app-data-ready', () => {
        if (typeof updateCountsCb === 'function') {
            console.log("App data is ready, updating counts now.");
            updateCountsCb();
        } else {
            console.error("updateCountsCb function not provided to initDataReadyListener.");
        }
    });
}

/**
 * Sets up a boolean toggle UI element and syncs its state with IndexedDB.
 * @param {object} app The Alpine.js app state object.
 * @param {Function} getToggleEl Function returning the toggle DOM element.
 * @param {Function} getTextEl Function returning the text display DOM element.
 * @param {string} dbKey The key to use in the 'userSettings' object store.
 * @param {Function} [onToggleCb=() => {}] Optional callback when the toggle changes.
 */
export async function setupBooleanToggle(app, getToggleEl, getTextEl, dbKey, onToggleCb = () => {}) {
    const [toggleEl, textEl] = [getToggleEl(), getTextEl()];
    if (!toggleEl || !textEl) return;

    const { value } = await loadSimpleState(dbKey);
    app[dbKey] = value;
    toggleEl.checked = app[dbKey];
    textEl.textContent = app[dbKey] ? 'yes' : 'no';

    toggleEl.addEventListener('change', async () => {
        const newValue = toggleEl.checked;
        app[dbKey] = newValue;
        await saveSimpleState(dbKey, newValue);
        textEl.textContent = newValue ? 'yes' : 'no';
        onToggleCb(newValue);
    });
}

export async function initSyncToggle(app) {
    await setupBooleanToggle(app, getSyncToggle, getSyncText, 'syncEnabled', async (enabled) => {
        if (enabled) {
            console.log("Sync enabled, triggering full sync.");
            await performFullSync(app);
            if (!app.currentDeckGuids?.length) {
                console.log("Deck is empty after sync. Rebuilding from all available items.");
                if (app.entries?.length) {
                    app.currentDeckGuids = app.entries.map(item => item.guid);
                    await saveSimpleState('currentDeckGuids', app.currentDeckGuids);
                    console.log(`Rebuilt deck with ${app.currentDeckGuids.length} items.`);
                } else {
                    console.warn("Cannot rebuild deck, app.entries is empty.");
                }
            }
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

    const { value: storedTheme } = await loadSimpleState('theme');
    const isDark = storedTheme === 'dark';

    htmlEl.classList.toggle('dark', isDark);
    htmlEl.classList.toggle('light', !isDark);
    toggle.checked = isDark;
    text.textContent = isDark ? 'dark' : 'light';

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
        const { value: lastViewedItemId } = await loadSimpleState('lastViewedItemId');
        const { value: lastViewedItemOffset } = await loadSimpleState('lastViewedItemOffset');

        if (!lastViewedItemId || !app.entries?.length || !app.hidden) {
            console.log("Not attempting scroll to a specific item. Insufficient data.");
            return;
        }

        const hiddenGuids = new Set(app.hidden.map(item => item.guid));
        const targetEntry = app.entries.find(entry => entry.guid === lastViewedItemId);

        if (!targetEntry) {
            console.log(`Last viewed item GUID ${lastViewedItemId} not found in app.entries.`);
            return;
        }
        if (hiddenGuids.has(lastViewedItemId)) {
            console.log(`Last viewed item GUID ${lastViewedItemId} is hidden. Not scrolling.`);
            return;
        }

        const targetEl = document.querySelector(`.entry[data-guid="${lastViewedItemId}"]`);
        if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (typeof lastViewedItemOffset === 'number' && lastViewedItemOffset > 0) {
                window.scrollTo({ top: window.scrollY + lastViewedItemOffset, behavior: 'smooth' });
                console.log(`Scrolled to last viewed item: ${lastViewedItemId} with offset: ${lastViewedItemOffset}`);
            } else {
                console.log(`Scrolled to last viewed item: ${lastViewedItemId}`);
            }
        } else {
            console.log(`Target element with GUID ${lastViewedItemId} not found in DOM.`);
        }
    });
}

/**
 * A reusable helper to set up listeners for a textarea-based config panel.
 * @param {string} key The state key for the configuration.
 * @param {Function} getConfigButton A function that returns the button to open the panel.
 * @param {Function} getTextarea A function that returns the textarea element.
 * @param {Function} getSaveButton A function that returns the save button.
 * @param {object} app The Alpine.js app state object.
 */
async function setupTextareaPanel(key, getConfigButton, getTextarea, getSaveButton, app) {
    const configBtn = getConfigButton();
    const saveBtn = getSaveButton();
    const textarea = getTextarea();

    configBtn?.addEventListener('click', async () => {
        const { value } = await loadSimpleState(key);
        const content = Array.isArray(value) ? value.filter(Boolean).sort().join("\n") : (value || "");
        app[`${key}Input`] = content;
        app.modalView = key;
    });

    saveBtn?.addEventListener("click", async () => {
        const content = textarea?.value ?? app[`${key}Input`];
        const keywordsArray = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        try {
            await saveSimpleState(key, keywordsArray);
            app[`${key}Input`] = keywordsArray.sort().join("\n");
            createStatusBarMessage(`${key} saved.`, 'success');
        } catch (err) {
            console.error(err);
            createStatusBarMessage(`Error saving ${key}!`, 'error');
        }
    });
}

export async function initConfigPanelListeners(app) {
    const backBtn = getBackButton();
    backBtn?.addEventListener('click', () => {
        app.modalView = 'main';
    });

    await setupTextareaPanel('rssFeeds', getConfigureRssButton, getRssFeedsTextarea, getSaveRssButton, app);
    await setupTextareaPanel('keywordBlacklist', getConfigureKeywordsButton, getKeywordsBlacklistTextarea, getSaveKeywordsButton, app);
}

// The PWA logic is standard and does not require refactoring.
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