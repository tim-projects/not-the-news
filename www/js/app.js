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
// IMPORT displayCurrentDeck HERE
import { formatDate, shuffleArray, mapRawItems, validateAndRegenerateCurrentDeck, loadNextDeck, shuffleFeed, displayCurrentDeck } from './helpers/dataUtils.js';
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
        // *** NEW: Add deckItems to appState for display ***
        deckItems: initialAppState().deckItems,
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
                    // Filtered unread items are those in the current deck AND not hidden
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

                // *** Validate and potentially regenerate currentDeckGuids ***
                // This function now internally calls displayCurrentDeck(this) if the deck changes.
                await validateAndRegenerateCurrentDeck(this);

                // Initial display of the deck if not already done by validateAndRegenerateCurrentDeck
                // This ensures that the deck is displayed even if no validation/regeneration was needed
                // (e.g., first load and existing valid deck).
                displayCurrentDeck(this);
                // *******************************************************************

                const { shuffleCount, lastShuffleResetDate } = await loadShuffleState(db);
                const today = new Date();
                today.setHours(0,0,0,0);
                if (lastShuffleResetDate && new Date(lastShuffleResetDate).toDateString() === today.toDateString()) {
                    this.shuffleCount = shuffleCount;
                } else {
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
                            // This function now internally calls displayCurrentDeck(this) if the deck changes.
                            await validateAndRegenerateCurrentDeck(this);
                        } catch (error) {
                            console.error('Background partial sync failed', error);
                        }
                    }, 0); // Non-blocking immediate execution
                }

                attachScrollToTopHandler(); // Attach scroll-to-top behavior

                // Setup online/offline listeners
                window.addEventListener('online', async () => {
                    this.isOnline = true;
                    if (this.syncEnabled) {
                        await processPendingOperations(db);
                        // If returning online and operations were processed, data might have changed.
                        // Refresh data and deck.
                        await this.loadFeedItemsFromDB();
                        this.hidden = await this.loadArrayStateFromDB(db, 'hidden');
                        this.starred = await this.loadArrayStateFromDB(db, 'starred');
                        this.hidden = await pruneStaleHidden(db, this.entries, Date.now());
                        this.updateCounts();
                        // Call displayCurrentDeck directly here, or ensure validateAndRegenerateCurrentDeck is robust enough.
                        // validateAndRegenerateCurrentDeck will handle updating display.
                        await validateAndRegenerateCurrentDeck(this);
                    }
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
                    // Sync only if online, not in settings, sync is enabled, document is visible, and recently active
                    if (!this.isOnline || this.openSettings || !this.syncEnabled || document.hidden || (now - lastActivityTimestamp) > INACTIVITY_TIMEOUT_MS) {
                        return;
                    }
                    try {
                        console.log("Performing periodic background sync...");
                        await performFeedSync(db);
                        await pullUserState(db);
                        await this.loadFeedItemsFromDB(); // Reload items after sync
                        this.hidden = await pruneStaleHidden(db, this.entries, now); // Prune hidden based on current time
                        this.updateCounts();
                        // After periodic sync, re-validate current deck
                        // This function now internally calls displayCurrentDeck(this) if the deck changes.
                        await validateAndRegenerateCurrentDeck(this);
                        console.log("Periodic background sync completed.");
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
        async toggleStar(guid) { // Make async because saveStateValue might be in toggleStar
            await toggleStar(this, guid); // Pass 'this' and guid (dbPromise is within toggleStar now)
            // No need to call displayCurrentDeck here, as starring/unstarring doesn't change the deck content,
            // only its visual state if you apply classes based on this.starred.
            // If you filter your *displayed* items based on starred state, then you'd re-call displayCurrentDeck.
        },
        isHidden(guid) {
            return this.hidden.some(e => e.id === guid);
        },
        async toggleHidden(guid) { // Make async because saveStateValue might be in toggleHidden
            await toggleHidden(this, guid); // Pass 'this' and guid (dbPromise is within toggleHidden now)
            // After hiding an item, the deck might need to be re-evaluated and displayed
            // validateAndRegenerateCurrentDeck will handle this.
            await validateAndRegenerateCurrentDeck(this);
        },
        setFilter(mode) {
            this.filterMode = mode; // Update Alpine's reactive property
            // The $watch for filterMode will handle saving to DB.
            // IMPORTANT: When filterMode changes, you likely want to re-render what's shown.
            // If your HTML template uses `filteredEntries` directly for display (e.g., x-for="item in filteredEntries"),
            // Alpine will automatically react to `this.filterMode` changing due to the getter.
            // If your main display still relies on `deckItems`, you might need to adjust or call `displayCurrentDeck(this)`
            // after setting the filter, but generally, computed properties handle this elegantly.
            // Given your `filteredEntries` computed property, a direct call to `displayCurrentDeck` might be redundant
            // for filter changes if your x-for is `filteredEntries`. However, if the main deck view only shows
            // `currentDeckGuids`, then setting a filter mode *might* not immediately change what's shown
            // unless your UI switches to showing `filteredEntries` for specific modes.
            // For now, let's assume `filteredEntries` directly drives your main display when filterMode is not 'unread'.
            // If the filter mode is 'unread', then `currentDeckGuids` still dictates the primary view.
        },
        // Original loadNextDeck and shuffleFeed methods now call the imported functions.
        async loadNextDeck() {
            // The imported loadNextDeck already calls displayCurrentDeck(this)
            await loadNextDeck(this);
        },

        async shuffleFeed() {
            // The imported shuffleFeed already calls displayCurrentDeck(this)
            await shuffleFeed(this);
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
            // After re-fetching and full sync, the deck might need re-validation/generation
            await validateAndRegenerateCurrentDeck(this);
            this.loading = false;
        },

        async saveKeywordBlacklist() {
            const db = await dbPromise;
            await saveStateValue(db, 'keywordBlacklist', this.keywordBlacklistInput);
            createAndShowSaveMessage('Keyword Blacklist saved!', 'success', 'keywords-save-msg');
            // Re-apply filter to update displayed items
            // If keywords affect `filteredEntries`, Alpine's reactivity will handle it.
            // If it needs to update the primary deck, you might need to re-validate/generate or display.
            // For keyword blacklist, it typically affects the *pool* from which new decks are drawn,
            // or how `filteredEntries` behaves. No direct `displayCurrentDeck` call needed here
            // unless your current deck actively changes based on a keyword blacklist, which is less common.
            this.updateCounts();
        }
    }));
});