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
} from './data/database.js';
import { formatDate, mapRawItems, validateAndRegenerateCurrentDeck, loadNextDeck, shuffleFeed } from './helpers/dataUtils.js';
import { toggleStar, toggleHidden, pruneStaleHidden, loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState, setFilterMode, loadFilterMode } from './helpers/userStateUtils.js'; 
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initConfigPanelListeners } from './ui/uiInitializers.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition, createStatusBarMessage } from './ui/uiUpdaters.js';

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


// --- Alpine.js Data Definition ---
// Define the Alpine data component immediately, so Alpine can find it.
// This is crucial: Alpine.data must be called BEFORE Alpine.start()
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
    deckItems: [], // This will be populated by displayCurrentDeck
    _lastFilterHash: '', // For memoization
    _cachedFilteredEntries: null, // For memoization

    // Computed property for filtered entries
    get filteredEntries() {
        // We still check if db is initialized, but this computed property
        // should only be accessed after initApp() has run.
        // The 'db' variable here is the module-level imported db promise/instance.
        if (!db) { // No longer need to check for this.db as db is imported at module scope
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
                filtered = this.entries.filter(e => hiddenMap.has(e.id))
                                     .sort((a, b) => new Date(hiddenMap.get(b.id)).getTime() - new Date(hiddenMap.get(a.id)).getTime());
                break;
            case "starred":
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
    // x-init will call this
    async initApp() {
        console.log('initApp has been called!');
        // Wait for the DB to be initialized before proceeding
        // initDb() is called *outside* this function to ensure DB is ready before Alpine.start().
        // So, 'db' should already be the resolved instance here.
        if (db instanceof Promise) {
             console.warn("app.js: db is still a promise inside initApp. This indicates initDb() outside Alpine.start() might not have fully resolved or been awaited properly.");
             // Potentially re-await here as a fallback, but ideally it's ready.
             await db;
        }
        console.log("app.js: IndexedDB assumed initialized when Alpine.js initApp() starts.");


        try {
            // Load initial settings and user state from DB/localStorage
            // Since 'db' is imported at the module level, we can just use it directly.
            this.syncEnabled = (await loadSimpleState(db, 'syncEnabled')).value;
            this.imagesEnabled = (await loadSimpleState(db, 'imagesEnabled')).value;
            this.openUrlsInNewTabEnabled = (await loadSimpleState(db, 'openUrlsInNewTabEnabled')).value;
            this.filterMode = (await loadFilterMode(db));
            this.isOnline = isOnline();

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

            // Access helper functions directly, as they are imported at module scope
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
                    await manageSettingsPanelVisibility(this); // Use imported function
                    this.rssFeedsInput = (await loadSimpleState(db, 'rssFeeds')).value || '';
                    this.keywordBlacklistInput = (await loadSimpleState(db, 'keywordBlacklist')).value || '';
                } else {
                    await saveCurrentScrollPosition(); // Use imported function
                }
            });
            // Watch for changes to openUrlsInNewTabEnabled to re-apply link handling
            this.$watch('openUrlsInNewTabEnabled', () => {
                // Re-process links in all currently displayed entries
                document.querySelectorAll('.itemdescription').forEach(el => this.handleEntryLinks(el));
            });
            this.$watch("modalView", async () => {
                await manageSettingsPanelVisibility(this); // Use imported function
            });
            this.$watch('syncEnabled', value => saveSimpleState(db, 'syncEnabled', value));
            this.$watch('imagesEnabled', value => saveSimpleState(db, 'imagesEnabled', value));
            this.$watch('rssFeedsInput', value => saveSimpleState(db, 'rssFeeds', value));
            this.$watch('keywordBlacklistInput', value => saveSimpleState(db, 'keywordBlacklist', value));
            this.$watch('filterMode', value => setFilterMode(this, db, value)); // Use imported function
            this.updateCounts(); // Call the local method which wraps the imported function
            await initScrollPosition(this); // Use imported function

            this.loading = false; // Hide loading screen

            // Background sync
            if (this.syncEnabled) {
                setTimeout(async () => {
                    try {
                        console.log("app.js: Initiating background partial sync...");
                        await performFeedSync(db); // Use imported function
                        await pullUserState(db); // Use imported function
                        this.hidden = (await loadArrayState(db, 'hidden')).value;
                        this.starred = (await loadArrayState(db, 'starred')).value;
                        await this.loadFeedItemsFromDB();
                        this.hidden = await pruneStaleHidden(db, this.entries, Date.now()); // Use imported function
                        this.updateCounts();
                        await validateAndRegenerateCurrentDeck(this); // Use imported function
                        console.log("app.js: Background partial sync completed.");
                    } catch (error) {
                        console.error('app.js: Background partial sync failed', error);
                    }
                }, 0); // Use 0 timeout to allow initial render
            }

            attachScrollToTopHandler(); // Use imported function

            // Online/Offline detection and re-sync
            window.addEventListener('online', async () => {
                this.isOnline = true;
                if (this.syncEnabled) {
                    console.log("app.js: Online detected. Processing pending operations and resyncing.");
                    await processPendingOperations(db); // Use imported function
                    await this.loadFeedItemsFromDB();
                    this.hidden = (await loadArrayState(db, 'hidden')).value;
                    this.starred = (await loadArrayState(db, 'starred')).value;
                    this.hidden = await pruneStaleHidden(db, this.entries, Date.now()); // Use imported function
                    this.updateCounts();
                    await validateAndRegenerateCurrentDeck(this); // Use imported function
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
                    await performFeedSync(db); // Use imported function
                    await pullUserState(db); // Use imported function
                    await this.loadFeedItemsFromDB();
                    this.hidden = await pruneStaleHidden(db, this.entries, now); // Use imported function
                    this.updateCounts();
                    await validateAndRegenerateCurrentDeck(this); // Use imported function
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

    // --- Method to handle links within each entry's description ---
    handleEntryLinks(element) {
        if (!element) return;

        const links = element.querySelectorAll('a');

        links.forEach(link => {
            if (link.hostname !== window.location.hostname) {
                if (this.openUrlsInNewTabEnabled) {
                    link.setAttribute('target', '_blank');
                    link.setAttribute('rel', 'noopener noreferrer');
                } else {
                    link.removeAttribute('target');
                    link.removeAttribute('rel');
                }
            }
        });
    },

    // --- Other Alpine.js methods ---

    async loadFeedItemsFromDB() {
        // Ensure db is available before trying to use it
        // 'db' is available at module scope, no need for this.db
        if (!db) {
            console.error("Database not initialized, cannot load feed items.");
            this.entries = [];
            return;
        }
        const rawItemsFromDb = await db.transaction('feedItems', 'readonly').objectStore('feedItems').getAll();
        // Use imported mapRawItems and formatDate directly
        this.entries = mapRawItems(rawItemsFromDb, formatDate);
    },

    // These methods now directly call the imported functions.
    // They act as wrappers, making the imported functions available via `this.` in Alpine expressions.
    updateCounts() {
        updateCounts(this); // Call the imported function
    },

    scrollToTop() {
        scrollToTop(); // Call the imported function
    },

    isStarred(guid) {
        return this.starred.some(e => e.id === guid);
    },
    async toggleStar(guid) {
        await toggleStar(this, guid); // Call the imported function
    },
    isHidden(guid) {
        return this.hidden.some(e => e.id === guid);
    },
    async toggleHidden(guid) {
        console.log("app.js: toggleHidden called with guid:", guid);
        await toggleHidden(this, guid); // Call the imported function
        await validateAndRegenerateCurrentDeck(this); // Call the imported function
    },
    setFilter(mode) {
        this.filterMode = mode;
    },
    async loadNextDeck() {
        await loadNextDeck(this); // Call the imported function
    },

    async shuffleFeed() {
        await shuffleFeed(this); // Call the imported function
    },

    async saveRssFeeds() {
        await saveSimpleState(db, 'rssFeeds', this.rssFeedsInput); // Use imported function
        createStatusBarMessage('RSS Feeds saved!', 'success'); // Use imported function
        this.loading = true; // Show loading
        await performFullSync(db); // Use imported function
        await this.loadFeedItemsFromDB();
        await validateAndRegenerateCurrentDeck(this); // Use imported function
        this.loading = false; // Hide loading
    },

    async saveKeywordBlacklist() {
        await saveSimpleState(db, 'keywordBlacklist', this.keywordBlacklistInput); // Use imported function
        createStatusBarMessage('Keyword Blacklist saved!', 'success'); // Use imported function
        this.updateCounts(); // Call the local method which wraps the imported function
    }
}));

// --- Database Initialization and Alpine.start() ---
// This part is crucial. We must ensure Alpine.start() is called *only once*
// and *after* the `Alpine.data` definition.
// The `initDb()` call should happen here, and then Alpine.start().
// This fixes the "rssApp is not defined" and other similar errors.

(async () => {
    try {
        // Init DB. `db` will be globally available (imported).
        // Await the DB initialization *before* starting Alpine.
        await initDb();
        console.log("app.js: IndexedDB initialized externally before Alpine.start().");
        // Start Alpine.js after the data component is defined and DB is ready.
        // Alpine will then pick up x-data="rssApp" and call its initApp().
        Alpine.start();
    } catch (error) {
        console.error("app.js: Failed to initialize IndexedDB and start Alpine:", error);
        // Fallback for UI if DB init fails
        document.getElementById('loading-screen').textContent = 'Error loading application: ' + error.message;
        document.getElementById('loading-screen').style.display = 'block';
    }
})();