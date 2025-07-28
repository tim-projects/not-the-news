import {
    performFeedSync,
    performFullSync,
    pullUserState,
    processPendingOperations,
    loadSimpleState,
    loadArrayState,
    isOnline,
    initDb,
    saveSimpleState // Import saveSimpleState, as it was missing for some watches
} from './data/database.js';
import { loadConfigFile, saveConfigFile } from './helpers/apiUtils.js';
import { formatDate, mapRawItems, validateAndRegenerateCurrentDeck, loadNextDeck, shuffleFeed } from './helpers/dataUtils.js';
import { toggleStar, toggleHidden, pruneStaleHidden, loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState, setFilterMode, loadFilterMode } = from './helpers/userStateUtils.js';
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initShuffleCount, initConfigPanelListeners } from './ui/uiInitializers.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition, createStatusBarMessage } from './ui/uiUpdaters.js';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(reg => {
                console.log('Service Worker registered:', reg.scope);

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'activated' && !navigator.serviceWorker.controller) {
                                console.log('New Service Worker activated, but not yet controlling. Reloading...');
                                window.location.reload();
                            }
                        });
                    }
                });
            })
            .catch(error => console.warn('Service Worker registration failed:', error));
    });
}

document.addEventListener("load", e => {
    if (e.target?.tagName?.toLowerCase() === "img") {
        e.target.classList.add("loaded");
    }
}, true);

