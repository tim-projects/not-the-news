// Import necessary modules
import { dbPromise, performFeedSync, performFullSync, pullUserState, processPendingOperations, saveStateValue, loadStateValue, isOnline } from './data/database.js';
import { appState as initialAppState } from './data/appState.js'; // Renamed import to avoid confusion
import { formatDate, shuffleArray, mapRawItems } from './helpers/dataUtils.js';
import { toggleStar, toggleHidden, pruneStaleHidden, loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState, setFilterMode, loadFilterMode } from './helpers/userStateUtils.js';
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initShuffleCount, initConfigPanelListeners } from './ui/uiInitializers.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition } from './ui/uiUpdaters.js';
import { getShuffleCountDisplay } from './ui/uiElements.js'; // Assuming you have this helper or will add it
import { createAndShowSaveMessage } from './ui/uiElements.js'; // Assuming createAndShowSaveMessage is in ui/uiElements.js or similar

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                console.log('Service Worker registered:', reg.scope);
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'activated') {
                                window.location.reload(); // Reload the page to pick up new service worker
                            }
                        });
                    }
                });
            })
            .catch(error => console.warn('Service Worker registration failed:', error));
    });
}

// Global event listener for image loading (outside Alpine.js app)
document.addEventListener("load", e => {
    if (e.target?.tagName?.toLowerCase() === "img") {
        e.target.classList.add("loaded");
    }
}, true);

