// src/app.js

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
    saveSimpleState,
    getAllFeedItems
} from './js/data/database.js';
import { loadConfigFile, saveConfigFile } from './js/helpers/apiUtils.js';
import { formatDate, mapRawItem, mapRawItems } from './js/helpers/dataUtils.js';
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
} from './js/helpers/userStateUtils.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition, createStatusBarMessage } from './js/ui/uiUpdaters.js'
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initConfigPanelListeners } from './js/ui/uiInitializers.js';
import { manageDailyDeck, processShuffle } from './js/helpers/deckManager.js';

// The Alpine component function is now directly exported
export function rssApp() {
    return {
        loading: true,
        deck: [],
        feedItems: {},
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
        entries: [],
        hidden: [],
        starred: [],
        currentDeckGuids: [],
        shuffledOutGuids: [],
        errorMessage: '',
        isOnline: isOnline(),
        _lastFilterHash: '',
        _cachedFilteredEntries: null,
        // New state variable to trigger a reactive update
        deckManaged: false,

        async loadAndDisplayDeck() {
            console.log("Loading current deck and populating display (app.js:loadAndDisplayDeck)...");
            if (this.filterMode !== 'unread') {
                console.log(`loadAndDisplayDeck called, but current filterMode is '${this.filterMode}'. 'this.deck' will still be updated, but 'filteredEntries' will use 'this.entries' directly.`);
            }
            await this.loadFeedItemsFromDB();

            let guidsToDisplay = this.currentDeckGuids;
            if (!Array.isArray(guidsToDisplay)) {
                console.warn("currentDeckGuids is not a valid array, defaulting to an empty array.");
                guidsToDisplay = [];
            }
            
            console.log("DEBUG app.js: loadAndDisplayDeck - type of guidsToDisplay:", typeof guidsToDisplay, "Array.isArray:", Array.isArray(guidsToDisplay));
            if (Array.isArray(guidsToDisplay)) {
                console.log("DEBUG app.js: loadAndDisplayDeck - first 5 GUIDs:", guidsToDisplay.slice(0, 5));
                console.log("DEBUG app.js: loadAndDisplayDeck - type of first GUID (if any):", guidsToDisplay.length > 0 ? typeof guidsToDisplay[0] : 'N/A');
            }

            const items = [];
            const hiddenSet = new Set(this.hidden.map(h => h.guid));
            const starredSet = new Set(this.starred.map(s => s.guid));
            const seenGuidsForDeck = new Set();

            for (const guid of guidsToDisplay) {
                if (typeof guid !== 'string') {
                    console.warn(`Invalid GUID encountered in guidsToDisplay (loadAndDisplayDeck): ${JSON.stringify(guid)}. Skipping.`);
                    continue;
                }

                const item = this.feedItems[guid];
                if (item && item.guid && !seenGuidsForDeck.has(item.guid)) {
                    const mappedItem = mapRawItem(item, formatDate);
                    mappedItem.isHidden = hiddenSet.has(mappedItem.id);
                    mappedItem.isStarred = starredSet.has(mappedItem.id);
                    items.push(mappedItem);
                    seenGuidsForDeck.add(mappedItem.id);
                } else if (item && item.guid && seenGuidsForDeck.has(item.guid)) {
                    console.warn(`Duplicate item (GUID: ${item.guid}) already added to deck. Skipping.`);
                } else {
                    console.warn(`Feed item with GUID ${guid} not found in feedItems cache or has invalid GUID. Skipping.`);
                }
            }
            
            // This is the primary fix: ensure `items` is an array and only then sort it.
            this.deck = Array.isArray(items) ? items.sort((a, b) => b.timestamp - a.timestamp) : [];
            console.log(`Populated deck with ${this.deck.length} items from app.js:loadAndDisplayDeck.`);
        },

        get filteredEntries() {
            // A defensive check to ensure this.deck is always an array before use
            if (!Array.isArray(this.deck)) {
                console.error("this.deck is not an array in filteredEntries getter. Resetting to empty array.");
                this.deck = [];
            }

            const currentHash = `${this.entries.length}-${this.filterMode}-${this.hidden.length}-${this.starred.length}-${this.imagesEnabled}-${this.currentDeckGuids.length}-${this.keywordBlacklistInput}-${this.deck.length}`;

            if (this.entries.length > 0 && currentHash === this._lastFilterHash && this._cachedFilteredEntries !== null) {
                return this._cachedFilteredEntries;
            }

            let filtered = [];
            const hiddenMap = new Map(this.hidden.map(h => [h.guid, h.hiddenAt]));
            const starredMap = new Map(this.starred.map(s => [s.guid, s.starredAt]));

            switch (this.filterMode) {
                case "unread":
                    filtered = this.deck;
                    break;
                case "all":
                    filtered = this.entries.map(e => ({
                        ...e,
                        isHidden: hiddenMap.has(e.id),
                        isStarred: starredMap.has(e.id)
                    }));
                    break;
                case "hidden":
                    filtered = this.entries.filter(e => hiddenMap.has(e.id))
                                           .map(e => ({
                                                ...e,
                                                isHidden: true,
                                                isStarred: starredMap.has(e.id)
                                           }))
                                           .sort((a, b) => new Date(hiddenMap.get(b.id)).getTime() - new Date(hiddenMap.get(a.id)).getTime());
                    break;
                case "starred":
                    filtered = this.entries.filter(e => starredMap.has(e.id))
                                           .map(e => ({
                                                ...e,
                                                isHidden: hiddenMap.has(e.id),
                                                isStarred: true
                                           }))
                                           .sort((a, b) => new Date(starredMap.get(b.id)).getTime() - new Date(starredMap.get(a.id)).getTime());
                    break;
                default:
                    console.warn(`Unknown filterMode: ${this.filterMode}. Defaulting to 'unread'.`);
                    filtered = this.deck;
                    break;
            }

            const keywordBlacklist = this.keywordBlacklistInput.split(/\r?\n/).map(kw => kw.trim().toLowerCase()).filter(kw => kw.length > 0);
            if (keywordBlacklist.length > 0) {
                filtered = filtered.filter(item => {
                    const title = item.title ? item.title.toLowerCase() : '';
                    const description = item.description ? item.description.toLowerCase() : '';
                    return !keywordBlacklist.some(keyword => title.includes(keyword) || description.includes(keyword));
                });
            }

            this._cachedFilteredEntries = filtered;
            this._lastFilterHash = currentHash;
            return filtered;
        },

        // This function will be called by x-init="initApp()" in the HTML
        async initApp() {
            try {
                this.db = await initDb();

                this.syncEnabled = (await loadSimpleState('syncEnabled')).value ?? true;
                this.imagesEnabled = (await loadSimpleState('imagesEnabled')).value ?? true;
                this.openUrlsInNewTabEnabled = (await loadSimpleState('openUrlsInNewTabEnabled')).value ?? true;
                this.filterMode = (await loadFilterMode());
                this.isOnline = isOnline();

                // This is the combined function to ensure data is loaded before deck management
                const loadAndManageData = async () => {
                    await this.loadFeedItemsFromDB();
                    const lastFeedSyncServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();
                    this.hidden = await pruneStaleHidden(this.entries, lastFeedSyncServerTime);
                    await manageDailyDeck(this);
                };

                if (this.syncEnabled && this.isOnline) {
                    try {
                        console.log("Attempting early pull of user state (including current deck) from server...");
                        await pullUserState();
                        console.log("Early user state pull completed.");
                        await loadAndManageData();
                    } catch (error) {
                        console.warn("Early pullUserState failed, proceeding with local state. Error:", error);
                        if (error instanceof SyntaxError && error.message.includes('Unexpected end of JSON input')) {
                            console.error("Failed to parse user state JSON. The server likely sent incomplete or malformed data.");
                        }
                    }
                }

                const itemsCount = await this.db.transaction('feedItems', 'readonly').objectStore('feedItems').count();
                if (itemsCount === 0 && this.isOnline) {
                    createStatusBarMessage("No feed items found locally. Performing initial sync...", "info");
                    await performFullSync(this);
                    createStatusBarMessage("Initial sync complete!", "success");
                }
                
                // Ensure data is loaded and deck is managed after any potential full sync
                await loadAndManageData();

                initTheme(this);
                initSyncToggle(this);
                initImagesToggle(this);
                initConfigPanelListeners(this);

                this.$watch("openSettings", async (isOpen) => {
                    if (isOpen) {
                        this.modalView = 'main';
                        await manageSettingsPanelVisibility(this);
                        this.rssFeedsInput = (await loadSimpleState('rssFeeds')).value || '';
                        let storedKeywords = (await loadSimpleState('keywordBlacklist')).value;
                        if (Array.isArray(storedKeywords)) {
                            this.keywordBlacklistInput = storedKeywords.filter(Boolean).sort().join("\n");
                        } else if (typeof storedKeywords === 'string') {
                            this.keywordBlacklistInput = storedKeywords.split(/\r?\n/).filter(Boolean).sort().join("\n");
                        } else {
                            this.keywordBlacklistInput = '';
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
                // Corrected $watch listener for filterMode
                this.$watch('filterMode', async (newMode) => {
                    // This call now passes the `this` object, which represents the app state
                    await setFilterMode(this, newMode);
                    console.log(`Filter mode changed to: ${newMode}`);

                    if (newMode === 'unread') {
                        console.log('Filter set to unread. Managing daily deck to populate this.deck.');
                        await manageDailyDeck(this);
                    }

                    this.updateCounts(this);
                    this.scrollToTop();
                });

                this.updateCounts(this);
                await initScrollPosition(this);

                this.loading = false;

                if (this.syncEnabled && this.isOnline) {
                    // Capture the 'this' context in a variable to avoid timing issues in the async callback.
                    const app = this;
                    setTimeout(async () => {
                        try {
                            console.log("Initiating background partial sync...");
                            await performFeedSync(app);
                            await pullUserState();
                            await loadAndManageData();
                            // Set the flag to trigger the reactive update in the $watch listener
                            app.deckManaged = true;
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
                        await pullUserState();
                        await loadAndManageData();
                        // Trigger the reactive update after all data is loaded
                        this.deckManaged = true;
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
                        await pullUserState();
                        await loadAndManageData();
                        // Trigger the reactive update after all data is loaded
                        this.deckManaged = true;
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
                this.feedItems = {};
                return;
            }
            const rawItemsFromDb = await getAllFeedItems();

            this.feedItems = {};
            const uniqueEntries = [];
            const seenGuids = new Set();

            rawItemsFromDb.forEach(item => {
                if (item && item.guid && !seenGuids.has(item.guid)) {
                    this.feedItems[item.guid] = item;
                    uniqueEntries.push(item);
                    seenGuids.add(item.guid);
                } else if (item && item.guid && seenGuids.has(item.guid)) {
                    console.warn(`Duplicate GUID found in raw database items during loadFeedItemsFromDB: ${item.guid}. Skipping duplicate.`);
                } else {
                    console.warn('Item or GUID missing when processing raw database items. Skipping:', item);
                }
            });

            this.entries = mapRawItems(uniqueEntries, formatDate);
            this.hidden = (await loadArrayState('hidden')).value;
            this.starred = (await loadArrayState('starred')).value;
        },

        updateCounts(app) {
            updateCounts(app);
        },

        scrollToTop() {
            scrollToTop();
        },

        isStarred(guid) {
            return this.starred.some(e => e.guid === guid);
        },
        isHidden(guid) {
            return this.hidden.some(e => e.guid === guid);
        },
        async toggleStar(guid) {
            await toggleStar(this, guid);
            this.updateCounts(this);
        },
        async toggleHidden(guid) {
            console.log("toggleHidden called with guid:", guid);
            await toggleHidden(this, guid);
            await manageDailyDeck(this);
            this.updateCounts(this);
        },
        async processShuffle() {
            await processShuffle(this);
            this.updateCounts(this);
        },
        async saveRssFeeds() {
            await saveSimpleState('rssFeeds', this.rssFeedsInput);
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true;
            await performFullSync(this);
            await this.loadFeedItemsFromDB();
            await manageDailyDeck(this);
            this.loading = false;
        },

        async saveKeywordBlacklist() {
            const keywordsArray = this.keywordBlacklistInput.split(/\r?\n/).map(kw => kw.trim()).filter(Boolean);
            await saveSimpleState('keywordBlacklist', keywordsArray);
            createStatusBarMessage('Keyword Blacklist saved!', 'success');
            this.updateCounts(this);
        }
    };
}