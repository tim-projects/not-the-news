// @filepath: src/app.js

import Alpine from 'alpinejs';
// CSS imports remain the same
import './css/variables.css';
import './css/buttons.css';
import './css/forms.css';
import './css/layout.css';
import './css/content.css';
import './css/modal.css';
import './css/status.css';

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
    pruneStaleHidden,
    loadAndPruneHiddenItems,
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
        
        theme: 'dark',
        rssSaveMessage: '',
        keywordSaveMessage: '',

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

                this.progressMessage = 'Applying user preferences...';
                this.applyTheme();
                initSyncToggle(this);
                initImagesToggle(this);
                initConfigPanelListeners(this);
                attachScrollToTopHandler();
                await initScrollPosition(this);
                
                if (this.isOnline) {
                    this.progressMessage = 'Performing initial sync...';
                    await pullUserState();
                    await performFeedSync(this);
                    
                    await this._loadAndManageAllData();
                    createStatusBarMessage("Initial sync complete!", "success");
                } else {
                    this.progressMessage = 'Offline mode. Loading local data...';
                    await this._loadAndManageAllData();
                }

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
                    
                    mappedItem.isHidden = hiddenSet.has(mappedItem.guid);
                    mappedItem.isStarred = starredSet.has(mappedItem.guid);
                    items.push(mappedItem);
                    seenGuidsForDeck.add(mappedItem.guid);
                    
                    foundCount++;
                } else {
                    missingCount++;
                    if (missingCount <= 3) {
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
        
        async saveRssFeeds() {
            await saveSimpleState('rssFeeds', this.rssFeedsInput);
            this.rssSaveMessage = 'Feeds saved! Syncing...';
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true;
            this.progressMessage = 'Saving feeds and performing full sync...';
            await performFullSync(this);
            await this.loadFeedItemsFromDB();
            await manageDailyDeck(this);
            this.progressMessage = '';
            this.loading = false;
        },
        async saveKeywordBlacklist() {
            const keywordsArray = this.keywordBlacklistInput.split(/\r?\n/).map(kw => kw.trim()).filter(Boolean);
            await saveSimpleState('keywordBlacklist', keywordsArray);
            this.keywordSaveMessage = 'Keywords saved!';
            createStatusBarMessage('Keyword Blacklist saved!', 'success');
            this.updateCounts();
        },
        updateCounts: function() {
            updateCounts(this);
        },
        scrollToTop: function() {
            scrollToTop();
        },
        
        async toggleTheme() {
            this.theme = this.theme === 'light' ? 'dark' : 'light';
            this.applyTheme();
            await saveSimpleState('theme', this.theme);
        },

        // --- Private Helper Methods ---
        _loadInitialState: async function() {
            const [syncEnabled, imagesEnabled, urlsNewTab, filterMode, themeState] = await Promise.all([
                loadSimpleState('syncEnabled'),
                loadSimpleState('imagesEnabled'),
                loadSimpleState('openUrlsInNewTabEnabled'),
                loadFilterMode(),
                loadSimpleState('theme', 'userSettings')
            ]);
            this.syncEnabled = syncEnabled.value ?? true;
            this.imagesEnabled = imagesEnabled.value ?? true;
            this.openUrlsInNewTabEnabled = urlsNewTab.value ?? true;
            this.filterMode = filterMode;
            this.theme = themeState.value ?? 'dark';
            this.isOnline = isOnline();
        },

        applyTheme: function() {
            initTheme(this);
        },
        
        _loadAndManageAllData: async function() {
            await this.loadFeedItemsFromDB();
            console.log(`[DB] Loaded ${this.entries.length} feed items into app state.`);

            this.progressMessage = 'Loading user state from storage...';
            const [rawStarredState, rawShuffledOutState, currentDeckState, shuffleState] = await Promise.all([
                loadArrayState('starred'),
                loadArrayState('shuffledOutGuids'),
                loadCurrentDeck(),
                loadShuffleState()
            ]);
            console.log("Loaded starred state:", rawStarredState.value);

            // FINAL FIX: Universal sanitization for starred items.
            const sanitizedStarred = [];
            if (Array.isArray(rawStarredState.value)) {
                for (const item of rawStarredState.value) {
                    const guid = (typeof item === 'string' && item) ? item : (typeof item === 'object' && item?.guid) ? item.guid : null;
                    if (guid) {
                        sanitizedStarred.push({ guid, starredAt: item?.starredAt || new Date().toISOString() });
                    }
                }
            }
            this.starred = sanitizedStarred;

            // FINAL FIX: Universal sanitization for shuffled-out GUIDs.
            const sanitizedShuffled = [];
            if (Array.isArray(rawShuffledOutState.value)) {
                 for (const item of rawShuffledOutState.value) {
                    const guid = (typeof item === 'string' && item) ? item : (typeof item === 'object' && item?.guid) ? item.guid : null;
                    if (guid) {
                        sanitizedShuffled.push({ guid });
                    }
                }
            }
            this.shuffledOutGuids = sanitizedShuffled;
    
            this.currentDeckGuids = Array.isArray(currentDeckState) ? currentDeckState : [];
            console.log(`[app] Loaded currentDeckGuids:`, this.currentDeckGuids.slice(0, 3), typeof this.currentDeckGuids[0]);
    
            this.shuffleCount = shuffleState.shuffleCount;
            this.lastShuffleResetDate = shuffleState.lastShuffleResetDate;

            this.progressMessage = 'Pruning hidden items...';
            this.hidden = await loadAndPruneHiddenItems(Object.values(this.feedItems));
            
            console.log("[deckManager] Starting deck management with all data loaded.");
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
                console.log('Background sync complete.');
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
                console.log('Starting scheduled background sync...');
                await performFeedSync(this);
                await pullUserState();
                await this._loadAndManageAllData();
                this.deckManaged = true;
                console.log('Scheduled sync complete.');
            }, SYNC_INTERVAL_MS);
        },

        _initScrollObserver: function() {
            const observer = new IntersectionObserver(async (entries) => {
                // ... logic to observe item visibility
            }, {
                root: document.querySelector('#items'),
                rootMargin: '0px',
                threshold: 0.1
            });
            const feedContainer = document.querySelector('#items');
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

// Register the rssApp component with Alpine.
Alpine.data('rssApp', rssApp);

// Start Alpine to initialize the application.
Alpine.start();