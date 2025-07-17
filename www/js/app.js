import { dbPromise, performFeedSync, performFullSync, pullUserState, processPendingOperations, saveStateValue, loadStateValue, isOnline } from './js/data/database.js';
import { appState } from './js/data/appState.js';
import { formatDate, shuffleArray, mapRawItems } from './js/helpers/dataUtils.js';
import { toggleStar, toggleHidden, pruneStaleHidden, loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState, setFilterMode, loadFilterMode } from './js/helpers/userStateUtils.js';
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initShuffleCount, initConfigPanelListeners } from './js/ui/uiInitializers.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition } from './js/ui/uiUpdaters.js';

// Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
        .then(reg => {
            console.log('Service Worker registered:', reg.scope);
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                if (newWorker) {
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'activated') {
                            window.location.reload();
                        }
                    });
                }
            });
        })
        .catch(error => console.warn('Service Worker registration failed:', error));
}

window.rssApp = () => {
    const app = appState(); // Initialize the core app state

    // Assign methods from imported modules to the app state
    Object.assign(app, {
        formatDate,
        updateCounts: () => updateCounts(app), // Bind updateCounts to this app instance
        scrollToTop,
        isStarred: (guid) => app.starred.some(e => e.id === guid),
        toggleStar: (guid) => toggleStar(app, guid),
        isHidden: (guid) => app.hidden.some(e => e.id === guid),
        toggleHidden: (guid) => toggleHidden(app, guid),
        setFilter: (mode) => setFilterMode(app, dbPromise, mode), // Pass dbPromise
    });

    // Main initialization function for the Alpine.js app
    app.initApp = async function() {
        this.loading = true;
        let syncCompletionTime = 0;
        const db = await dbPromise;

        try {
            // Load initial settings and user state
            this.syncEnabled = await loadStateValue(db, 'syncEnabled', true);
            this.imagesEnabled = await loadStateValue(db, 'imagesEnabled', true);
            this.filterMode = await loadFilterMode(db);
            this.hidden = await loadArrayState(db, 'hidden');
            this.starred = await loadArrayState(db, 'starred');
            this.currentDeckGuids = await loadCurrentDeck(db);

            // Initialize UI components and their listeners
            await initTheme(this);
            await initSyncToggle(this);
            await initImagesToggle(this);
            await initShuffleCount(this);
            await initConfigPanelListeners(this); // Setup listeners for settings panels

            // Watchers for settings panel visibility
            this.$watch("openSettings", async (isOpen) => {
                if (isOpen) {
                    this.modalView = 'main'; // Ensure starting at main view when settings modal opens
                    await manageSettingsPanelVisibility(this);
                } else {
                    await saveCurrentScrollPosition(); // Save scroll position when closing settings
                }
            });
            this.$watch("modalView", async () => {
                await manageSettingsPanelVisibility(this);
            });


            // Initial feed sync if no items or needed
            const itemsCount = await db.transaction('items', 'readonly').objectStore('items').count();
            if (itemsCount === 0 && isOnline()) {
                const { feedTime } = await performFullSync(db);
                syncCompletionTime = feedTime;
                // Reload state after initial full sync
                this.hidden = await loadArrayState(db, 'hidden');
                this.starred = await loadArrayState(db, 'starred');
            } else {
                syncCompletionTime = Date.now();
            }

            // Load feed items from DB
            const rawItemsFromDb = await db.transaction('items', 'readonly').objectStore('items').getAll();
            this.entries = mapRawItems(rawItemsFromDb, this.formatDate);

            // Prune stale hidden items
            this.hidden = await pruneStaleHidden(db, this.entries, syncCompletionTime);
            this.updateCounts();
            await initScrollPosition(this); // Restore scroll position after initial render

            this.loading = false;

            // Background partial sync if enabled (short delay to not block main thread)
            if (this.syncEnabled) {
                setTimeout(async () => {
                    try {
                        await performFeedSync(db);
                        await pullUserState(db);
                        this.hidden = await loadArrayState(db, 'hidden'); // Reload hidden after background sync
                        this.starred = await loadArrayState(db, 'starred'); // Reload starred after background sync
                        const freshRawFeed = await db.transaction('items', 'readonly').objectStore('items').getAll();
                        this.entries = mapRawItems(freshRawFeed, this.formatDate);
                        this.hidden = await pruneStaleHidden(db, this.entries, Date.now()); // Prune again with fresh data
                        this.updateCounts();
                    } catch (error) {
                        console.error('Background partial sync failed', error);
                    }
                }, 0);
            }

            attachScrollToTopHandler(); // Attach scroll-to-top behavior

            // Setup online/offline listeners
            window.addEventListener('online', async () => {
                this.isOnline = true;
                if (this.syncEnabled) await processPendingOperations(db);
            });
            window.addEventListener('offline', () => { this.isOnline = false; });

            // Setup activity listeners for auto-sync
            let lastActivityTimestamp = Date.now();
            const recordActivity = () => { lastActivityTimestamp = Date.now(); };
            ["mousemove", "mousedown", "keydown", "scroll", "click"].forEach(event => document.addEventListener(event, recordActivity, true));
            document.addEventListener("visibilitychange", recordActivity, true);
            window.addEventListener("focus", recordActivity, true);

            const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
            const INACTIVITY_TIMEOUT_MS = 60 * 1000; // 1 minute of inactivity

            setInterval(async () => {
                const now = Date.now();
                if (this.openSettings || !this.syncEnabled || document.hidden || (now - lastActivityTimestamp) > INACTIVITY_TIMEOUT_MS) {
                    return; // Skip sync if settings are open, sync is disabled, document is hidden, or inactive
                }
                try {
                    await performFeedSync(db);
                    await pullUserState(db);
                    this.hidden = await pruneStaleHidden(db, this.entries, now); // Prune hidden based on current time
                } catch (error) {
                    console.error("Partial sync failed", error);
                }
            }, SYNC_INTERVAL_MS);

            // Load next deck if current deck is empty
            if (this.currentDeckGuids.length === 0) {
                await this.loadNextDeck();
            }

        } catch (error) {
            console.error("Initialization failed:", error);
            this.errorMessage = "Could not load feed: " + error.message;
            this.loading = false;
        }
    };

    // Methods for app interaction (now part of the app object)
    app.loadNextDeck = async function() {
        const db = await dbPromise;
        const allItems = await db.transaction('items', 'readonly').objectStore('items').getAll();
        const hiddenSet = new Set(this.hidden.map(h => h.id));
        const unhiddenItems = allItems.filter(i => !hiddenSet.has(i.guid)).sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));

        const nextDeck = unhiddenItems.slice(0, 10);
        this.currentDeckGuids = nextDeck.map(i => i.guid);
        await saveCurrentDeck(db, this.currentDeckGuids);
        this.updateCounts();
        this.scrollToTop();
    };

    app.shuffleFeed = async function() {
        if (this.shuffleCount <= 0) return;

        const db = await dbPromise;
        const allUnhidden = this.entries.filter(e => !this.hidden.some(h => h.id === e.id));
        const deckGuidsSet = new Set(this.currentDeckGuids);
        const eligibleItems = allUnhidden.filter(i => !deckGuidsSet.has(i.id));

        if (eligibleItems.length === 0) return;

        const shuffledEligible = shuffleArray(eligibleItems);
        const newDeck = shuffledEligible.slice(0, 10);
        this.currentDeckGuids = newDeck.map(i => i.id);
        await saveCurrentDeck(db, this.currentDeckGuids);

        this.shuffleCount--;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        await saveShuffleState(db, this.shuffleCount, today);

        this.updateCounts();
        this.scrollToTop();
        this._cachedFilteredEntries = null;
        this.isShuffled = true;

        const shuffleDisplay = getShuffleCountDisplay();
        if (shuffleDisplay) shuffleDisplay.textContent = this.shuffleCount;
    };

    return app;
};

// Global event listener for image loading (outside Alpine.js app)
document.addEventListener("load", e => {
    if (e.target?.tagName?.toLowerCase() === "img") {
        e.target.classList.add("loaded");
    }
}, true);