// app.js

// Import necessary modules
import {
    performFeedSync,
    performFullSync, // This function is now a placeholder and won't return feedTime
    pullUserState,
    processPendingOperations,
    loadSimpleState,
    loadArrayState,
    getBufferedChangesCount,
    isOnline,
    initDb
} from './data/database.js';
import { formatDate, mapRawItems, validateAndRegenerateCurrentDeck, loadNextDeck, shuffleFeed } from './helpers/dataUtils.js';
import { toggleStar, toggleHidden, pruneStaleHidden, loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState, setFilterMode, loadFilterMode } from './helpers/userStateUtils.js';
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initShuffleCount, initConfigPanelListeners } from './ui/uiInitializers.js';
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
// Define the Alpine data component inside 'alpine:init' event listener.
// This event fires AFTER Alpine.js has loaded and is ready (when loaded via <script defer>).
document.addEventListener('alpine:init', () => {
    // Add a check to confirm Alpine is available globally.
    // window.Alpine will be available because of the <script defer> in index.html.
    if (typeof window.Alpine === 'undefined') {
        console.error("CRITICAL ERROR: window.Alpine is undefined inside alpine:init event listener. Alpine.js might not have loaded correctly.");
        // You might want to display a user-friendly error message here
        document.getElementById('loading-screen').textContent = 'Error: Alpine.js failed to load.';
        document.getElementById('loading-screen').style.display = 'block';
        return; // Stop execution if Alpine isn't there
    }
    console.log("app.js: 'alpine:init' event fired. Defining 'rssApp' component.");

    window.Alpine.data('rssApp', () => ({
        db: null, // This will hold the IndexedDB instance
        scrollObserver: null,
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
            // IMPORTANT: Use 'this.db' to refer to the database instance within the Alpine component's data.
            if (!this.db || this.db instanceof Promise) {
                console.warn("db not initialized or still a promise, cannot filter entries yet.");
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
            console.log('initApp has been called from x-init!');

            try {
                // Initialize DB inside initApp, now that Alpine is ready
                // This will resolve the 'db' variable at module scope.
                this.db = await initDb(); // Assign the initialized DB instance to 'this.db'
                console.log("app.js: IndexedDB initialized within initApp().");

                // Load initial settings and user state from DB/localStorage
                this.syncEnabled = (await loadSimpleState(this.db, 'syncEnabled')).value;
                this.imagesEnabled = (await loadSimpleState(this.db, 'imagesEnabled')).value;
                this.openUrlsInNewTabEnabled = (await loadSimpleState(this.db, 'openUrlsInNewTabEnabled')).value;
                this.filterMode = (await loadFilterMode(this.db));
                this.isOnline = isOnline();

                // --- Attempt to pull user state (including current deck) from server early ---
                if (this.syncEnabled && this.isOnline) {
                    try {
                        console.log("app.js: Attempting early pull of user state (including current deck) from server...");
                        await pullUserState(this.db);
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
                this.hidden = (await loadArrayState(this.db, 'hidden')).value;
                this.starred = (await loadArrayState(this.db, 'starred')).value;

                // Determine sync completion time for pruning stale hidden entries.
                const itemsCount = await this.db.transaction('feedItems', 'readonly').objectStore('feedItems').count();
                let syncCompletionTime = Date.now(); // Default to current time

                if (itemsCount === 0 && this.isOnline) {
                     // performFullSync is a placeholder and doesn't return feedTime
                     await performFullSync(this.db);
                     // Set syncCompletionTime after the full sync completes, suitable for pruneStaleHidden
                     syncCompletionTime = Date.now();

                     if (this.syncEnabled && this.isOnline) {
                         await pullUserState(this.db);
                         this.hidden = (await loadArrayState(this.db, 'hidden')).value;
                         this.starred = (await loadArrayState(this.db, 'starred')).value;
                     }
                     await this.loadFeedItemsFromDB();
                }
                this.hidden = await pruneStaleHidden(this.db, this.entries, syncCompletionTime);

                this.currentDeckGuids = await loadCurrentDeck(this.db);

                // Access helper functions directly, as they are imported at module scope
                await validateAndRegenerateCurrentDeck(this);

                const { shuffleCount, lastShuffleResetDate } = await loadShuffleState(this.db);
                const today = new Date();
                today.setHours(0,0,0,0); // Normalize to start of day
                if (lastShuffleResetDate && new Date(lastShuffleResetDate).toDateString() === today.toDateString()) {
                    this.shuffleCount = shuffleCount;
                } else {
                    this.shuffleCount = 2; // Reset daily shuffle count
                    await saveShuffleState(this.db, 2, today);
                }

                // Initialize UI components and their listeners
                initTheme(this, this.db);
                initSyncToggle(this, this.db);
                initImagesToggle(this, this.db);
                initShuffleCount(this, this.db);
                initConfigPanelListeners(this);

                this.$watch("openSettings", async (isOpen) => {
                    if (isOpen) {
                        this.modalView = 'main';
                        await manageSettingsPanelVisibility(this); // Use imported function
                        this.rssFeedsInput = (await loadSimpleState(this.db, 'rssFeeds')).value || '';
                        this.keywordBlacklistInput = (await loadSimpleState(this.db, 'keywordBlacklist')).value || '';
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
                this.$watch('syncEnabled', value => saveSimpleState(this.db, 'syncEnabled', value));
                this.$watch('imagesEnabled', value => saveSimpleState(this.db, 'imagesEnabled', value));
                this.$watch('rssFeedsInput', value => saveSimpleState(this.db, 'rssFeeds', value));
                this.$watch('keywordBlacklistInput', value => saveSimpleState(this.db, 'keywordBlacklist', value));
                this.$watch('filterMode', value => setFilterMode(this, this.db, value)); // Use imported function
                this.updateCounts(); // Call the local method which wraps the imported function
                await initScrollPosition(this, this.db); // Use imported function

                this.loading = false; // Hide loading screen

                // Background sync
                if (this.syncEnabled) {
                    setTimeout(async () => {
                        try {
                            console.log("app.js: Initiating background partial sync...");
                            await performFeedSync(this.db); // Use imported function
                            await pullUserState(this.db); // Use imported function
                            this.hidden = (await loadArrayState(this.db, 'hidden')).value;
                            this.starred = (await loadArrayState(this.db, 'starred')).value;
                            await this.loadFeedItemsFromDB();
                            this.hidden = await pruneStaleHidden(this.db, this.entries, Date.now()); // Use imported function
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
                        await processPendingOperations(this.db); // Use imported function
                        await this.loadFeedItemsFromDB();
                        this.hidden = (await loadArrayState(this.db, 'hidden')).value;
                        this.starred = (await loadArrayState(this.db, 'starred')).value;
                        this.hidden = await pruneStaleHidden(this.db, this.entries, Date.now()); // Use imported function
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
                        await performFeedSync(this.db); // Use imported function
                        await pullUserState(this.db); // Use imported function
                        await this.loadFeedItemsFromDB();
                        this.hidden = await pruneStaleHidden(this.db, this.entries, now); // Use imported function
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
        initScrollObserver() {
            const observer = new IntersectionObserver(async (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const guid = entry.target.dataset.guid;
                        if (guid) {
                            console.log(`Saving scroll position for guid: ${guid}`);
                            await saveSimpleState(this.db, `scrollPosition-${guid}`, entry.boundingClientRect.y);
                        }
                    }
                }
            }, {
                root: document.querySelector('#feed-container'),
                rootMargin: '0px',
                threshold: 0.1
            });

            const feedContainer = document.querySelector('#feed-container');

            // Function to observe all elements with data-guid
            const observeElements = () => {
                feedContainer.querySelectorAll('[data-guid]').forEach(item => {
                    observer.observe(item);
                });
            };

            // Initial observation
            observeElements();

            // MutationObserver to re-observe elements if the feed container's children change
            const mutationObserver = new MutationObserver(mutations => {
                console.log('Mutation detected in feed-container. Re-observing elements.');
                observer.disconnect(); // Stop observing everything
                observeElements(); // Re-observe
            });

            mutationObserver.observe(feedContainer, { childList: true, subtree: true });

            this.scrollObserver = observer; // Store the observer instance
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
            if (!this.db) {
                console.error("Database not initialized or still a promise, cannot load feed items.");
                this.entries = [];
                return;
            }
            const rawItemsFromDb = await this.db.transaction('feedItems', 'readonly').objectStore('feedItems').getAll();
            // Use imported mapRawItems and formatDate directly
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
            await saveSimpleState(this.db, 'rssFeeds', this.rssFeedsInput);
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true;
            await performFullSync(this.db);
            await this.loadFeedItemsFromDB();
            await validateAndRegenerateCurrentDeck(this);
            this.loading = false;
        },

        async saveKeywordBlacklist() {
            await saveSimpleState(this.db, 'keywordBlacklist', this.keywordBlacklistInput);
            createStatusBarMessage('Keyword Blacklist saved!', 'success');
            this.updateCounts();
        }
    }));
});