// @filepath: src/app.js

// This file is the main orchestrator for the application.
// No significant changes are needed here as the logic is sound.
// It will now correctly use the fixed data layer modules.

import {
    initDb,
    performFeedSync,
    pullUserState,
    processPendingOperations,
    loadSimpleState,
    loadArrayState,
    saveSimpleState,
    getAllFeedItems
} from './js/data/database.js';
import { formatDate, mapRawItem, mapRawItems } from './js/helpers/dataUtils.js';
import {
    loadCurrentDeck,
    toggleItemStateAndSync,
    loadAndPruneHiddenItems,
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
        progressMessage: 'Initializing...',
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

        syncStatusMessage: '',
        showSyncStatus: false,

        _lastFilterHash: '',
        _cachedFilteredEntries: null,
        scrollObserver: null,

        // --- Core Methods ---
        initApp: async function() {
            try {
                this.progressMessage = 'Connecting to database...';
                this.db = await initDb();
                
                this.progressMessage = 'Loading settings...';
                await this._loadInitialState();
                
                if (this.isOnline) {
                    this.progressMessage = 'Performing initial sync...';
                    // The following functions will now use the corrected logic from the data layer
                    await pullUserState();
                    await performFeedSync(this);
                    
                    await this._loadAndManageAllData();
                    createStatusBarMessage("Initial sync complete!", "success");
                } else {
                    this.progressMessage = 'Offline mode. Loading local data...';
                    await this._loadAndManageAllData();
                }

                this.progressMessage = 'Applying user preferences...';
                initTheme(this);
                initSyncToggle(this);
                initImagesToggle(this);
                initConfigPanelListeners(this);
                attachScrollToTopHandler();
                await initScrollPosition(this);
                
                this.progressMessage = 'Setting up app watchers...';
                this._setupWatchers();
                this._setupEventListeners();
                this._startPeriodicSync();
                this._initScrollObserver();

                this.progressMessage = '';
                this.loading = false;
                
                await this.updateSyncStatusMessage();
            } catch (error) {
                console.error("Initialization failed:", error);
                this.errorMessage = `Could not load feed: ${error.message}`;
                this.progressMessage = `Error: ${error.message}`;
                this.loading = false;
            }
        },

        updateSyncStatusMessage: function() {
            const online = isOnline();
            let message = '';
            let show = false;

            if (!online) {
                message = 'Offline.';
                show = true;
            } else if (!this.syncEnabled) {
                message = 'Sync is disabled.';
                show = true;
            }

            this.syncStatusMessage = message;
            this.showSyncStatus = show;
        },
        
        loadAndDisplayDeck: async function() {
            let guidsToDisplay = this.currentDeckGuids;
            if (!Array.isArray(guidsToDisplay)) {
                guidsToDisplay = [];
            }

            const items = [];
            const hiddenSet = new Set(this.hidden.map(h => h.guid));
            const starredSet = new Set(this.starred.map(s => s.guid));
            const seenGuidsForDeck = new Set();

            for (const guid of guidsToDisplay) {
                if (typeof guid !== 'string' || !guid) continue;
                
                const item = this.feedItems[guid];
                if (item && item.guid && !seenGuidsForDeck.has(item.guid)) {
                    const mappedItem = mapRawItem(item, formatDate);
                    
                    mappedItem.isHidden = hiddenSet.has(mappedItem.guid);
                    mappedItem.isStarred = starredSet.has(mappedItem.guid);
                    items.push(mappedItem);
                    seenGuidsForDeck.add(mappedItem.guid);
                }
            }

            this.deck = Array.isArray(items) ? items.sort((a, b) => b.timestamp - a.timestamp) : [];
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
                    filtered = this.deck.filter(item => !hiddenMap.has(item.guid));
                    break;
                case "all":
                    filtered = this.entries;
                    break;
                case "hidden":
                    filtered = this.entries.filter(e => hiddenMap.has(e.guid))
                        .sort((a, b) => new Date(hiddenMap.get(b.guid)).getTime() - new Date(hiddenMap.get(a.guid)).getTime());
                    break;
                case "starred":
                    filtered = this.entries.filter(e => starredMap.has(e.guid))
                        .sort((a, b) => new Date(starredMap.get(b.guid)).getTime() - new Date(starredMap.get(a.guid)).getTime());
                    break;
            }

            filtered = filtered.map(e => ({
                ...e,
                isHidden: hiddenMap.has(e.guid),
                isStarred: starredMap.has(e.guid)
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
            await this._loadAndManageAllData();
            this.updateSyncStatusMessage();
        },
        toggleHidden: async function(guid) {
            await toggleItemStateAndSync(this, guid, 'hidden');
            await this._loadAndManageAllData();
            this.updateSyncStatusMessage();
        },
        processShuffle: async function() {
            await processShuffle(this);
            this.updateCounts();
        },
        saveRssFeeds: async function() {
            await saveSimpleState('rssFeeds', this.rssFeedsInput);
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true;
            this.progressMessage = 'Saving feeds and performing full sync...';
            await performFullSync(this);
            await this.loadFeedItemsFromDB();
            await manageDailyDeck(this);
            this.progressMessage = '';
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
        
        _loadAndManageAllData: async function() {
            await this.loadFeedItemsFromDB();

            this.progressMessage = 'Loading user state from storage...';
            const [starredState, shuffledOutState, currentDeckState, shuffleState] = await Promise.all([
                loadArrayState('starred'),
                loadArrayState('shuffledOutGuids'),
                loadCurrentDeck(),
                loadShuffleState()
            ]);

            this.starred = Array.isArray(starredState.value) ? starredState.value : [];
            this.shuffledOutGuids = Array.isArray(shuffledOutState.value) ? shuffledOutState.value : [];
            this.currentDeckGuids = Array.isArray(currentDeckState) ? currentDeckState : [];
            this.shuffleCount = shuffleState.shuffleCount;
            this.lastShuffleResetDate = shuffleState.lastShuffleResetDate;

            this.progressMessage = 'Pruning hidden items...';
            this.hidden = await loadAndPruneHiddenItems(Object.values(this.feedItems));

            this.progressMessage = 'Managing today\'s deck...';
            await manageDailyDeck(this);
            await this.loadAndDisplayDeck();

            this.updateAllUI();
        },

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
                this.scrollToTop();
            });
            
            this.$watch('entries', () => this.updateCounts());
            this.$watch('hidden', () => this.updateCounts());
            this.$watch('starred', () => this.updateCounts());
            this.$watch('currentDeckGuids', () => this.updateCounts());
        },

        _setupEventListeners: function() {
            const backgroundSync = async () => {
                if (!this.syncEnabled || !this.isOnline) return;
                console.log('Performing periodic background sync...');
                await performFeedSync(this);
                await pullUserState();
                await this._loadAndManageAllData();
                this.deckManaged = true;
            };

            window.addEventListener('online', async () => {
                this.isOnline = true;
                this.updateSyncStatusMessage();
                if (this.syncEnabled) {
                    await processPendingOperations();
                    await backgroundSync();
                }
            });
            window.addEventListener('offline', () => {
                this.isOnline = false;
                this.updateSyncStatusMessage();
            });
            setTimeout(backgroundSync, 0);
        },

        _startPeriodicSync: function() {
            let lastActivityTimestamp = Date.now();
            const recordActivity = () => lastActivityTimestamp = Date.now();
            ["mousemove", "mousedown", "keydown", "scroll", "click", "visibilitychange", "focus"].forEach(event => {
                document.addEventListener(event, recordActivity, true);
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
            // Placeholder for IntersectionObserver logic
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