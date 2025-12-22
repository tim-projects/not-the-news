// @filepath: src/js/ui/uiInitializers.ts

// Refactored JS: concise, modern, functional, same output.

import { AppState } from '../../types/app.ts';
import {
    loadSimpleState,
    saveSimpleState,
    performFullSync,
    saveArrayState
} from '../data/database.ts';
import {
    getSyncToggle,
    getImagesToggle,
    getOpenUrlsInNewTabToggle,
    getShadowsToggle,
    getThemeToggle,
    getThemeText
} from './uiElements.ts';

import {
    createStatusBarMessage
}
from './uiUpdaters.ts';

type GetToggleElementFunction = () => HTMLElement | null;
    
    const SETTING_LABELS: Record<string, string> = {
        syncEnabled: 'Auto-Sync',
        imagesEnabled: 'Images',
        openUrlsInNewTabEnabled: 'Open in New Tab',
        shadowsEnabled: 'Shadows'
    };
    
    /**
     * Sets up a boolean toggle UI element to complement Alpine's x-model.
     * x-model handles updating the 'app' state. This function adds the persistence logic.
     * @param {object} app The Alpine.js app state object.
     * @param {Function} getToggleEl Function returning the toggle DOM element.
     * @param {string} dbKey The key to use in the 'userSettings' object store.
     * @param {Function} [onToggleCb=() => {}] Optional callback when the toggle changes.
     */
    async function setupBooleanToggle(app: AppState, getToggleEl: GetToggleElementFunction, dbKey: string, onToggleCb: (newValue: boolean) => void = () => {}): Promise<void> {
        const toggleEl = getToggleEl();
        if (!toggleEl) return;
    
        // This listener performs actions that x-model doesn't,
        // like saving to the database and running side-effect callbacks.
        toggleEl.addEventListener('change', async () => {
            // We read the new value from the app's state, which x-model has just updated.
            const newValue = (app as any)[dbKey];
            await saveSimpleState(dbKey, newValue);
            
            const label = SETTING_LABELS[dbKey] || dbKey;
            createStatusBarMessage(app, `${label} ${newValue ? 'Enabled' : 'Disabled'}.`);
            
            onToggleCb(newValue);
        });
    }
    
    /**
     * Initializes the synchronization toggle.
     * @param {object} app The Alpine.js app state object.
     */
    export async function initSyncToggle(app: AppState): Promise<void> {
        await setupBooleanToggle(app, getSyncToggle, 'syncEnabled', async (enabled: boolean) => {
            app.updateSyncStatusMessage?.(); // Update the status message on toggle
            if (enabled) {
                createStatusBarMessage(app, 'Kicking off a new sync');
                console.log("Sync enabled, triggering full sync.");
                const syncSuccess = await performFullSync(app);
                if (syncSuccess) {
                    createStatusBarMessage(app, 'Sync complete!');
                } else {
                    createStatusBarMessage(app, 'Sync finished with some issues.');
                }
                if (!app.currentDeckGuids?.length && app.entries?.length) {
                    console.log("Deck is empty after sync. Rebuilding from all available items.");
                    const now = new Date().toISOString();
                    const readGuids = new Set(app.read?.map(h => h.guid));
                    const shuffledOutGuids = new Set(app.shuffledOutGuids?.map(s => s.guid)); // Changed from shuffledOutItems
                    app.currentDeckGuids = app.entries
                        .filter(item => !readGuids.has(item.guid) && !shuffledOutGuids.has(item.guid))
                        .map(item => ({
                            guid: item.guid,
                            addedAt: now
                        }));
                    await saveArrayState('currentDeckGuids', app.currentDeckGuids);
                    console.log(`Rebuilt deck with ${app.currentDeckGuids.length} items.`);
                }
            }
        });
    }
    
    export async function initImagesToggle(app: AppState): Promise<void> {
        await setupBooleanToggle(app, getImagesToggle, 'imagesEnabled');
    }

    export async function initShadowsToggle(app: AppState): Promise<void> {
        await setupBooleanToggle(app, getShadowsToggle, 'shadowsEnabled');
    }
    
    export async function initUrlsNewTabToggle(app: AppState): Promise<void> {
        await setupBooleanToggle(app, getOpenUrlsInNewTabToggle, 'openUrlsInNewTabEnabled');
    }
    
    /**
     * REFINED: Initializes the theme, handling all UI logic internally.
     * It applies the theme on load and manages all subsequent user interactions.
     * This removes all theme-related DOM manipulation from main.js.
     * @param {object} app The Alpine.js app state object.
     */
    export function initTheme(app: AppState): void {
        const htmlEl = document.documentElement;
        const toggle = getThemeToggle();
        const text = getThemeText();
        if (!toggle || !text) return;
    
        // Helper function to apply all theme UI changes in one place.
        const applyThemeUI = (theme: string) => {
            htmlEl.classList.remove('light', 'dark');
            htmlEl.classList.add(theme);
            (toggle as HTMLInputElement).checked = (theme === 'dark');
            text.textContent = theme;
        };
    
        // 1. Apply the initial theme on load based on the app's state.
        applyThemeUI(app.theme);
    
        // 2. Handle all subsequent user interactions.
        toggle.addEventListener('change', async () => {
            const newTheme = (toggle as HTMLInputElement).checked ? 'dark' : 'light';
            app.theme = newTheme; // Update the central state
            applyThemeUI(newTheme); // Update all UI elements
            
            createStatusBarMessage(app, `Theme set to ${newTheme}.`);
            
            // Persist the change
            await saveSimpleState('theme', newTheme);
        });
    }

export async function initScrollPosition(app: AppState): Promise<void> {
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
        const itemIsInDeck = app.deck.some((item: { guid: string }) => item.guid === lastViewedItemId);

        if (itemIsInDeck) {
            const targetEl = document.querySelector(`.entry[data-guid="${lastViewedItemId}"]`);
            if (targetEl) {
                // Use 'auto' for instant scroll on load.
                targetEl.scrollIntoView({ behavior: 'auto', block: 'start' });
                // Restore the fine-tuned vertical offset if it exists.
                if (typeof lastViewedItemOffset === 'number' && lastViewedItemOffset !== 0) {
                    window.scrollTo({ top: window.scrollY - lastViewedItemOffset, behavior: 'auto' });
                }
            }
        }
    });
}

// The PWA logic is standard and does not require refactoring.
let deferredPrompt: any;
window.addEventListener('beforeinstallprompt', (e: any) => {
    e.preventDefault();
    deferredPrompt = e;
    const installButton = document.getElementById('install-button');
    if (installButton) {
        installButton.style.display = 'block';
        installButton.addEventListener('click', () => {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then((choiceResult: any) => {
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
