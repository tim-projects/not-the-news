// app.js

// Import necessary modules
import {
    db, // db is the promise that resolves to the actual IDBDatabase instance
    performFeedSync,
    performFullSync,
    pullUserState,
    processPendingOperations,
    saveSimpleState,
    loadSimpleState,
    loadArrayState,
    isOnline,
    initDb
} from './data/database.js'; // Ensure this path is correct
import { formatDate, mapRawItems, validateAndRegenerateCurrentDeck, loadNextDeck, shuffleFeed } from './helpers/dataUtils.js'; // Removed displayCurrentDeck from here as it's not directly used in Alpine data
import { toggleStar, toggleHidden, pruneStaleHidden, loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState, setFilterMode, loadFilterMode } from './helpers/userStateUtils.js'; // Ensure these are correctly implemented
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initConfigPanelListeners } from './ui/uiInitializers.js'; // Ensure these are correctly implemented
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition, createStatusBarMessage } from './ui/uiUpdaters.js'; // Ensure these are correctly implemented


// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(reg => {
                console.log('app.js: Service Worker registered:', reg.scope);

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'activated' && !navigator.serviceWorker.controller) {
                                console.log('app.js: New Service Worker activated, but not yet controlling. Reloading...');
                                window.location.reload();
                            }
                        });
                    }
                });
            })
            .catch(error => console.warn('app.js: Service Worker registration failed:', error));
    });
}

// Global event listener for image loading (outside Alpine.js app)
document.addEventListener("load", e => {
    if (e.target?.tagName?.toLowerCase() === "img") {
        e.target.classList.add("loaded");
    }
}, true);


// --- Initialize the database BEFORE Alpine.js starts ---
// This is crucial so that 'db' is available when Alpine.js needs it.
(async () => {
    try {
        await initDb(); // initDb resolves with the db instance, and 'db' is imported as that instance
        console.log("app.js: IndexedDB initialized successfully before Alpine.js.");
        // Now that DB is open, proceed with Alpine.js initialization
        document.dispatchEvent(new CustomEvent('db-initialized')); // Custom event to signal DB readiness
    } catch (error) {
        console.error("app.js: Failed to initialize IndexedDB:", error);
        // Handle database initialization failure (e.g., show error to user)
    }
})();


