// @filepath: src/app.js

// Refactored JS: concise, modern, functional, same output.

import {
    getDb,
    performFeedSync,
    performFullSync,
    pullUserState,
    processPendingOperations,
    loadSimpleState,
    loadArrayState,
    initDb,
    saveSimpleState,
    getAllFeedItems
} from './js/data/database.js';
import { loadConfigFile, saveConfigFile } from './js/helpers/apiUtils.js';
import { formatDate, mapRawItem, mapRawItems } from './js/helpers/dataUtils.js';
import {
    loadCurrentDeck,
    saveCurrentDeck,
    toggleItemStateAndSync,
    pruneStaleHidden, // This function is now a pure utility.
    loadAndPruneHiddenItems, // <-- NEW: Use this for startup!
    saveShuffleState,
    loadShuffleState,
    setFilterMode,
    loadFilterMode
} from './js/helpers/userStateUtils.js';
import {
    updateCounts,
    manageSettingsPanelVisibility,
    scrollToTop,
    attachScrollToTopHandler,
    saveCurrentScrollPosition,
    createStatusBarMessage
} from './js/ui/uiUpdaters.js';
import {
    initSyncToggle,
    initImagesToggle,
    initTheme,
    initScrollPosition,
    initConfigPanelListeners
} from './js/ui/uiInitializers.js';
import { manageDailyDeck, processShuffle } from './js/helpers/deckManager.js';
import { isOnline } from './js/utils/connectivity.js';