document.addEventListener('alpine:init', () => {
    if (typeof window.Alpine === 'undefined') {
        console.error("CRITICAL ERROR: window.Alpine is undefined inside alpine:init event listener. Alpine.js might not have loaded correctly.");
        document.getElementById('loading-screen').textContent = 'Error: Alpine.js failed to load.';
        document.getElementById('loading-screen').style.display = 'block';
        return;
    }
    console.log("'alpine:init' event fired. Defining 'rssApp' component.");

    window.Alpine.data('rssApp', () => ({
        // Add new property to manage application initialization state
        appInitialized: false, // <-- Added this line
        scrollObserver: null,
        loading: true,
        filterMode: 'unread',
        openSettings: false,
        modalView: 'main',
        shuffleCount: 0,
        syncEnabled: true,
        imagesEnabled: true,
        openUrlsInNewTabEnabled: true,
        rssFeedsInput: '',
        keywordBlacklistInput: '',
        entries: [],
        hidden: [],
        starred: [],
        currentDeckGuids: [],
        errorMessage: '',
        isOnline: isOnline(),
        deckItems: [],
        _lastFilterHash: '',
        _cachedFilteredEntries: null,

        get filteredEntries() {
            if (!this.db) { // Changed from if (!this.db || this.db instanceof Promise) to if (!this.db)
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

        async initApp() {
            console.log('initApp has been called from x-init!');

            try {
                this.db = await initDb(); // Ensure this is awaited first
                console.log("IndexedDB initialized within initApp().");

                this.syncEnabled = (await loadSimpleState('syncEnabled')).value;
                this.imagesEnabled = (await loadSimpleState('imagesEnabled')).value;
                this.openUrlsInNewTabEnabled = (await loadSimpleState('openUrlsInNewTabEnabled')).value;
                this.filterMode = (await loadFilterMode());
                this.isOnline = isOnline();

                if (this.syncEnabled && this.isOnline) {
                    try {
                        console.log("Attempting early pull of user state (including current deck) from server...");
                        await pullUserState();
                        console.log("Early user state pull completed.");
                    } catch (error) {
                        console.warn("Early pullUserState failed, proceeding with local state. Error:", error);
                        if (error instanceof SyntaxError && error.message.includes('Unexpected end of JSON input')) {
                            console.error("Failed to parse user state JSON. The server likely sent incomplete or malformed data.");
                        }
                    }
                }

                await this.loadFeedItemsFromDB();

                this.hidden = (await loadArrayState('hidden')).value;
                this.starred = (await loadArrayState('starred')).value;

                const itemsCount = await this.db.transaction('feedItems', 'readonly').objectStore('feedItems').count();
                let lastFeedSyncServerTime;

                if (itemsCount === 0 && this.isOnline) {
                     await performFullSync();
                     // Read from DB after full sync (which calls performFeedSync internally).
                     lastFeedSyncServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();
                     
                     if (this.syncEnabled && this.isOnline) {
                         await pullUserState();
                         this.hidden = (await loadArrayState('hidden')).value;
                         this.starred = (await loadArrayState('starred')).value;
                     }
                     await this.loadFeedItemsFromDB();
                }

                // Use lastFeedSyncServerTime directly
                this.hidden = await pruneStaleHidden(this.entries, lastFeedSyncServerTime);

                this.currentDeckGuids = await loadCurrentDeck();

                await validateAndRegenerateCurrentDeck(this);

                const { shuffleCount, lastShuffleResetDate } = await loadShuffleState();
                const today = new Date();
                today.setHours(0,0,0,0);
                if (lastShuffleResetDate && new Date(lastShuffleResetDate).toDateString() === today.toDateString()) {
                    this.shuffleCount = shuffleCount;
                } else {
                    this.shuffleCount = 2;
                    await saveShuffleState(2, today);
                }

                initTheme(this);
                initSyncToggle(this);
                initImagesToggle(this);
                initShuffleCount(this);
                initConfigPanelListeners(this);

                this.$watch("openSettings", async (isOpen) => {
                    if (isOpen) {
                        this.modalView = 'main';
                        await manageSettingsPanelVisibility(this);
                        try {
                            this.rssFeedsInput = (await loadConfigFile('rssFeeds.txt')).content || '';
                        } catch (e) {
                            console.warn("Failed to load rssFeeds.txt from server, falling back to local storage:", e);
                            this.rssFeedsInput = (await loadSimpleState('rssFeeds')).value || '';
                        }
                        try {
                            this.keywordBlacklistInput = (await loadConfigFile('keywordBlacklist.txt')).content || '';
                        }
                        catch (e) {
                            console.warn("Failed to load keywordBlacklist.txt from server, falling back to local storage:", e);
                            this.keywordBlacklistInput = (await loadSimpleState('keywordBlacklist')).value || '';
                        }
                    } else {
                        await saveCurrentScrollPosition();
                    }
                });
                this.$watch('openUrlsInNewTabEnabled', () => {
                    document.querySelectorAll('.itemdescription').forEach(el => this.handleEntryLinks(el));
                });
                this.$watch("modalView", async () => {
                    await manageSettingsPanelVisibility(this);
                });
                this.$watch('syncEnabled', value => saveSimpleState('syncEnabled', value));
                this.$watch('imagesEnabled', value => saveSimpleState('imagesEnabled', value));
                this.$watch('filterMode', value => setFilterMode(this, value));
                this.updateCounts();
                await initScrollPosition(this);

                this.loading = false;
                this.appInitialized = true; // <-- Added this line

                if (this.syncEnabled) {
                    setTimeout(async () => {
                        try {
                            console.log("Initiating background partial sync...");
                            // --- MODIFIED: Adjust performFeedSync call for serverTime retrieval ---
                            await performFeedSync(this); 
                            const currentFeedServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();
                            
                            await pullUserState();
                            this.hidden = (await loadArrayState('hidden')).value;
                            this.starred = (await loadArrayState('starred')).value;
                            await this.loadFeedItemsFromDB();
                            this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                            this.updateCounts();
                            await validateAndRegenerateCurrentDeck(this);
                            console.log("Background partial sync completed.");
                        } catch (error) {
                            console.error('Background partial sync failed', error);
                        }
                    }, 0);
                }

                attachScrollToTopHandler();

                window.addEventListener('online', async () => {
                    this.isOnline = true;
                    if (this.syncEnabled) {
                        console.log("Online detected. Processing pending operations and resyncing.");
                        await processPendingOperations();
                        // --- MODIFIED: Adjust performFeedSync call for online re-sync ---
                        await performFeedSync(this);
                        const currentFeedServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                        await pullUserState();
                        this.hidden = (await loadArrayState('hidden')).value;
                        this.starred = (await loadArrayState('starred')).value;
                        await this.loadFeedItemsFromDB();
                        this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                        this.updateCounts();
                        await validateAndRegenerateCurrentDeck(this);
                        console.log("Online resync completed.");
                    }
                });
                window.addEventListener('offline', () => {
                    this.isOnline = false;
                    console.warn("Offline detected. Syncing disabled.");
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
                        console.log("Performing periodic background sync...");
                        // --- MODIFIED: Adjust performFeedSync call for periodic sync ---
                        await performFeedSync(this);
                        const currentFeedServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                        await pullUserState();
                        await this.loadFeedItemsFromDB();
                        this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                        this.updateCounts();
                        await validateAndRegenerateCurrentDeck(this);
                        console.log("Periodic background sync completed.");
                    } catch (error) {
                        console.error("Periodic sync failed", error);
                    }
                }, SYNC_INTERVAL_MS);

            } catch (error) {
                console.error("Initialization failed:", error);
                this.errorMessage = "Could not load feed: " + error.message;
                this.loading = false;
                this.appInitialized = true; // <-- Also set to true on error to avoid indefinite loading
            }
        },
        initScrollObserver() {
            const observer = new IntersectionObserver(async (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const guid = entry.target.dataset.guid;
                        if (guid) {
                            console.log(`Saving scroll position for guid: ${guid}`);
                            await saveSimpleState(`scrollPosition-${guid}`, entry.boundingClientRect.y);
                        }
                    }
                }
            }, {
                root: document.querySelector('#feed-container'),
                rootMargin: '0px',
                threshold: 0.1
            });

            const feedContainer = document.querySelector('#feed-container');

            const observeElements = () => {
                feedContainer.querySelectorAll('[data-guid]').forEach(item => {
                    observer.observe(item);
                });
            };

            observeElements();

            const mutationObserver = new MutationObserver(mutations => {
                console.log('Mutation detected in feed-container. Re-observing elements.');
                observer.disconnect();
                observeElements();
            });

            mutationObserver.observe(feedContainer, { childList: true, subtree: true });

            this.scrollObserver = observer;
        },

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
                    }
                }
            });
        },

        async loadFeedItemsFromDB() {
            if (!this.db) {
                console.error("Database not initialized, cannot load feed items.");
                this.entries = [];
                return;
            }
            const rawItemsFromDb = await this.db.transaction('feedItems', 'readonly').objectStore('feedItems').getAll();
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
            console.log("toggleHidden called with guid:", guid);
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
            await saveConfigFile('rssFeeds.txt', this.rssFeedsInput);
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true;
            await performFullSync();
            await this.loadFeedItemsFromDB();
            await validateAndRegenerateCurrentDeck(this);
            this.loading = false;
        },

        async saveKeywordBlacklist() {
            await saveConfigFile('keywordBlacklist.txt', this.keywordBlacklistInput);
            createStatusBarMessage('Keyword Blacklist saved!', 'success');
            this.updateCounts();
        }
    }));
});