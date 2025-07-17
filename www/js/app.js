// js/app.js - UPDATED CONTENT

// Import necessary modules
import { dbPromise, performFeedSync, performFullSync, pullUserState, processPendingOperations, saveStateValue, loadStateValue, isOnline } from './data/database.js';
import { appState as initialAppState } from './data/appState.js'; // Renamed import to avoid confusion
import { formatDate, shuffleArray, mapRawItems } from './helpers/dataUtils.js';
import { toggleStar, toggleHidden, pruneStaleHidden, loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState, setFilterMode, loadFilterMode } from './helpers/userStateUtils.js';
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initShuffleCount, initConfigPanelListeners } from './ui/uiInitializers.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition } from './ui/uiUpdaters.js';
import { getShuffleCountDisplay } from './ui/domUtils.js'; // Assuming you have this helper or will add it

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
        // Initialize them with default values or values from appState
        loading: true, // Default to true while app is initializing
        filterMode: initialAppState.filterMode,
        openSettings: initialAppState.openSettings,
        modalView: initialAppState.modalView,
        shuffleCount: initialAppState.shuffleCount,
        syncEnabled: initialAppState.syncEnabled,
        imagesEnabled: initialAppState.imagesEnabled,
        rssFeedsInput: initialAppState.rssFeedsInput,
        keywordBlacklistInput: initialAppState.keywordBlacklistInput,
        entries: initialAppState.allEntries, // 'entries' will be the source of truth for rendered items
        hidden: initialAppState.hidden,
        starred: initialAppState.starred,
        currentDeckGuids: initialAppState.currentDeckGuids,
        errorMessage: '',
        isOnline: isOnline(), // Initial online status

        // Computed property for filtered entries
        get filteredEntries() {
            // Ensure appState.allEntries is used as the base
            const allItems = this.entries;
            const hiddenSet = new Set(this.hidden.map(h => h.id));
            const starredSet = new Set(this.starred.map(s => s.id));
            const keywordBlacklist = this.keywordBlacklistInput.split('\n').filter(Boolean).map(kw => kw.trim().toLowerCase());

            let filtered = [];

            // If a deck is loaded, only show items in the current deck
            if (this.currentDeckGuids && this.currentDeckGuids.length > 0) {
                const deckSet = new Set(this.currentDeckGuids);
                filtered = allItems.filter(entry => deckSet.has(entry.id));
            } else {
                filtered = allItems;
            }

            // Apply filter mode
            if (this.filterMode === 'unread') {
                filtered = filtered.filter(entry => !hiddenSet.has(entry.id));
            } else if (this.filterMode === 'starred') {
                filtered = filtered.filter(entry => starredSet.has(entry.id));
            } else if (this.filterMode === 'hidden') {
                filtered = filtered.filter(entry => hiddenSet.has(entry.id));
            }
            // 'all' mode doesn't need further filtering based on hidden/starred

            // Apply keyword blacklist
            if (keywordBlacklist.length > 0) {
                filtered = filtered.filter(entry => {
                    const title = (entry.title || '').toLowerCase();
                    const description = (entry.description || '').toLowerCase();
                    return !keywordBlacklist.some(keyword => title.includes(keyword) || description.includes(keyword));
                });
            }

            // Sort by pubDate descending for all modes except shuffle
            return filtered.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
        },

        // --- Alpine.js init method ---
        async initApp() {
            const db = await dbPromise;

            try {
                // Load initial settings and user state from DB/localStorage
                this.syncEnabled = await loadStateValue(db, 'syncEnabled', true);
                this.imagesEnabled = await loadStateValue(db, 'imagesEnabled', true);
                this.filterMode = await loadFilterMode(db);
                this.hidden = await loadArrayStateFromDB(db, 'hidden'); // Use a helper to load arrays
                this.starred = await loadArrayStateFromDB(db, 'starred'); // Use a helper to load arrays
                this.currentDeckGuids = await loadCurrentDeck(db);

                const { shuffleCount, date } = await loadShuffleState(db);
                const today = new Date();
                today.setHours(0,0,0,0);
                if (date && new Date(date).toDateString() === today.toDateString()) {
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
                    this.hidden = await loadArrayStateFromDB(db, 'hidden');
                    this.starred = await loadArrayStateFromDB(db, 'starred');
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
                            this.hidden = await loadArrayStateFromDB(db, 'hidden');
                            this.starred = await loadArrayStateFromDB(db, 'starred');
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
            const stored = await loadStateValue(db, key, []);
            return Array.isArray(stored) ? stored : [];
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
            toggleStar(this, dbPromise, guid); // Pass 'this' and dbPromise
        },
        isHidden(guid) {
            return this.hidden.some(e => e.id === guid);
        },
        toggleHidden(guid) {
            toggleHidden(this, dbPromise, guid); // Pass 'this' and dbPromise
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