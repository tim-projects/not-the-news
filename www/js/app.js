// Add logging to validate CSS rules
function logHeaderStyles() {
  const headerTitle = document.querySelector('#header h2');
  if (headerTitle) {
    const screenWidth = window.innerWidth;
    const textAlign = window.getComputedStyle(headerTitle).textAlign;
    const left = window.getComputedStyle(headerTitle).left;
    console.log("Screen width: " + screenWidth + "px, text-align: " + textAlign + ", left: " + left);
  }
}

// Call the logging function on page load and resize
window.addEventListener('load', logHeaderStyles);
window.addEventListener('resize', logHeaderStyles);
// app.js

// Import necessary modules
import { dbPromise, performFeedSync, performFullSync, pullUserState, processPendingOperations, saveStateValue, loadStateValue, isOnline } from './data/database.js';
import { appState as initialAppState } from './data/appState.js'; // Renamed import to avoid confusion
// Updated import: deck functions are now part of dataUtils.js
import { formatDate, shuffleArray, mapRawItems, validateAndRegenerateCurrentDeck, loadNextDeck, shuffleFeed } from './helpers/dataUtils.js';
import { toggleStar, toggleHidden, pruneStaleHidden, loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState, setFilterMode, loadFilterMode } from './helpers/userStateUtils.js';
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initConfigPanelListeners } from './ui/uiInitializers.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition } from './ui/uiUpdaters.js';
import { getShuffleCountDisplay } from './ui/uiElements.js'; // This import is not used here but kept for completeness
import { createAndShowSaveMessage } from './ui/uiUpdaters.js';


// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
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

            this._cachedFilteredEntries = filtered;
            this._lastFilterHash = currentHash;
            return this._cachedFilteredEntries;
        },


        // --- Alpine.js init method ---
        async initApp() {
            const db = await dbPromise;

            try {
                // Load initial settings and user state from DB/localStorage
                this.syncEnabled = await loadStateValue(db, 'syncEnabled', true);
                this.imagesEnabled = await loadStateValue(db, 'imagesEnabled', true);
                this.filterMode = await loadFilterMode(db);

                // --- IMPORTANT ORDER: Load entries, then hidden/starred, then currentDeckGuids ---
                // Load feed items first, as hidden pruning and deck validation depend on them.
                await this.loadFeedItemsFromDB(); // Populates this.entries

                // Load hidden and starred after entries, as pruneStaleHidden depends on this.entries
                this.hidden = await this.loadArrayStateFromDB(db, 'hidden');
                this.starred = await this.loadArrayStateFromDB(db, 'starred');

                // Prune stale hidden entries immediately after loading all entries and hidden state
                // This ensures an accurate `hidden` array before deck validation.
                const itemsCount = await db.transaction('items', 'readonly').objectStore('items').count();
                let syncCompletionTime = Date.now(); // Default if no sync occurs
                if (itemsCount === 0 && isOnline()) {
                     const { feedTime } = await performFullSync(db);
                     syncCompletionTime = feedTime;
                     // Re-load hidden/starred if a full sync just happened to ensure consistency
                     this.hidden = await this.loadArrayStateFromDB(db, 'hidden');
                     this.starred = await this.loadArrayStateFromDB(db, 'starred');
                     await this.loadFeedItemsFromDB(); // Reload entries again if full sync added new ones
                }
                this.hidden = await pruneStaleHidden(db, this.entries, syncCompletionTime); // Use this.entries

                // Now load currentDeckGuids
                this.currentDeckGuids = await loadCurrentDeck(db);

                // *** NEW LOGIC: Validate and potentially regenerate currentDeckGuids ***
                await validateAndRegenerateCurrentDeck(this); // Pass 'this' (Alpine scope)
                // *******************************************************************

                const { shuffleCount, lastShuffleResetDate } = await loadShuffleState(db);
                const today = new Date();
                today.setHours(0,0,0,0);
                if (lastShuffleResetDate && new Date(lastShuffleResetDate).toDateString() === today.toDateString()) {
                    this.shuffleCount = shuffleCount;
                } else {
                    this.shuffleCount = 2; // Reset daily limit
                    this.shuffleCount = 2; // Reset daily limit
                    await saveShuffleState(db, 2, today); // Initialize with 2 shuffles for the day
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
                            await this.loadFeedItemsFromDB(); // Reload entries after sync
                            this.hidden = await pruneStaleHidden(db, this.entries, Date.now());
                            this.updateCounts();
                            // After background sync, re-validate current deck as items might have changed
                            await validateAndRegenerateCurrentDeck(this); // Pass 'this' (Alpine scope)
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
                        // After periodic sync, re-validate current deck
                        await validateAndRegenerateCurrentDeck(this); // Pass 'this' (Alpine scope)
                    } catch (error) {
                        console.error("Partial sync failed", error);
                    }
                }, SYNC_INTERVAL_MS);

            } catch (error) {
                console.error("Initialization failed:", error);
                this.errorMessage = "Could not load feed: " + error.message;
                this.loading = false;
            }
        },

        // --- Alpine.js methods (now part of the data object) ---

        // Helper to load array states from DB
        // This method can stay here as it's a general app utility for loading arrays
        async loadArrayStateFromDB(db, key) {
            const stored = await loadStateValue(db, key, []);
            return Array.isArray(stored) ? stored : [];
        },

        // Helper to load feed items from DB and update entries
        // This method should stay in app.js as it directly updates the app.entries state
        async loadFeedItemsFromDB() {
            const db = await dbPromise;
            const rawItemsFromDb = await db.transaction('items', 'readonly').objectStore('items').getAll();
            this.entries = mapRawItems(rawItemsFromDb, formatDate);
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
        // Original loadNextDeck and shuffleFeed methods now call the imported functions.
        async loadNextDeck() {
            await loadNextDeck(this); // Call the imported function from dataUtils
        },

        async shuffleFeed() {
            await shuffleFeed(this); // Call the imported function from dataUtils
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