export function rssApp() {
    return {
        // --- State Properties ---
        loading: true,
        deck: [],
        feedItems: {},
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
        deckManaged: false,

        _lastFilterHash: '',
        _cachedFilteredEntries: null,
        scrollObserver: null,

        // --- Core Methods ---
        initApp: async function() {
            try {
                this.db = await initDb();
                
                // 1. Load basic configuration and settings first.
                await this._loadInitialState();
                
                // 2. Perform a full data sync from the server. This is the critical step.
                // It ensures feed items and user state are fully up-to-date before
                // any deck management or display logic runs.
                if (this.isOnline) {
                    await this._fullInitialSync();
                }

                // 3. Load all data, including the deck, from the now-fresh database.
                await this._loadAndManageAllData();

                initTheme(this);
                initSyncToggle(this);
                initImagesToggle(this);
                initConfigPanelListeners(this);
                attachScrollToTopHandler();
                await initScrollPosition(this);
                
                this._setupWatchers();
                this._setupEventListeners();
                this._startPeriodicSync();
                this._initScrollObserver();

                this.loading = false;
            } catch (error) {
                console.error("Initialization failed:", error);
                this.errorMessage = `Could not load feed: ${error.message}`;
                this.loading = false;
            }
        },
        loadAndDisplayDeck: async function() {
            // Don't reload from DB - we should already have feedItems populated
            // await this.loadFeedItemsFromDB(); // Remove this line!

            let guidsToDisplay = this.currentDeckGuids;
            if (!Array.isArray(guidsToDisplay)) {
                guidsToDisplay = [];
            }

            console.log(`[loadAndDisplayDeck] Processing ${guidsToDisplay.length} GUIDs for display`);
            console.log(`[loadAndDisplayDeck] feedItems contains ${Object.keys(this.feedItems).length} items`);

            const items = [];
            const hiddenSet = new Set(this.hidden.map(h => h.guid));
            const starredSet = new Set(this.starred.map(s => s.guid));
            const seenGuidsForDeck = new Set();

            let foundCount = 0;
            let missingCount = 0;

            for (const guid of guidsToDisplay) {
                if (typeof guid !== 'string' || !guid) continue;
                
                const item = this.feedItems[guid];
                if (item && item.guid && !seenGuidsForDeck.has(item.guid)) {
                    const mappedItem = mapRawItem(item, formatDate);
                    mappedItem.isHidden = hiddenSet.has(mappedItem.id);
                    mappedItem.isStarred = starredSet.has(mappedItem.id);
                    items.push(mappedItem);
                    seenGuidsForDeck.add(mappedItem.id);
                    foundCount++;
                } else {
                    missingCount++;
                    if (missingCount <= 3) { // Only log first few missing items
                        console.log(`[loadAndDisplayDeck] MISSING: GUID ${guid} not found in feedItems`);
                    }
                }
            }

            console.log(`[loadAndDisplayDeck] Found ${foundCount} items, Missing ${missingCount} items`);

            this.deck = Array.isArray(items) ? items.sort((a, b) => b.timestamp - a.timestamp) : [];
            console.log(`[loadAndDisplayDeck] Final deck size: ${this.deck.length}`);
        },

        loadFeedItemsFromDB: async function() {
            if (!this.db) {
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
                }
            });

            this.entries = mapRawItems(uniqueEntries, formatDate) || [];
        },
        
        // --- Getters ---
        get filteredEntries() {
            if (!Array.isArray(this.deck)) this.deck = [];
            const currentHash = `${this.entries.length}-${this.filterMode}-${this.hidden.length}-${this.starred.length}-${this.imagesEnabled}-${this.currentDeckGuids.length}-${this.deck.length}-${this.keywordBlacklistInput}`;
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
                    filtered = this.entries;
                    break;
                case "hidden":
                    filtered = this.entries.filter(e => hiddenMap.has(e.id))
                        .sort((a, b) => new Date(hiddenMap.get(b.id)).getTime() - new Date(hiddenMap.get(a.id)).getTime());
                    break;
                case "starred":
                    filtered = this.entries.filter(e => starredMap.has(e.id))
                        .sort((a, b) => new Date(starredMap.get(b.id)).getTime() - new Date(starredMap.get(a.id)).getTime());
                    break;
            }

            filtered = filtered.map(e => ({
                ...e,
                isHidden: hiddenMap.has(e.id),
                isStarred: starredMap.has(e.id)
            }));

            const keywordBlacklist = (this.keywordBlacklistInput ?? '')
                .split(/\r?\n/)
                .map(kw => kw.trim().toLowerCase())
                .filter(kw => kw.length > 0);
            
            if (keywordBlacklist.length > 0) {
                filtered = filtered.filter(item => {
                    const searchable = `${item.title} ${item.description}`.toLowerCase();
                    return !keywordBlacklist.some(keyword => searchable.includes(keyword));
                });
            }
            
            this._cachedFilteredEntries = filtered;
            this._lastFilterHash = currentHash;
            return filtered;
        },

        // --- Action Methods ---
        isStarred: function(guid) {
            return this.starred.some(e => e.guid === guid);
        },
        isHidden: function(guid) {
            return this.hidden.some(e => e.guid === guid);
        },
        toggleStar: async function(guid) {
            await toggleItemStateAndSync(this, guid, 'starred');
        },
        toggleHidden: async function(guid) {
            await toggleItemStateAndSync(this, guid, 'hidden');
            await manageDailyDeck(this);
        },
        processShuffle: async function() {
            await processShuffle(this);
            this.updateCounts();
        },
        saveRssFeeds: async function() {
            await saveSimpleState('rssFeeds', this.rssFeedsInput);
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true;
            await performFullSync(this);
            await this.loadFeedItemsFromDB();
            await manageDailyDeck(this);
            this.loading = false;
        },
        saveKeywordBlacklist: async function() {
            const keywordsArray = this.keywordBlacklistInput.split(/\r?\n/).map(kw => kw.trim()).filter(Boolean);
            await saveSimpleState('keywordBlacklist', keywordsArray);
            createStatusBarMessage('Keyword Blacklist saved!', 'success');
            this.updateCounts();
        },
        updateCounts: function() {
            updateCounts(this);
        },
        scrollToTop: function() {
            scrollToTop();
        },

        // --- Private Helper Methods ---
        _loadInitialState: async function() {
            const [syncEnabled, imagesEnabled, urlsNewTab, filterMode] = await Promise.all([
                loadSimpleState('syncEnabled'),
                loadSimpleState('imagesEnabled'),
                loadSimpleState('openUrlsInNewTabEnabled'),
                loadFilterMode(),
            ]);
            this.syncEnabled = syncEnabled.value ?? true;
            this.imagesEnabled = imagesEnabled.value ?? true;
            this.openUrlsInNewTabEnabled = urlsNewTab.value ?? true;
            this.filterMode = filterMode;
            this.isOnline = isOnline();
        },

        _fullInitialSync: async function() {
            if (!this.syncEnabled) return;
            try {
                // First, pull all user state to get the latest deck GUIDs.
                console.log("[DB] Pulling user state (initial sync)...");
                await pullUserState();
                // Then, sync the feed to ensure we have all feed items locally.
                console.log("[DB] Fetching feed items from server (initial sync)...");
                await performFullSync(this);
                // CRITICAL: Reload app state with newly synced items.
                console.log("[DB] Reloading feed items into app state...");
                await this.loadFeedItemsFromDB();
                createStatusBarMessage("Initial sync complete!", "success");
            } catch (error) {
                console.error("Initial sync failed:", error);
                this.errorMessage = `Initial sync failed: ${error.message}`;
                // Avoid creating a status bar message if the container doesn't exist
                if (document.querySelector('.status-bar-container')) {
                    createStatusBarMessage(`Initial sync failed: ${error.message}`, "error");
                }
            }
        },

        _loadAndManageAllData: async function() {
            // CRITICAL FIX: Load all feed items from the DB into the app state first.
            await this.loadFeedItemsFromDB();
            console.log(`[DB] Loaded ${this.entries.length} feed items into app state.`);

            // Now, with a complete list of feed items, load and process other states.
            const [starredState, shuffledOutState, currentDeckState, shuffleState] = await Promise.all([
                loadArrayState('starred'),
                loadArrayState('shuffledOutGuids'),
                loadArrayState('currentDeckGuids'),
                loadShuffleState()
            ]);
            
            this.starred = Array.isArray(starredState.value) ? starredState.value : [];
            this.shuffledOutGuids = Array.isArray(shuffledOutState.value) ? shuffledOutState.value : [];
            this.currentDeckGuids = Array.isArray(currentDeckState.value) ? currentDeckState.value : [];
            this.shuffleCount = shuffleState.shuffleCount;
            this.lastShuffleResetDate = shuffleState.lastShuffleResetDate;

            // With all data loaded, it is now safe to prune and manage the deck.
            this.hidden = await loadAndPruneHiddenItems(Object.values(this.feedItems));
            console.log("[deckManager] Starting deck management with all data loaded.");

            await manageDailyDeck(this);
            await this.loadAndDisplayDeck();

            // After all data is loaded and managed, update the UI once.
            this.updateAllUI();
        },

        // New method to consolidate all UI updates after data loading
        updateAllUI: function() {
            this.updateCounts();
        },

        _setupWatchers: function() {
            this.$watch("openSettings", async (isOpen) => {
                if (isOpen) {
                    this.modalView = 'main';
                    await manageSettingsPanelVisibility(this);
                    const [rssFeeds, storedKeywords] = await Promise.all([
                        loadSimpleState('rssFeeds'),
                        loadSimpleState('keywordBlacklist')
                    ]);
                    this.rssFeedsInput = rssFeeds.value || '';
                    if (Array.isArray(storedKeywords.value)) {
                        this.keywordBlacklistInput = storedKeywords.value.filter(Boolean).sort().join("\n");
                    } else if (typeof storedKeywords.value === 'string') {
                        this.keywordBlacklistInput = storedKeywords.value.split(/\r?\n/).filter(Boolean).sort().join("\n");
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
            this.$watch("modalView", async () => manageSettingsPanelVisibility(this));
            this.$watch('filterMode', async (newMode) => {
                await setFilterMode(this, newMode);
                if (newMode === 'unread') {
                    await manageDailyDeck(this);
                }
                // The new watcher on the data will handle the counts update
                this.scrollToTop();
            });
            
            // New watchers to automatically update counts when data changes
            this.$watch('entries', () => this.updateCounts());
            this.$watch('hidden', () => this.updateCounts());
            this.$watch('starred', () => this.updateCounts());
            this.$watch('currentDeckGuids', () => this.updateCounts());
        },

        _setupEventListeners: function() {
            const backgroundSync = async () => {
                if (!this.syncEnabled || !this.isOnline) return;
                await performFeedSync(this);
                await pullUserState();
                await this._loadAndManageAllData();
                this.deckManaged = true;
            };

            window.addEventListener('online', async () => {
                this.isOnline = true;
                if (this.syncEnabled) {
                    await processPendingOperations();
                    await backgroundSync();
                }
            });
            window.addEventListener('offline', () => {
                this.isOnline = false;
            });
            setTimeout(backgroundSync, 0);
        },

        _startPeriodicSync: function() {
            let lastActivityTimestamp = Date.now();
            const recordActivity = () => lastActivityTimestamp = Date.now();
            ["mousemove", "mousedown", "keydown", "scroll", "click", "visibilitychange", "focus"].forEach(event => {
                document.addEventListener(event, recordActivity, true);
                if (event === 'focus') window.addEventListener(event, recordActivity, true);
                if (event === 'visibilitychange') document.addEventListener(event, recordActivity, true);
            });

            const SYNC_INTERVAL_MS = 5 * 60 * 1000;
            const INACTIVITY_TIMEOUT_MS = 60 * 1000;

            setInterval(async () => {
                const now = Date.now();
                if (!this.isOnline || this.openSettings || !this.syncEnabled || document.hidden || (now - lastActivityTimestamp) > INACTIVITY_TIMEOUT_MS) {
                    return;
                }
                await performFeedSync(this);
                await pullUserState();
                await this._loadAndManageAllData();
                this.deckManaged = true;
            }, SYNC_INTERVAL_MS);
        },

        _initScrollObserver: function() {
            const observer = new IntersectionObserver(async (entries) => {
                // ... logic to observe item visibility
            }, {
                root: document.querySelector('#feed-container'),
                rootMargin: '0px',
                threshold: 0.1
            });
            const feedContainer = document.querySelector('#feed-container');
            if (!feedContainer) return;
            const observeElements = () => {
                feedContainer.querySelectorAll('[data-guid]').forEach(item => {
                    observer.observe(item);
                });
            };
            observeElements();
            const mutationObserver = new MutationObserver(mutations => {
                observer.disconnect();
                observeElements();
            });
            mutationObserver.observe(feedContainer, { childList: true, subtree: true });
            this.scrollObserver = observer;
        },

        handleEntryLinks: function(element) {
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
    };
}