// Alpine.js Initialization
// We'll listen for the custom 'db-initialized' event before setting up Alpine
document.addEventListener('db-initialized', () => {
    Alpine.data('rssApp', () => ({
        // --- Alpine.js Reactive properties with initial defaults ---
        loading: true, // Start as true, set to false after initApp completes
        filterMode: 'unread',
        openSettings: false,
        modalView: 'main',
        shuffleCount: 0, // Will be loaded from DB
        syncEnabled: true, // Will be loaded from DB
        imagesEnabled: true, // Will be loaded from DB
        openUrlsInNewTabEnabled: true, // Will be loaded from DB
        rssFeedsInput: '', // Will be loaded from DB
        keywordBlacklistInput: '', // Will be loaded from DB
        entries: [],
        hidden: [],
        starred: [],
        currentDeckGuids: [],
        errorMessage: '',
        isOnline: isOnline(), // Initialize with current online status
        // deckItems: [], // This is typically populated by filteredEntries
        _lastFilterHash: '', // For memoization
        _cachedFilteredEntries: null, // For memoization

        // Computed property for filtered entries
        get filteredEntries() {
            // Check if db is initialized before proceeding
            if (!db) {
                console.warn("db not initialized, cannot filter entries yet.");
                return [];
            }

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
                    // Only include items that are both in entries and hidden, and sort by hiddenAt
                    filtered = this.entries.filter(e => hiddenMap.has(e.id))
                                         .sort((a, b) => new Date(hiddenMap.get(b.id)).getTime() - new Date(hiddenMap.get(a.id)).getTime());
                    break;
                case "starred":
                    // Only include items that are both in entries and starred, and sort by starredAt
                    filtered = this.entries.filter(e => starredMap.has(e.id))
                                         .sort((a, b) => new Date(starredMap.get(b.id)).getTime() - new Date(starredMap.get(a.id)).getTime());
                    break;
                default:
                    filtered = this.entries;
                    break;
            }

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
            try {
                // Load initial settings and user state from DB/localStorage
                this.syncEnabled = (await loadSimpleState(db, 'syncEnabled')).value;
                this.imagesEnabled = (await loadSimpleState(db, 'imagesEnabled')).value;
                this.openUrlsInNewTabEnabled = (await loadSimpleState(db, 'openUrlsInNewTabEnabled')).value;
                this.filterMode = (await loadFilterMode(db));
                this.isOnline = isOnline(); // Set initial online status

                // --- Attempt to pull user state (including current deck) from server early ---
                if (this.syncEnabled && this.isOnline) {
                    try {
                        console.log("app.js: Attempting early pull of user state (including current deck) from server...");
                        await pullUserState(db);
                        console.log("app.js: Early user state pull completed.");
                    } catch (error) {
                        console.warn("app.js: Early pullUserState failed, proceeding with local state. Error:", error);
                        if (error instanceof SyntaxError && error.message.includes('Unexpected end of JSON input')) {
                            console.error("app.js: Failed to parse user state JSON. The server likely sent incomplete or malformed data.");
                        }
                    }
                }

                // Load feed items from DB (populates this.entries).
                await this.loadFeedItemsFromDB();

                // Load hidden and starred states from local DB. These might have been updated by early pullUserState.
                this.hidden = (await loadArrayState(db, 'hidden')).value;
                this.starred = (await loadArrayState(db, 'starred')).value;

                // Determine sync completion time for pruning stale hidden entries.
                const itemsCount = await db.transaction('feedItems', 'readonly').objectStore('feedItems').count();
                let syncCompletionTime = Date.now();
                if (itemsCount === 0 && this.isOnline) {
                     const { feedTime } = await performFullSync(db);
                     syncCompletionTime = feedTime;
                     if (this.syncEnabled && this.isOnline) {
                         await pullUserState(db);
                         this.hidden = (await loadArrayState(db, 'hidden')).value;
                         this.starred = (await loadArrayState(db, 'starred')).value;
                     }
                     await this.loadFeedItemsFromDB();
                }
                this.hidden = await pruneStaleHidden(db, this.entries, syncCompletionTime);

                this.currentDeckGuids = await loadCurrentDeck(db);

                await validateAndRegenerateCurrentDeck(this);

                const { shuffleCount, lastShuffleResetDate } = await loadShuffleState(db);
                const today = new Date();
                today.setHours(0,0,0,0); // Normalize to start of day
                if (lastShuffleResetDate && new Date(lastShuffleResetDate).toDateString() === today.toDateString()) {
                    this.shuffleCount = shuffleCount;
                } else {
                    this.shuffleCount = 2; // Reset daily shuffle count
                    await saveShuffleState(db, 2, today);
                }

                // Initialize UI components and their listeners
                initTheme(this);
                initSyncToggle(this);
                initImagesToggle(this);
                initConfigPanelListeners(this);

                this.$watch("openSettings", async (isOpen) => {
                    if (isOpen) {
                        this.modalView = 'main';
                        await manageSettingsPanelVisibility(this);
                        this.rssFeedsInput = (await loadSimpleState(db, 'rssFeeds')).value || '';
                        this.keywordBlacklistInput = (await loadSimpleState(db, 'keywordBlacklist')).value || '';
                    } else {
                        await saveCurrentScrollPosition();
                    }
                });
                // Watch for changes to openUrlsInNewTabEnabled to re-apply link handling
                this.$watch('openUrlsInNewTabEnabled', () => {
                    // Re-process links in all currently displayed entries
                    document.querySelectorAll('.itemdescription').forEach(el => this.handleEntryLinks(el));
                });
                this.$watch("modalView", async () => {
                    await manageSettingsPanelVisibility(this);
                });
                this.$watch('syncEnabled', value => saveSimpleState(db, 'syncEnabled', value));
                this.$watch('imagesEnabled', value => saveSimpleState(db, 'imagesEnabled', value));
                this.$watch('rssFeedsInput', value => saveSimpleState(db, 'rssFeeds', value));
                this.$watch('keywordBlacklistInput', value => saveSimpleState(db, 'keywordBlacklist', value));
                this.$watch('filterMode', value => setFilterMode(this, db, value));
                this.updateCounts();
                await initScrollPosition(this);

                this.loading = false; // Hide loading screen

                // Background sync
                if (this.syncEnabled) {
                    setTimeout(async () => {
                        try {
                            console.log("app.js: Initiating background partial sync...");
                            await performFeedSync(db);
                            await pullUserState(db);
                            this.hidden = (await loadArrayState(db, 'hidden')).value;
                            this.starred = (await loadArrayState(db, 'starred')).value;
                            await this.loadFeedItemsFromDB();
                            this.hidden = await pruneStaleHidden(db, this.entries, Date.now());
                            this.updateCounts();
                            await validateAndRegenerateCurrentDeck(this);
                            console.log("app.js: Background partial sync completed.");
                        } catch (error) {
                            console.error('app.js: Background partial sync failed', error);
                        }
                    }, 0); // Use 0 timeout to allow initial render
                }

                attachScrollToTopHandler();

                // Online/Offline detection and re-sync
                window.addEventListener('online', async () => {
                    this.isOnline = true;
                    if (this.syncEnabled) {
                        console.log("app.js: Online detected. Processing pending operations and resyncing.");
                        await processPendingOperations(db);
                        await this.loadFeedItemsFromDB();
                        this.hidden = (await loadArrayState(db, 'hidden')).value;
                        this.starred = (await loadArrayState(db, 'starred')).value;
                        this.hidden = await pruneStaleHidden(db, this.entries, Date.now());
                        this.updateCounts();
                        await validateAndRegenerateCurrentDeck(this);
                        console.log("app.js: Online resync completed.");
                    }
                });
                window.addEventListener('offline', () => {
                    this.isOnline = false;
                    console.warn("app.js: Offline detected. Syncing disabled.");
                });

                // Periodic sync based on activity
                let lastActivityTimestamp = Date.now();
                const recordActivity = () => { lastActivityTimestamp = Date.now(); };
                ["mousemove", "mousedown", "keydown", "scroll", "click"].forEach(event => document.addEventListener(event, recordActivity, true));
                document.addEventListener("visibilitychange", recordActivity, true);
                window.addEventListener("focus", recordActivity, true);

                const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
                const INACTIVITY_TIMEOUT_MS = 60 * 1000; // 1 minute

                setInterval(async () => {
                    const now = Date.now();
                    if (!this.isOnline || this.openSettings || !this.syncEnabled || document.hidden || (now - lastActivityTimestamp) > INACTIVITY_TIMEOUT_MS) {
                        return; // Skip sync if conditions not met
                    }
                    try {
                        console.log("app.js: Performing periodic background sync...");
                        await performFeedSync(db);
                        await pullUserState(db);
                        await this.loadFeedItemsFromDB();
                        this.hidden = await pruneStaleHidden(db, this.entries, now);
                        this.updateCounts();
                        await validateAndRegenerateCurrentDeck(this);
                        console.log("app.js: Periodic background sync completed.");
                    } catch (error) {
                        console.error("app.js: Periodic sync failed", error);
                    }
                }, SYNC_INTERVAL_MS);

            } catch (error) {
                console.error("app.js: Initialization failed:", error);
                this.errorMessage = "Could not load feed: " + error.message;
                this.loading = false;
            }
        },

        // --- New method to handle links within each entry's description ---
        handleEntryLinks(element) {
            // This function is called by x-init on the .itemdescription element
            // `element` refers to the specific .itemdescription div
            if (!element) return;

            // Query for all anchor tags within this specific description element
            const links = element.querySelectorAll('a');

            links.forEach(link => {
                // Check if the link is external (optional, but good practice)
                if (link.hostname !== window.location.hostname) {
                    if (this.openUrlsInNewTabEnabled) {
                        link.setAttribute('target', '_blank');
                        // Add rel="noopener noreferrer" for security and performance
                        link.setAttribute('rel', 'noopener noreferrer');
                    } else {
                        link.removeAttribute('target');
                        link.removeAttribute('rel');
                    }
                }
            });
        },


        // --- Alpine.js methods ---

        async loadFeedItemsFromDB() {
            const rawItemsFromDb = await db.transaction('feedItems', 'readonly').objectStore('feedItems').getAll();
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
        },
        isHidden(guid) {
            return this.hidden.some(e => e.id === guid);
        },
        async toggleHidden(guid) {
            console.log("app.js: toggleHidden called with guid:", guid);
            await toggleHidden(this, guid);
            await validateAndRegenerateCurrentDeck(this);
        },
        setFilter(mode) {
            this.filterMode = mode;
        },
        async loadNextDeck() {
            await loadNextDeck(this);
        },

        async shuffleFeed() {
            await shuffleFeed(this);
        },

        async saveRssFeeds() {
            await saveSimpleState(db, 'rssFeeds', this.rssFeedsInput);
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true; // Show loading
            await performFullSync(db);
            await this.loadFeedItemsFromDB();
            await validateAndRegenerateCurrentDeck(this);
            this.loading = false; // Hide loading
        },

        async saveKeywordBlacklist() {
            await saveSimpleState(db, 'keywordBlacklist', this.keywordBlacklistInput);
            createStatusBarMessage('Keyword Blacklist saved!', 'success');
            this.updateCounts(); // Update counts if blacklist changes
        }
    }));
    Alpine.start(); // Manually start Alpine after everything is defined
});