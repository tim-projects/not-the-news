// app.js

// Import necessary modules
// Ensure loadArrayState is imported here
import { 
    db, // --- FIX: Changed from dbPromise to db ---
    performFeedSync, 
    performFullSync, 
    pullUserState, 
    processPendingOperations, 
    saveSimpleState, // --- FIX: Changed from saveStateValue to saveSimpleState ---
    loadSimpleState,  // --- FIX: Changed from loadStateValue to loadSimpleState ---
    loadArrayState, 
    isOnline,
    initDb // --- IMPORTANT: Ensure initDb is imported to be called at startup ---
} from './data/database.js';
import { formatDate, shuffleArray, mapRawItems, validateAndRegenerateCurrentDeck, loadNextDeck, shuffleFeed, displayCurrentDeck } from './helpers/dataUtils.js';
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


// --- Prevent Alpine.js from starting automatically ---
// This line must be added BEFORE you import Alpine.js
// If Alpine.js is imported via a script tag, make sure this is above it.
window.deferAlpine = true; // For Alpine v2, use Alpine.defer = true;

// --- Initialize the database BEFORE Alpine.js starts ---
// This is crucial so that 'db' is available when Alpine.js needs it.
(async () => {
    try {
        await initDb();
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
document.addEventListener('db-initialized', () => { // --- FIX: Listen for custom event ---
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
            // `db` is already initialized and available at the module level due to the IIFE
            // const db = await dbPromise; // REMOVE THIS LINE, db is global and ready

            try {
                // Load initial settings and user state from DB/localStorage
                // These directly update the Alpine data properties
                this.syncEnabled = (await loadSimpleState(db, 'syncEnabled')).value; // --- FIX: Use loadSimpleState correctly ---
                this.imagesEnabled = (await loadSimpleState(db, 'imagesEnabled')).value; // --- FIX ---
                this.openUrlsInNewTabEnabled = (await loadSimpleState(db, 'openUrlsInNewTabEnabled')).value; // --- FIX ---
                this.filterMode = (await loadFilterMode(db)); // loadFilterMode should handle its own defaults
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
                this.hidden = (await loadArrayState(db, 'hidden')).value; // --- FIX: Use loadArrayState correctly ---
                this.starred = (await loadArrayState(db, 'starred')).value; // --- FIX: Use loadArrayState correctly ---

                // Determine sync completion time for pruning stale hidden entries.
                const itemsCount = await db.transaction('feedItems', 'readonly').objectStore('feedItems').count(); // --- FIX: Use 'feedItems' store ---
                let syncCompletionTime = Date.now();
                if (itemsCount === 0 && this.isOnline) {
                     const { feedTime } = await performFullSync(db);
                     syncCompletionTime = feedTime;
                     if (this.syncEnabled && this.isOnline) {
                         await pullUserState(db);
                         this.hidden = (await loadArrayState(db, 'hidden')).value; // --- FIX ---
                         this.starred = (await loadArrayState(db, 'starred')).value; // --- FIX ---
                     }
                     await this.loadFeedItemsFromDB();
                }
                this.hidden = await pruneStaleHidden(db, this.entries, syncCompletionTime);

                this.currentDeckGuids = await loadCurrentDeck(db);

                await validateAndRegenerateCurrentDeck(this);

                const { shuffleCount, lastShuffleResetDate } = await loadShuffleState(db);
                const today = new Date();
                today.setHours(0,0,0,0);
                if (lastShuffleResetDate && new Date(lastShuffleResetDate).toDateString() === today.toDateString()) {
                    this.shuffleCount = shuffleCount;
                } else {
                    this.shuffleCount = 2;
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
                        this.rssFeedsInput = (await loadSimpleState(db, 'rssFeeds')).value || ''; // --- FIX ---
                        this.keywordBlacklistInput = (await loadSimpleState(db, 'keywordBlacklist')).value || ''; // --- FIX ---
                    } else {
                        await saveCurrentScrollPosition();
                    }
                });
                this.$watch("modalView", async () => {
                    await manageSettingsPanelVisibility(this);
                });
                this.$watch('syncEnabled', value => saveSimpleState(db, 'syncEnabled', value)); // --- FIX ---
                this.$watch('imagesEnabled', value => saveSimpleState(db, 'imagesEnabled', value)); // --- FIX ---
                this.$watch('openUrlsInNewTabEnabled', value => saveSimpleState(db, 'openUrlsInNewTabEnabled', value)); // --- FIX ---
                this.$watch('rssFeedsInput', value => saveSimpleState(db, 'rssFeeds', value)); // --- FIX ---
                this.$watch('keywordBlacklistInput', value => saveSimpleState(db, 'keywordBlacklist', value)); // --- FIX ---
                this.$watch('filterMode', value => setFilterMode(this, db, value));
                this.updateCounts();
                await initScrollPosition(this);

                await this.convertUrlsInEntries();

                this.loading = false;

                if (this.syncEnabled) {
                    setTimeout(async () => {
                        try {
                            console.log("app.js: Initiating background partial sync...");
                            await performFeedSync(db);
                            await pullUserState(db);
                            this.hidden = (await loadArrayState(db, 'hidden')).value; // --- FIX ---
                            this.starred = (await loadArrayState(db, 'starred')).value; // --- FIX ---
                            await this.loadFeedItemsFromDB();
                            this.hidden = await pruneStaleHidden(db, this.entries, Date.now());
                            this.updateCounts();
                            await validateAndRegenerateCurrentDeck(this);
                            console.log("app.js: Background partial sync completed.");
                            await this.convertUrlsInEntries();
                        } catch (error) {
                            console.error('app.js: Background partial sync failed', error);
                        }
                    }, 0);
                }

                attachScrollToTopHandler();

                window.addEventListener('online', async () => {
                    this.isOnline = true;
                    if (this.syncEnabled) {
                        console.log("app.js: Online detected. Processing pending operations and resyncing.");
                        await processPendingOperations(db);
                        await this.loadFeedItemsFromDB();
                        this.hidden = (await loadArrayState(db, 'hidden')).value; // --- FIX ---
                        this.starred = (await loadArrayState(db, 'starred')).value; // --- FIX ---
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

                let lastActivityTimestamp = Date.now();
                const recordActivity = () => { lastActivityTimestamp = Date.now(); };
                ["mousemove", "mousedown", "keydown", "scroll", "click"].forEach(event => document.addEventListener(event, recordActivity, true));
                document.addEventListener("visibilitychange", recordActivity, true);
                window.addEventListener("focus", recordActivity, true);

                const SYNC_INTERVAL_MS = 5 * 60 * 1000;
                const INACTIVITY_TIMEOUT_MS = 60 * 1000;

                setInterval(async () => {
                    const now = Date.now();
                    if (!this.isOnline || this.openSettings || !this.syncEnabled || document.hidden || (now - lastActivityTimestamp) > INACTIVITY_TIMEOUT_MS) {
                        return;
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
                        await this.convertUrlsInEntries();
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

        // --- Convert URLs to links based on setting ---
        async convertUrlsInEntries() {
            const entriesContainer = document.getElementById('items');
            if (entriesContainer) {
                convertUrlsToLinks(entriesContainer, this.openUrlsInNewTabEnabled);
            }
        },

        // --- Alpine.js methods ---

        async loadFeedItemsFromDB() {
            // `db` is already initialized and available globally after initDb()
            const rawItemsFromDb = await db.transaction('feedItems', 'readonly').objectStore('feedItems').getAll(); // --- FIX: Use 'feedItems' store ---
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
            // `db` is already initialized and available globally
            await saveSimpleState(db, 'rssFeeds', this.rssFeedsInput); // --- FIX ---
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true;
            await performFullSync(db);
            await this.loadFeedItemsFromDB();
            await validateAndRegenerateCurrentDeck(this);
            this.loading = false;
        },

        async saveKeywordBlacklist() {
            // `db` is already initialized and available globally
            await saveSimpleState(db, 'keywordBlacklist', this.keywordBlacklistInput); // --- FIX ---
            createStatusBarMessage('Keyword Blacklist saved!', 'success');
            this.updateCounts();
        }
    }));
    Alpine.start();
}); // --- FIX: Closing Alpine.js Initialization listener ---


// Function to convert external URLs to links that open in a new tab
function convertUrlsToLinks(element, openInNewTab) {
  if (!element) return;

  const urlRegex = /(https?:\/\/[^\s]+)/g;

  element.querySelectorAll('*').forEach(node => {
    if (node.nodeType === Node.TEXT_NODE && node.parentNode.tagName.toLowerCase() !== 'a') {
      const text = node.textContent;
      const newHtml = text.replace(urlRegex, (url) => {
        const target = openInNewTab === true ? '_blank' : '_self';
        return `<a href="${url}" target="${target}" rel="noopener noreferrer">${url}</a>`;
      });

      if (newHtml !== text) {
        const span = document.createElement('span');
        span.innerHTML = newHtml;
        node.replaceWith(span);
      }
    }
  });
}