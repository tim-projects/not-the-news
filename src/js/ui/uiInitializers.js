// @filepath: src/js/ui/uiInitializers.js

// Refactored JS: concise, modern, functional, same output.

import {
    loadSimpleState,
    saveSimpleState,
    performFullSync,
    saveArrayState
} from '../data/database.js';

import {
    loadUserState,
    saveUserState
} from '../helpers/apiUtils.js';

import {
    getSyncToggle,
    getImagesToggle,
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
 * Sets up a boolean toggle UI element to complement Alpine's x-model.
 * x-model handles updating the 'app' state. This function adds the persistence logic.
 * @param {object} app The Alpine.js app state object.
 * @param {Function} getToggleEl Function returning the toggle DOM element.
 * @param {string} dbKey The key to use in the 'userSettings' object store.
 * @param {Function} [onToggleCb=() => {}] Optional callback when the toggle changes.
 */
async function setupBooleanToggle(app, getToggleEl, dbKey, onToggleCb = () => {}) {
    const toggleEl = getToggleEl();
    if (!toggleEl) return;

    // This listener performs actions that x-model doesn't,
    // like saving to the database and running side-effect callbacks.
    toggleEl.addEventListener('change', async () => {
        // We read the new value from the app's state, which x-model has just updated.
        const newValue = app[dbKey];
        await saveSimpleState(dbKey, newValue);
        onToggleCb(newValue);
    });
}

/**
 * Initializes the synchronization toggle.
 * @param {object} app The Alpine.js app state object.
 */
export async function initSyncToggle(app) {
    await setupBooleanToggle(app, getSyncToggle, 'syncEnabled', async (enabled) => {
        app.updateSyncStatusMessage(); // Update the status message on toggle
        if (enabled) {
            console.log("Sync enabled, triggering full sync.");
            await performFullSync(app);
            if (!app.currentDeckGuids?.length && app.entries?.length) {
                console.log("Deck is empty after sync. Rebuilding from all available items.");
                const now = new Date().toISOString();
                const readGuids = new Set(app.read.map(h => h.guid));
                const shuffledOutGuids = new Set(app.shuffledOutItems.map(s => s.guid));
                app.currentDeckGuids = app.entries
                    .filter(item => !readGuids.has(item.guid) && !shuffledOutGuids.has(item.guid))
                    .map(item => ({
                        guid: item.guid,
                        addedAt: now
                    }));
                await saveArrayState('currentDeckGuids', app.currentDeckGuids);
                console.log(`Rebuilt deck with ${app.currentDeckGuids.length} items.`);
            }
            dispatchAppDataReady();
        }
    });
}

export async function initImagesToggle(app) {
    await setupBooleanToggle(app, getImagesToggle, 'imagesEnabled');
}

/**
 * REFINED: Initializes the theme, handling all UI logic internally.
 * It applies the theme on load and manages all subsequent user interactions.
 * This removes all theme-related DOM manipulation from main.js.
 * @param {object} app The Alpine.js app state object.
 */
export function initTheme(app) {
    const htmlEl = document.documentElement;
    const toggle = getThemeToggle();
    const text = getThemeText();
    if (!toggle || !text) return;

    // Helper function to apply all theme UI changes in one place.
    const applyThemeUI = (theme) => {
        htmlEl.classList.remove('light', 'dark');
        htmlEl.classList.add(theme);
        toggle.checked = (theme === 'dark');
        text.textContent = theme;
    };

    // 1. Apply the initial theme on load based on the app's state.
    applyThemeUI(app.theme);

    // 2. Handle all subsequent user interactions.
    toggle.addEventListener('change', async () => {
        const newTheme = toggle.checked ? 'dark' : 'light';
        app.theme = newTheme; // Update the central state
        applyThemeUI(newTheme); // Update all UI elements
        
        // Persist the change
        await saveSimpleState('theme', newTheme);
    });
}

export async function initScrollPosition(app) {
    // This function is now called inside a $nextTick in main.js,
    // which ensures the DOM is ready. The requestAnimationFrame provides
    // an extra layer of certainty that rendering is complete.
    window.requestAnimationFrame(async () => {
        const { value: lastViewedItemId } = await loadSimpleState('lastViewedItemId');
        const { value: lastViewedItemOffset } = await loadSimpleState('lastViewedItemOffset');

        // Exit if there's no saved position or the deck is empty.
        if (!lastViewedItemId || !app.deck?.length) return;

        // REFINED LOGIC: Check if the item to scroll to is actually in the current deck.
        // This is the most reliable check, as it represents what's currently on screen.
        // It implicitly handles items that are read or have been shuffled out.
        const itemIsInDeck = app.deck.some(item => item.guid === lastViewedItemId);

        if (itemIsInDeck) {
            const targetEl = document.querySelector(`.entry[data-guid="${lastViewedItemId}"]`);
            if (targetEl) {
                // Use 'auto' for instant scroll on load.
                targetEl.scrollIntoView({ behavior: 'auto', block: 'start' });
                // Restore the fine-tuned vertical offset if it exists.
                if (typeof lastViewedItemOffset === 'number' && lastViewedItemOffset > 0) {
                    window.scrollTo({ top: window.scrollY + lastViewedItemOffset, behavior: 'auto' });
                }
            }
        }
    });
}

/**
 * REFINED: Now loads data when the configure button is clicked, not from a watcher in main.js.
 */
async function setupTextareaPanel(key, viewName, getConfigButton, getTextarea, getSaveButton, app) {
    const configBtn = getConfigButton();
    const saveBtn = getSaveButton();
    //console.log(`[DEBUG] setupTextareaPanel for key: ${key}. configBtn:`, configBtn, `saveBtn:`, saveBtn); // Added debug log
    if (!configBtn || !saveBtn) return;

    configBtn.addEventListener('click', async () => {
        // Data is now loaded here, when the user intends to configure.
        let value;
        if (key === 'rssFeeds' || key === 'keywordBlacklist') {
            try {
                const response = await loadUserState(key);
                //console.log(`[DEBUG] loadUserState response for ${key}:`, response); // Added debug log
                value = response.value;
            } catch (error) {
                console.error(`Error loading ${key} from server:`, error);
                value = (key === 'rssFeeds') ? '' : []; // Default to empty string or array on error
            }
        } else {
            const result = await loadSimpleState(key);
            value = result.value;
        }

        //console.log(`[DEBUG] Value before setting app input for ${key}:`, value); // Added debug log
        let content;
        if (key === 'rssFeeds' && value && typeof value === 'object') {
            let allRssUrls = [];
            for (const category in value) {
                if (typeof value[category] === 'object') {
                    for (const subcategory in value[category]) {
                        if (Array.isArray(value[category][subcategory])) {
                            value[category][subcategory].forEach(feed => {
                                if (feed && feed.url) {
                                    allRssUrls.push(feed.url);
                                }
                            });
                        }
                    }
                }
            }
            content = allRssUrls.join('\n');
        } else {
            content = Array.isArray(value) ? value.filter(Boolean).sort().join("\n") : (value || "");
        }
        //console.log(`[DEBUG] Content for ${key} input:`, content); // Added debug log
        //console.log(`[DEBUG] Final content for ${key} input before assignment:`, content); // Added debug log
        app[`${key}Input`] = content;
        app.modalView = key; // Switch to the correct view
    });

    saveBtn.addEventListener("click", async () => {
        const textarea = getTextarea();
        const content = textarea?.value ?? app[`${key}Input`];
        const dataToSave = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

        try {
            if (key === 'rssFeeds' || key === 'keywordBlacklist') {
                await saveUserState(key, dataToSave);
            } else {
                await saveSimpleState(key, dataToSave);
            }
            app[`${key}Input`] = dataToSave.sort().join("\n");
            createStatusBarMessage(`${key} saved.`, 'success');
        } catch (err) {
            console.error(err);
            createStatusBarMessage(`Error saving ${key}!`, 'error');
        }
    });
}

export async function initConfigPanelListeners(app) {
    //console.log("[DEBUG] initConfigPanelListeners called."); // Added debug log
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