// Alpine.js Initialization
document.addEventListener('alpine:init', () => {
    Alpine.data('rssApp', () => ({
        // Reactive properties for Alpine to observe.
        // **FIX:** Call initialAppState() to get the initial state object
        loading: initialAppState().loading, // Initialize with the default from appState
        filterMode: initialAppState().filterMode,
        openSettings: initialAppState().openSettings,
        modalView: initialAppState().modalView,
        shuffleCount: initialAppState().shuffleCount,
        syncEnabled: initialAppState().syncEnabled,
        imagesEnabled: initialAppState().imagesEnabled,
        rssFeedsInput: initialAppState().rssFeedsInput,
        keywordBlacklistInput: initialAppState().keywordBlacklistInput,
        entries: initialAppState().entries, // Correctly references 'entries' from appState.js
        hidden: initialAppState().hidden,
        starred: initialAppState().starred,
        currentDeckGuids: initialAppState().currentDeckGuids,
        errorMessage: initialAppState().errorMessage,
        isOnline: initialAppState().isOnline,
        // Ensure memoization properties are initialized too, as they are part of appState.js
        _lastFilterHash: initialAppState()._lastFilterHash,
        _cachedFilteredEntries: initialAppState()._cachedFilteredEntries,


        // Computed property for filtered entries (copied directly from your appState.js logic)
        get filteredEntries() {
            // Create a hash to memoize based on relevant properties
            const currentHash = `${this.entries.length}-${this.filterMode}-${this.hidden.length}-${this.starred.length}-${this.imagesEnabled}-${this.currentDeckGuids.length}-${this.keywordBlacklistInput}`;

            if (this.entries.length > 0 && currentHash === this._lastFilterHash && this._cachedFilteredEntries !== null) {
                return this._cachedFilteredEntries;
            }

            const hiddenMap = new Map(this.hidden.map(h => [h.id, h.hiddenAt]));
            const starredMap = new Map(this.starred.map(s => [s.id, s.starredAt]));
            let filtered = [];

            switch (this.filterMode) {
                case "all":
                    filtered = this.entries;
                    break;
                case "unread":
                    const deckSet = new Set(this.currentDeckGuids);
                    filtered = this.entries.filter(e => deckSet.has(e.id) && !hiddenMap.has(e.id));
                    break;
                case "hidden":
                    filtered = this.entries.filter(e => hiddenMap.has(e.id)).sort((a, b) => new Date(hiddenMap.get(b.id)).getTime() - new Date(hiddenMap.get(a.id)).getTime());
                    break;
                case "starred":
                    filtered = this.entries.filter(e => starredMap.has(e.id)).sort((a, b) => new Date(starredMap.get(b.id)).getTime() - new Date(starredMap.get(a.id)).getTime());
                    break;
                default:
                    filtered = this.entries;
                    break;
            }

            // Apply keyword blacklist (this was in your original app.js version, but missing from the appState.js getter you provided)
            // Ensure this logic is consistent between appState.js and app.js if filteredEntries is also in appState.js
            const keywordBlacklist = this.keywordBlacklistInput.split('\n').filter(Boolean).map(kw => kw.trim().toLowerCase());
            if (keywordBlacklist.length > 0) {
                filtered = filtered.filter(entry => {
                    const title = (entry.title || '').toLowerCase();
                    const description = (entry.description || '').toLowerCase();
                    return !keywordBlacklist.some(keyword => title.includes(keyword) || description.includes(keyword));
                });
            }

            this._cachedFilteredEntries = filtered;
            this._lastFilterHash = currentHash;
            return this._cachedFilteredEntries;
        },


        // --- Alpine.js init method ---
        async initApp() {
            const db = await dbPromise;

            try {
                // Load initial settings and user state from DB/localStorage
                // These loadStateValue calls are fine, as you expect them to update the initial state
                this.syncEnabled = await loadStateValue(db, 'syncEnabled', true);
                this.imagesEnabled = await loadStateValue(db, 'imagesEnabled', true);
                this.filterMode = await loadFilterMode(db);
                this.hidden = await this.loadArrayStateFromDB(db, 'hidden');
                this.starred = await this.loadArrayStateFromDB(db, 'starred');
                this.currentDeckGuids = await loadCurrentDeck(db);

                const { shuffleCount, lastShuffleResetDate } = await loadShuffleState(db);
                const today = new Date();
                today.setHours(0,0,0,0);
                if (lastShuffleResetDate && new Date(lastShuffleResetDate).toDateString() === today.toDateString()) {
                    this.shuffleCount = shuffleCount;
                } else {
                    this.shuffleCount = 3; // Reset daily limit
                    await saveShuffleState(db, 3, today);
                }

                // Initialize UI components and their listeners, passing `this` (Alpine scope)
                initTheme(this);
                initSyncToggle(this);
                initImagesToggle(this);
                initConfigPanelListeners(this); // Setup listeners for settings panels

                // Watchers for settings panel visibility
                this.$watch("openSettings", async (isOpen) => {
                    if (isOpen) {
                        this.modalView = 'main'; // Ensure starting at main view when settings modal opens
                        await manageSettingsPanelVisibility(this);
                        // Reload text area content when opening settings
                        this.rssFeedsInput = await loadStateValue(db, 'rssFeeds', '');
                        this.keywordBlacklistInput = await loadStateValue(db, 'keywordBlacklist', '');
                    } else {
                        await saveCurrentScrollPosition(); // Save scroll position when closing settings
                    }
                });
                this.$watch("modalView", async () => {
                    await manageSettingsPanelVisibility(this);
                });
                // Watchers for settings changes (direct model binding saves values)
                this.$watch('syncEnabled', value => saveStateValue(db, 'syncEnabled', value));
                this.$watch('imagesEnabled', value => saveStateValue(db, 'imagesEnabled', value));
                this.$watch('rssFeedsInput', value => saveStateValue(db, 'rssFeeds', value));
                this.$watch('keywordBlacklistInput', value => saveStateValue(db, 'keywordBlacklist', value));
                this.$watch('filterMode', value => setFilterMode(this, db, value)); // Save filter mode on change

                // Initial feed sync if no items or needed
                const itemsCount = await db.transaction('items', 'readonly').objectStore('items').count();
                let syncCompletionTime = Date.now(); // Default to now if no sync occurs
                if (itemsCount === 0 && isOnline()) {
                    const { feedTime } = await performFullSync(db);
                    syncCompletionTime = feedTime;
                    // Reload state after initial full sync
                    this.hidden = await this.loadArrayStateFromDB(db, 'hidden'); // Use this.loadArrayStateFromDB
                    this.starred = await this.loadArrayStateFromDB(db, 'starred'); // Use this.loadArrayStateFromDB
                }

                // Load feed items from DB
                await this.loadFeedItemsFromDB(); // New helper method
                this.hidden = await pruneStaleHidden(db, this.entries, syncCompletionTime); // Use this.entries
                this.updateCounts();
                await initScrollPosition(this); // Restore scroll position after initial render

                this.loading = false; // Important: Set loading to false here

                // Background partial sync if enabled (short delay to not block main thread)
                if (this.syncEnabled) {
                    setTimeout(async () => {
                        try {
                            await performFeedSync(db);
                            await pullUserState(db);
                            // Re-load data after background sync to ensure UI updates
                            this.hidden = await this.loadArrayStateFromDB(db, 'hidden');
                            this.starred = await this.loadArrayStateFromDB(db, 'starred');
                            await this.loadFeedItemsFromDB();
                            this.hidden = await pruneStaleHidden(db, this.entries, Date.now());
                            this.updateCounts();
                        } catch (error) {
                            console.error('Background partial sync failed', error);
                        }
                    }, 0); // Non-blocking immediate execution
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
                        await this.loadFeedItemsFromDB(); // Reload items after sync
                        this.hidden = await pruneStaleHidden(db, this.entries, now); // Prune hidden based on current time
                        this.updateCounts();
                    } catch (error) {
                        console.error("Partial sync failed", error);
                    }
                }, SYNC_INTERVAL_MS);

                // Load next deck if current deck is empty after initial load
                if (this.currentDeckGuids.length === 0 && this.entries.length > 0) {
                    await this.loadNextDeck();
                }

            } catch (error) {
                console.error("Initialization failed:", error);
                this.errorMessage = "Could not load feed: " + error.message;
                this.loading = false;
            }
        },

        // --- Alpine.js methods (now part of the data object) ---

        // Helper to load array states from DB
        async loadArrayStateFromDB(db, key) {
            // **FIX**: loadStateValue is used here instead of loadArrayState from database.js
            // If loadStateValue can correctly return an array, this is fine.
            // If loadArrayState is specifically for arrays, consider using that.
            const stored = await loadStateValue(db, key, []); // loadStateValue provides a default []
            return Array.isArray(stored) ? stored : []; // Ensure it's an array
        },

        // Helper to load feed items from DB and update entries
        async loadFeedItemsFromDB() {
            const db = await dbPromise;
            const rawItemsFromDb = await db.transaction('items', 'readonly').objectStore('items').getAll();
            this.entries = mapRawItems(rawItemsFromDb, formatDate); // Use mapRawItems, formatDate from helpers
        },

        updateCounts() {
            updateCounts(this); // Pass 'this' (Alpine scope) to the helper
        },

        scrollToTop() {
            scrollToTop();
        },

        isStarred(guid) {
            return this.starred.some(e => e.id === guid);
        },
        toggleStar(guid) {
            toggleStar(this, guid); // Pass 'this' and guid (dbPromise is within toggleStar now)
        },
        isHidden(guid) {
            return this.hidden.some(e => e.id === guid);
        },
        toggleHidden(guid) {
            toggleHidden(this, guid); // Pass 'this' and guid (dbPromise is within toggleHidden now)
        },
        setFilter(mode) {
            this.filterMode = mode; // Update Alpine's reactive property
            // The $watch for filterMode will handle saving to DB
        },

        async loadNextDeck() {
            const db = await dbPromise;
            // Ensure entries is up-to-date
            await this.loadFeedItemsFromDB();

            const hiddenSet = new Set(this.hidden.map(h => h.id));
            const unhiddenItems = this.entries.filter(i => !hiddenSet.has(i.id))
                                              .sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));

            const nextDeck = unhiddenItems.slice(0, 10);
            this.currentDeckGuids = nextDeck.map(i => i.id);
            await saveCurrentDeck(db, this.currentDeckGuids);
            this.updateCounts();
            this.scrollToTop();
        },

        async shuffleFeed() {
            if (this.shuffleCount <= 0) {
                createAndShowSaveMessage('No shuffles left for today!', 'error');
                return;
            }

            const db = await dbPromise;
            // Ensure entries is up-to-date
            await this.loadFeedItemsFromDB();

            const allUnhidden = this.entries.filter(e => !this.hidden.some(h => h.id === e.id));
            const deckGuidsSet = new Set(this.currentDeckGuids);
            const eligibleItems = allUnhidden.filter(i => !deckGuidsSet.has(i.id));

            if (eligibleItems.length === 0) {
                createAndShowSaveMessage('No new items to shuffle in.', 'info');
                return;
            }

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
            // No need for _cachedFilteredEntries or isShuffled if filteredEntries is a computed prop
            // The update to currentDeckGuids will naturally trigger filteredEntries re-computation
        },

        // The save settings logic for textareas is now simpler as x-model binds directly
        // and $watch saves to DB. The buttons simply trigger the $watch.
        async saveRssFeeds() {
            const db = await dbPromise;
            await saveStateValue(db, 'rssFeeds', this.rssFeedsInput);
            createAndShowSaveMessage('RSS Feeds saved!', 'success', 'rss-save-msg');
            // Re-fetch feeds after saving new RSS feeds
            this.loading = true; // Show loading while refetching
            await performFullSync(db); // Full sync to get new feeds
            await this.loadFeedItemsFromDB();
            this.loading = false;
        },

        async saveKeywordBlacklist() {
            const db = await dbPromise;
            await saveStateValue(db, 'keywordBlacklist', this.keywordBlacklistInput);
            createAndShowSaveMessage('Keyword Blacklist saved!', 'success', 'keywords-save-msg');
            // Re-apply filter to update displayed items
            this.updateCounts(); // updateCounts implicitly calls applyFilter via filteredEntries
        }
    }));
});