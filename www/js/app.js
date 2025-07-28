// www/js/app.js

import {
    getDb,
    performFeedSync,
    performFullSync,
    pullUserState,
    processPendingOperations,
    loadSimpleState,
    loadArrayState,
    isOnline,
    initDb,
    saveSimpleState
} from './data/database.js';
import { loadConfigFile, saveConfigFile } from './helpers/apiUtils.js';
// Removed 'displayCurrentDeck' from dataUtils.js imports as it will be removed/refactored there
import { formatDate, mapRawItems, validateAndRegenerateCurrentDeck, loadNextDeck, shuffleFeed } from './helpers/dataUtils.js';
import {
    loadCurrentDeck,
    saveCurrentDeck,
    toggleStar,
    toggleHidden,
    pruneStaleHidden,
    saveShuffleState,
    loadShuffleState,
    setFilterMode,
    loadFilterMode
} from './helpers/userStateUtils.js';
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initShuffleCount, initConfigPanelListeners } from './ui/uiInitializers.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition, createStatusBarMessage } from './ui/uiUpdaters.js'

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
        loading: true,
        deck: [], // Primary property for displayed items
        feedItems: {}, // Cache of all fetched feed items by GUID
        scrollObserver: null,
        filterMode: 'unread',
        openSettings: false,
        modalView: 'main',
        shuffleCount: 0,
        syncEnabled: true,
        imagesEnabled: true,
        openUrlsInNewTabEnabled: true,
        rssFeedsInput: '',
        keywordBlacklistInput: '',
        entries: [], // All mapped feed items
        hidden: [],
        starred: [],
        currentDeckGuids: [], // This Alpine property holds the array of GUID strings
        errorMessage: '',
        isOnline: isOnline(),
        _lastFilterHash: '',
        _cachedFilteredEntries: null,

        // New method to load and display the current deck
        async loadAndDisplayDeck() {
            console.log('Loading current deck and populating display (app.js:loadAndDisplayDeck)...');
            const guidsToDisplay = this.currentDeckGuids;

            console.log("DEBUG app.js: loadAndDisplayDeck - type of guidsToDisplay:", typeof guidsToDisplay, "Array.isArray:", Array.isArray(guidsToDisplay));
            if (Array.isArray(guidsToDisplay)) {
                console.log("DEBUG app.js: loadAndDisplayDeck - first 5 GUIDs:", guidsToDisplay.slice(0, 5));
                console.log("DEBUG app.js: loadAndDisplayDeck - type of first GUID (if any):", guidsToDisplay.length > 0 ? typeof guidsToDisplay[0] : 'N/A');
            }

            if (guidsToDisplay && Array.isArray(guidsToDisplay) && guidsToDisplay.length > 0) {
                const db = await getDb();
                const tx = db.transaction('feedItems', 'readonly');
                const store = tx.objectStore('feedItems');
                const itemPromises = guidsToDisplay.map(guid => {
                    console.log("DEBUG app.js: loadAndDisplayDeck - Attempting to get item for GUID:", guid);
                    if (typeof guid !== 'string' || guid.trim() === '') {
                         console.warn("Invalid GUID encountered in guidsToDisplay (loadAndDisplayDeck):", guid);
                         return Promise.resolve(null);
                    }
                    return store.get(guid);
                });
                const items = await Promise.all(itemPromises);
                this.deck = items.filter(item => item !== undefined && item !== null);
                console.log(`Populated deck with ${this.deck.length} items from app.js:loadAndDisplayDeck.`);
            } else {
                this.deck = [];
                console.log('Current deck GUIDs is empty or invalid in app.js:loadAndDisplayDeck. Displaying an empty deck.');
            }
        },

        get filteredEntries() {
            if (this.loading || !this.deck || this.deck.length === 0) {
                console.log('filteredEntries: App not ready or deck is empty, returning empty array.');
                return [];
            }
            console.log(`filteredEntries: Returning ${this.deck.length} items from deck.`);
            return this.deck;
        },

        async initApp() {
            try {
                this.db = await initDb();

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
                let lastFeedSyncServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                if (itemsCount === 0 && this.isOnline) {
                     await performFullSync(this);
                     lastFeedSyncServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();
                     this.hidden = (await loadArrayState('hidden')).value;
                     this.starred = (await loadArrayState('starred')).value;
                     await this.loadFeedItemsFromDB();
                }

                this.hidden = await pruneStaleHidden(this.entries, lastFeedSyncServerTime);

                this.currentDeckGuids = await loadCurrentDeck();

                // validateAndRegenerateCurrentDeck will update this.currentDeckGuids and call app.loadAndDisplayDeck()
                await validateAndRegenerateCurrentDeck(this); // THIS IS NOW THE PRIMARY CALLER OF app.loadAndDisplayDeck()

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

                this.loading = false; // Set loading to false after everything is ready

                if (this.syncEnabled) {
                    setTimeout(async () => {
                        try {
                            console.log("Initiating background partial sync...");
                            await performFeedSync(this);
                            const currentFeedServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                            await pullUserState();
                            this.hidden = (await loadArrayState('hidden')).value;
                            this.starred = (await loadArrayState('starred')).value;
                            await this.loadFeedItemsFromDB();
                            this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                            await validateAndRegenerateCurrentDeck(this); // THIS CALLS app.loadAndDisplayDeck()
                            // await this.loadAndDisplayDeck(); // <-- REMOVED THIS REDUNDANT CALL
                            this.updateCounts();
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
                        await performFeedSync(this);
                        const currentFeedServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                        await pullUserState();
                        this.hidden = (await loadArrayState('hidden')).value;
                        this.starred = (await loadArrayState('starred')).value;
                        await this.loadFeedItemsFromDB();
                        this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                        await validateAndRegenerateCurrentDeck(this); // THIS CALLS app.loadAndDisplayDeck()
                        // await this.loadAndDisplayDeck(); // <-- REMOVED THIS REDUNDANT CALL
                        this.updateCounts();
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
                        await performFeedSync(this);
                        const currentFeedServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                        await pullUserState();
                        await this.loadFeedItemsFromDB();
                        this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                        await validateAndRegenerateCurrentDeck(this); // THIS CALLS app.loadAndDisplayDeck()
                        // await this.loadAndDisplayDeck(); // <-- REMOVED THIS REDUNDANT CALL
                        this.updateCounts();
                        console.log("Periodic background sync completed.");
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
            this.feedItems = {}; // Clear previous cache
            rawItemsFromDb.forEach(item => {
                this.feedItems[item.guid] = item;
            });
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
            // No need to call loadAndDisplayDeck here, validateAndRegenerateCurrentDeck or next operations will handle it.
        },
        async toggleHidden(guid) {
            console.log("toggleHidden called with guid:", guid);
            await toggleHidden(this, guid);
            await validateAndRegenerateCurrentDeck(this); // This will call loadAndDisplayDeck if the deck changes
            // await this.loadAndDisplayDeck(); // <-- REMOVED THIS REDUNDANT CALL
        },
        setFilter(mode) {
            this.filterMode = mode;
        },
        async loadNextDeck() {
            await loadNextDeck(this); // This calls app.loadAndDisplayDeck()
            // await this.loadAndDisplayDeck(); // <-- REMOVED THIS REDUNDANT CALL
        },

        async shuffleFeed() {
            await shuffleFeed(this); // This calls app.loadAndDisplayDeck()
            // await this.loadAndDisplayDeck(); // <-- REMOVED THIS REDUNDANT CALL
        },

        async saveRssFeeds() {
            await saveConfigFile('rssFeeds.txt', this.rssFeedsInput);
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true; // Re-enable loading state during sync
            await performFullSync();
            await this.loadFeedItemsFromDB();
            await validateAndRegenerateCurrentDeck(this); // This will call loadAndDisplayDeck
            // await this.loadAndDisplayDeck(); // <-- REMOVED THIS REDUNDANT CALL
            this.loading = false; // Disable loading state after sync
        },

        async saveKeywordBlacklist() {
            await saveConfigFile('keywordBlacklist.txt', this.keywordBlacklistInput);
            createStatusBarMessage('Keyword Blacklist saved!', 'success');
            // This does not directly affect the deck content, only filtering, so no loadAndDisplayDeck needed
            this.updateCounts();
        }
    }));
});