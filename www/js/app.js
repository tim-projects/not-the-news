// Add logging to validate CSS rules (KEEP THIS FOR DEBUGGING)
function logHeaderStyles() {
  const headerTitle = document.querySelector('#header h2');
  if (headerTitle) {
    const screenWidth = window.innerWidth;
    const textAlign = window.getComputedStyle(headerTitle).textAlign;
    const left = window.getComputedStyle(headerTitle).left;
    console.log("Screen width: " + screenWidth + "px, text-align: " + textAlign + ", left: " + left);
  }
}

// Call the logging function on page load and resize (KEEP THIS FOR DEBUGGING)
window.addEventListener('load', logHeaderStyles);
window.addEventListener('resize', logHeaderStyles);

// app.js

// Import necessary modules
import { dbPromise, performFeedSync, performFullSync, pullUserState, processPendingOperations, saveStateValue, loadStateValue, isOnline } from './data/database.js';
import { appState as initialAppState } from './data/appState.js'; // Renamed import to avoid confusion
import { formatDate, shuffleArray, mapRawItems, validateAndRegenerateCurrentDeck, loadNextDeck, shuffleFeed, displayCurrentDeck } from './helpers/dataUtils.js';
import { toggleStar, toggleHidden, pruneStaleHidden, loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState, setFilterMode, loadFilterMode } from './helpers/userStateUtils.js';
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initConfigPanelListeners } from './ui/uiInitializers.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition } from './ui/uiUpdaters.js';
// import { getShuffleCountDisplay } from './ui/uiElements.js'; // This import is not used here, consider removing if truly unused.
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
        openUrlsInNewTabEnabled: initialAppState().openUrlsInNewTabEnabled,
        // Reactive properties for Alpine to observe.
        loading: initialAppState().loading,
        filterMode: initialAppState().filterMode,
        openSettings: initialAppState().openSettings,
        modalView: initialAppState().modalView,
        shuffleCount: initialAppState().shuffleCount,
        syncEnabled: initialAppState().syncEnabled,
        imagesEnabled: initialAppState().imagesEnabled,
        rssFeedsInput: initialAppState().rssFeedsInput,
        keywordBlacklistInput: initialAppState().keywordBlacklistInput,
        entries: initialAppState().entries,
        hidden: initialAppState().hidden,
        starred: initialAppState().starred,
        currentDeckGuids: initialAppState().currentDeckGuids,
        errorMessage: initialAppState().errorMessage,
        isOnline: initialAppState().isOnline,
        deckItems: initialAppState().deckItems,
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
            
            // Apply keyword blacklist if it exists
            const keywordBlacklist = this.keywordBlacklistInput.split(',').map(kw => kw.trim().toLowerCase()).filter(kw => kw.length > 0);
            if (keywordBlacklist.length > 0) {
                filtered = filtered.filter(item => {
                    const title = item.title ? item.title.toLowerCase() : '';
                    const description = item.description ? item.description.toLowerCase() : '';
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
                this.syncEnabled = await loadStateValue(db, 'syncEnabled', true);
                this.imagesEnabled = await loadStateValue(db, 'imagesEnabled', true);
                this.openUrlsInNewTabEnabled = await loadStateValue(db, 'openUrlsInNewTabEnabled', true);
                this.filterMode = await loadFilterMode(db);
                this.isOnline = isOnline(); // Set initial online status

                // --- NEW LOGIC: Attempt to pull user state (including current deck) from server early ---
                // This happens first if online, ensuring the most recent shared deck is fetched.
                if (this.syncEnabled && this.isOnline) {
                    try {
                        console.log("Attempting early pull of user state (including current deck) from server...");
                        await pullUserState(db); // This function (in database.js) needs to handle currentDeckGuids sync
                        console.log("Early user state pull completed.");
                    } catch (error) {
                        console.warn("Early pullUserState failed, proceeding with local state. Error:", error);
                        // Don't block initialization if sync fails here. User gets local state.
                    }
                }
                // --- END NEW LOGIC ---

                // Load feed items from DB (populates this.entries).
                // This must happen before hidden pruning or deck validation, as they depend on `entries`.
                await this.loadFeedItemsFromDB();

                // Load hidden and starred states from local DB. These might have been updated by early pullUserState.
                this.hidden = await this.loadArrayStateFromDB(db, 'hidden');
                this.starred = await this.loadArrayStateFromDB(db, 'starred');

                // Determine sync completion time for pruning stale hidden entries.
                // If no items are present locally and online, perform a full sync.
                const itemsCount = await db.transaction('items', 'readonly').objectStore('items').count();
                let syncCompletionTime = Date.now(); // Default, if no full sync occurs
                if (itemsCount === 0 && this.isOnline) {
                     const { feedTime } = await performFullSync(db);
                     syncCompletionTime = feedTime;
                     // After a full sync (which might add new feeds/items), re-pull user state to ensure consistency,
                     // and reload entries/hidden/starred to reflect any changes.
                     if (this.syncEnabled && this.isOnline) {
                         await pullUserState(db); // Re-pull user state (could update deck, hidden, starred)
                         this.hidden = await this.loadArrayStateFromDB(db, 'hidden');
                         this.starred = await this.loadArrayStateFromDB(db, 'starred');
                     }
                     await this.loadFeedItemsFromDB(); // Reload entries again if full sync added new ones
                }
                // Prune stale hidden entries based on the current set of `entries`.
                this.hidden = await pruneStaleHidden(db, this.entries, syncCompletionTime);

                // Now load currentDeckGuids. This will reflect the deck from the early pullUserState,
                // or the last locally saved one if no sync occurred or it failed.
                this.currentDeckGuids = await loadCurrentDeck(db);

                // Validate and potentially regenerate currentDeckGuids.
                // This also ensures the deck is valid based on currently available entries and hidden states.
                // validateAndRegenerateCurrentDeck *also calls* displayCurrentDeck internally.
                await validateAndRegenerateCurrentDeck(this);

                // No need for a separate displayCurrentDeck(this) here, as validateAndRegenerateCurrentDeck
                // will ensure the display is updated after its processing.

                // Load and set shuffle count based on last reset date
                const { shuffleCount, lastShuffleResetDate } = await loadShuffleState(db);
                const today = new Date();
                today.setHours(0,0,0,0);
                if (lastShuffleResetDate && new Date(lastShuffleResetDate).toDateString() === today.toDateString()) {
                    this.shuffleCount = shuffleCount;
                } else {
                    this.shuffleCount = 2; // Reset daily limit
                    await saveShuffleState(db, 2, today); // Initialize with 2 shuffles for the day
                }

                // Initialize UI components and their listeners
                initTheme(this);
                initSyncToggle(this);
                initImagesToggle(this);
                initConfigPanelListeners(this);

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
                this.$watch('openUrlsInNewTabEnabled', value => saveStateValue(db, 'openUrlsInNewTabEnabled', value));
                this.$watch('rssFeedsInput', value => saveStateValue(db, 'rssFeeds', value));
                this.$watch('keywordBlacklistInput', value => saveStateValue(db, 'keywordBlacklist', value));
                this.$watch('filterMode', value => setFilterMode(this, db, value));
this.updateCounts();
await initScrollPosition(this); // Restore scroll position after initial render

// Convert URLs to links after initial render
await this.convertUrlsInEntries();

                this.loading = false; // Important: Set loading to false here after all initial loading

                // Background partial sync if enabled (short delay to not block main thread)
                if (this.syncEnabled) {
                    setTimeout(async () => {
                        try {
                            console.log("Initiating background partial sync...");
                            await performFeedSync(db); // Fetches new articles
                            await pullUserState(db); // Syncs user states (hidden, starred, currentDeckGuids)
                            // Re-load data after background sync to ensure UI updates
                            this.hidden = await this.loadArrayStateFromDB(db, 'hidden');
                            this.starred = await this.loadArrayStateFromDB(db, 'starred');
                            await this.loadFeedItemsFromDB(); // Reload entries after sync
                            this.hidden = await pruneStaleHidden(db, this.entries, Date.now());
                            this.updateCounts();
                            // After background sync, re-validate current deck as items might have changed
                            await validateAndRegenerateCurrentDeck(this);
                            console.log("Background partial sync completed.");
                            await this.convertUrlsInEntries();
                        } catch (error) {
                            console.error('Background partial sync failed', error);
                        }
                    }, 0); // Non-blocking immediate execution
                }

                attachScrollToTopHandler();

                // Setup online/offline listeners
                window.addEventListener('online', async () => {
                    this.isOnline = true;
                    if (this.syncEnabled) {
                        console.log("Online detected. Processing pending operations and resyncing.");
                        await processPendingOperations(db);
                        // If returning online and operations were processed, data might have changed.
                        // Refresh all relevant data.
                        await this.loadFeedItemsFromDB();
                        this.hidden = await this.loadArrayStateFromDB(db, 'hidden');
                        this.starred = await this.loadArrayStateFromDB(db, 'starred');
                        this.hidden = await pruneStaleHidden(db, this.entries, Date.now());
                        this.updateCounts();
                        await validateAndRegenerateCurrentDeck(this); // Validate and update display
                        console.log("Online resync completed.");
                    }
                });
                window.addEventListener('offline', () => {
                    this.isOnline = false;
                    console.warn("Offline detected. Syncing disabled.");
                });

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
                        await this.loadFeedItemsFromDB();
                        this.hidden = await pruneStaleHidden(db, this.entries, now);
                        this.updateCounts();
                        await validateAndRegenerateCurrentDeck(this);
                        console.log("Periodic background sync completed.");
                        await this.convertUrlsInEntries();
                    } catch (error) {
                        console.error("Periodic sync failed", error);
                    }
                }, SYNC_INTERVAL_MS);

            } catch (error) {
                console.error("Initialization failed:", error);
                this.errorMessage = "Could not load feed: " + error.message;
                this.loading = false;
            }
        },
        
        // --- NEW LOGIC: Convert URLs to links based on setting ---
        async convertUrlsInEntries() {
            const entriesContainer = document.getElementById('items');
            if (entriesContainer) {
                console.log(`openUrlsInNewTabEnabled: ${this.openUrlsInNewTabEnabled}`); // Log the value of openUrlsInNewTabEnabled
                convertUrlsToLinks(entriesContainer, this.openUrlsInNewTabEnabled);
            }
        },

        // --- Alpine.js methods ---

        async loadArrayStateFromDB(db, key) {
            const stored = await loadStateValue(db, key, []);
            return Array.isArray(stored) ? stored : [];
        },

        async loadFeedItemsFromDB() {
            const db = await dbPromise;
            const rawItemsFromDb = await db.transaction('items', 'readonly').objectStore('items').getAll();
            this.entries = mapRawItems(rawItemsFromDb, formatDate);
        },

        updateCounts() {
            updateCounts(this);
        },

        scrollToTop() {
            scrollToTop();
        },

        isStarred(guid) {
            return this.starred.some(e => e.id === guid);
        },
        async toggleStar(guid) {
            await toggleStar(this, guid);
            // No need to call displayCurrentDeck as starring doesn't change the deck content.
        },
        isHidden(guid) {
            return this.hidden.some(e => e.id === guid);
        },
        async toggleHidden(guid) {
            await toggleHidden(this, guid);
            await validateAndRegenerateCurrentDeck(this); // Re-evaluates and redraws if deck changes
        },
        setFilter(mode) {
            this.filterMode = mode;
            // Alpine's computed property `filteredEntries` will react to `filterMode` change.
            // If your UI relies on `deckItems` for all display modes, you might call `displayCurrentDeck(this)`
            // here, but if it uses `filteredEntries` when not in "unread" mode, it's automatic.
        },
        async loadNextDeck() {
            await loadNextDeck(this);
        },

        async shuffleFeed() {
            await shuffleFeed(this);
        },

        async saveRssFeeds() {
            const db = await dbPromise;
            await saveStateValue(db, 'rssFeeds', this.rssFeedsInput);
            createAndShowSaveMessage('RSS Feeds saved!', 'success', 'rss-save-msg');
            this.loading = true;
            await performFullSync(db);
            await this.loadFeedItemsFromDB();
            await validateAndRegenerateCurrentDeck(this);
            this.loading = false;
        },

        async saveKeywordBlacklist() {
            const db = await dbPromise;
            await saveStateValue(db, 'keywordBlacklist', this.keywordBlacklistInput);
            createAndShowSaveMessage('Keyword Blacklist saved!', 'success', 'keywords-save-msg');
            // Keyword blacklist updates affect the `filteredEntries` computed property,
            // so Alpine will react automatically if your UI uses it.
            this.updateCounts(); // Update counts if blacklist affects what's considered "unread"
        }
    }));
});

// Function to convert external URLs to links that open in a new tab
function convertUrlsToLinks(element, openInNewTab) {
  if (!element) return;

  const urlRegex = /(https?:\/\/[^\s]+)/g;

  element.querySelectorAll('*').forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      const newHtml = text.replace(urlRegex, (url) => {
        console.log(`Found URL: ${url}, openInNewTab: ${openInNewTab}`); // Log the URL and the value of openInNewTab
        return `<a href="${url}" target="${openInNewTab === true ? '_blank' : '_self'}" rel="noopener noreferrer">${url}</a>`;
      });

      if (newHtml !== text) {
        const span = document.createElement('span');
        span.innerHTML = newHtml;
        node.replaceWith(span);
      }
    }
  });
}