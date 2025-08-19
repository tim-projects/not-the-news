// @filepath: src//main.js

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
        currentDeckGuids: [], // Correctly named: stores objects {guid, addedAt}
        shuffledOutItems: [], // Was shuffledOutGuids, now stores objects {guid, shuffledAt}
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
        _initComplete: false, // Add flag to track initialization
        
        // --- NEW Properties for background sync ---
        staleItemObserver: null,
        _isSyncing: false,

        // --- Core Methods ---
        initApp: async function() {
            // Prevent full re-initialization if the app is already loaded
            if (window.appInitialized) return;

            try {
                console.log('Starting app initialization...');
                
                this.progressMessage = 'Connecting to database...';
                this.db = await initDb();
                console.log('Database initialized');
                
                this.progressMessage = 'Loading settings...';
                await this._loadInitialState();
                console.log('Initial state loaded');

                this.progressMessage = 'Initializing UI components...';
                initTheme(this);
                initSyncToggle(this);
                initImagesToggle(this);
                initConfigPanelListeners(this);
                attachScrollToTopHandler();
                console.log('UI components initialized');
                
                this.progressMessage = 'Loading existing data...';
                await this.loadFeedItemsFromDB();
                console.log('Feed items loaded from DB');
                
                if (this.isOnline && this.syncEnabled) {
                    try {
                        this.progressMessage = 'Syncing local changes...';
                        await processPendingOperations();
                        console.log('Pending operations processed.');

                        this.progressMessage = 'Syncing user state...';
                        await pullUserState();
                        console.log('User state synced');
                        
                        this.progressMessage = 'Syncing feeds...';
                        await performFeedSync(this);
                        console.log('Feed sync completed');
                        
                        await this.loadFeedItemsFromDB();
                        console.log('Feed items reloaded after sync');
                    } catch (syncError) {
                        console.warn('Sync failed, continuing with offline data:', syncError);
                        createStatusBarMessage("Sync failed, using offline data", "warning");
                    }
                }
                
                this.progressMessage = 'Processing data...';
                await this._loadAndManageAllData();
                console.log('Data loaded and managed');
                
                this.updateAllUI();
                console.log('UI updated');
                
                this._initComplete = true;
                
                this.progressMessage = 'Setting up app watchers...';
                this._setupWatchers();
                this._setupEventListeners();
                this._initObservers(); // Initialize IntersectionObserver for stale items
                this._startPeriodicSync();
                
                await this.$nextTick();
                this._initScrollObserver();
                
                console.log('App initialization complete');
                this.progressMessage = '';
                this.loading = false;
                window.appInitialized = true; // Set flag to prevent re-running
                
                try {
                    createStatusBarMessage("Initial load complete!", "success");
                } catch (statusError) {
                    console.log("Status bar not ready yet, but initialization complete");
                }
                this.updateSyncStatusMessage();
                
            } catch (error) {
                console.error("Initialization failed:", error);
                this.errorMessage = `Could not load feed: ${error.message}`;
                this.progressMessage = `Error: ${error.message}`;
                this.loading = false;
            }
        },

        // --- NEW AND MODIFIED METHODS FOR BACKGROUND SYNC ---

        performBackgroundSync: async function() {
            if (this._isSyncing || !this.isOnline || !this.syncEnabled) return;

            this._isSyncing = true;
            console.log('[Sync] Starting background sync...');
            try {
                await processPendingOperations();
                await pullUserState();
                await performFeedSync(this);
                await this._reconcileAndRefreshUI();
                console.log('[Sync] Background sync completed successfully.');
            } catch (error) {
                console.error('[Sync] Background sync failed:', error);
                createStatusBarMessage("Background sync failed", "error");
            } finally {
                this._isSyncing = false;
            }
        },

        _reconcileAndRefreshUI: async function() {
            console.log('[UI] Reconciling UI after sync...');
            const MIN_ACTIVE_DECK_SIZE = 5;

            this.hidden = await loadAndPruneHiddenItems(Object.values(this.feedItems));
            this.starred = (await loadArrayState('starred')).value || [];
            
            const correctDeckResult = await manageDailyDeck(
                this.entries, this.hidden, this.starred, this.shuffledOutItems,
                this.shuffleCount, this.filterMode, this.lastShuffleResetDate
            );
            const correctDeck = correctDeckResult.deck;
            const correctGuids = new Set(correctDeck.map(item => item.guid));
            const currentlyDisplayedGuids = new Set(this.deck.map(item => item.guid));

            const activeItemCount = this.deck.filter(item => correctGuids.has(item.guid)).length;
            console.log(`[UI] Active items in current view: ${activeItemCount}. Threshold: ${MIN_ACTIVE_DECK_SIZE}`);

            let anchorElement = null;
            let anchorTop = 0;
            const feedContainer = document.querySelector('#items');
            
            if (feedContainer) {
                const visibleElements = Array.from(feedContainer.querySelectorAll('.item-card:not(.is-stale)'));
                for (const itemEl of visibleElements) {
                    const rect = itemEl.getBoundingClientRect();
                    if (rect.top >= 0 && rect.top < window.innerHeight) {
                        anchorElement = itemEl;
                        anchorTop = rect.top;
                        break;
                    }
                }
            }

            if (activeItemCount <= MIN_ACTIVE_DECK_SIZE) {
                console.log('[UI] Active items below threshold. Performing immediate, anchored refresh.');
                this.deck = correctDeck;
                if (anchorElement) {
                    await this.$nextTick();
                    const newAnchorElement = document.querySelector(`[data-guid="${anchorElement.dataset.guid}"]`);
                    if (newAnchorElement) {
                        const newRect = newAnchorElement.getBoundingClientRect();
                        const scrollOffset = newRect.top - anchorTop;
                        console.log(`[UI] Restoring scroll position. Offset: ${scrollOffset}px`);
                        window.scrollBy(0, scrollOffset);
                    }
                }
            } else {
                console.log('[UI] Active items above threshold. Performing deferred update.');
                let reconciledDeck = [];
                for (const item of this.deck) {
                    if (correctGuids.has(item.guid)) {
                        reconciledDeck.push(item);
                    } else {
                        item.isStale = true;
                        reconciledDeck.push(item);
                        const element = document.querySelector(`[data-guid="${item.guid}"]`);
                        if (element && this.staleItemObserver) {
                            this.staleItemObserver.observe(element);
                        }
                    }
                }
                const newItems = correctDeck.filter(item => !currentlyDisplayedGuids.has(item.guid));
                this.deck = [...newItems, ...reconciledDeck];

                if (anchorElement) {
                    await this.$nextTick();
                    const newRect = anchorElement.getBoundingClientRect();
                    const scrollOffset = newRect.top - anchorTop;
                    if (scrollOffset !== 0) {
                        console.log(`[UI] Restoring scroll position after adding new items. Offset: ${scrollOffset}px`);
                        window.scrollBy(0, scrollOffset);
                    }
                }
            }
        },

        _initObservers: function() {
            this.staleItemObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) {
                        const guid = entry.target.dataset.guid;
                        console.log(`[Observer] Stale item ${guid} is off-screen. Removing.`);
                        this.deck = this.deck.filter(item => item.guid !== guid);
                        this.staleItemObserver.unobserve(entry.target);
                    }
                });
            }, { root: null, threshold: 0 });
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
            try {
                console.log('Loading and displaying deck...');
                // Business logic extracts GUIDs from the state objects
                const guidsToDisplay = this.currentDeckGuids.map(item => item.guid);
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
                console.log(`Deck loaded with ${this.deck.length} items`);
            } catch (error) {
                console.error('Error loading deck:', error);
                this.deck = [];
            }
        },

        loadFeedItemsFromDB: async function() {
            try {
                console.log('Loading feed items from database...');
                if (!this.db) {
                    console.warn('Database not available');
                    this.entries = [];
                    this.feedItems = {};
                    return;
                }
                
                const rawItemsFromDb = await getAllFeedItems();
                console.log(`Retrieved ${rawItemsFromDb.length} raw items from DB`);
                
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
                console.log(`Processed ${this.entries.length} unique entries`);
            } catch (error) {
                console.error('Error loading feed items from DB:', error);
                this.entries = [];
                this.feedItems = {};
            }
        },
        
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

        isStarred: function(guid) { return this.starred.some(e => e.guid === guid); },
        isHidden: function(guid) { return this.hidden.some(e => e.guid === guid); },
        
        toggleStar: async function(guid) {
            try {
                await toggleItemStateAndSync(this, guid, 'starred');
                const deckResult = await manageDailyDeck(
                    this.entries, this.hidden, this.starred, this.shuffledOutItems,
                    this.shuffleCount, this.filterMode, this.lastShuffleResetDate
                );
                this.deck = deckResult.deck;
                this.currentDeckGuids = deckResult.currentDeckGuids;
                this.updateSyncStatusMessage();
            } catch (error) {
                console.error('Error toggling star:', error);
                createStatusBarMessage("Error updating star status", "error");
            }
        },
        
        toggleHidden: async function(guid) {
            try {
                await toggleItemStateAndSync(this, guid, 'hidden');
                const deckResult = await manageDailyDeck(
                    this.entries, this.hidden, this.starred, this.shuffledOutItems,
                    this.shuffleCount, this.filterMode, this.lastShuffleResetDate
                );
                this.deck = deckResult.deck;
                this.currentDeckGuids = deckResult.currentDeckGuids;
                this.updateSyncStatusMessage();
            } catch (error) {
                console.error('Error toggling hidden:', error);
                createStatusBarMessage("Error updating hidden status", "error");
            }
        },
        
        processShuffle: async function() {
            try {
                await processShuffle(this);
                await this.loadAndDisplayDeck();
                this.updateCounts();
            } catch (error) {
                console.error('Error processing shuffle:', error);
                createStatusBarMessage("Error shuffling items", "error");
            }
        },
        
        async saveRssFeeds() {
            try {
                await saveSimpleState('rssFeeds', this.rssFeedsInput);
                this.rssSaveMessage = 'Feeds saved! Syncing...';
                createStatusBarMessage('RSS Feeds saved!', 'success');
                this.loading = true;
                this.progressMessage = 'Saving feeds and performing full sync...';
                await performFullSync(this);
                await this.loadFeedItemsFromDB();
                const deckResult = await manageDailyDeck(
                    this.entries, this.hidden, this.starred, this.shuffledOutItems,
                    this.shuffleCount, this.filterMode, this.lastShuffleResetDate
                );
                this.deck = deckResult.deck;
                this.currentDeckGuids = deckResult.currentDeckGuids;
                this.progressMessage = '';
                this.loading = false;
            } catch (error) {
                console.error('Error saving RSS feeds:', error);
                this.progressMessage = `Error: ${error.message}`;
                this.loading = false;
                createStatusBarMessage("Error saving feeds", "error");
            }
        },
        
        async saveKeywordBlacklist() {
            try {
                const keywordsArray = this.keywordBlacklistInput.split(/\r?\n/).map(kw => kw.trim()).filter(Boolean);
                await saveSimpleState('keywordBlacklist', keywordsArray);
                this.keywordSaveMessage = 'Keywords saved!';
                createStatusBarMessage('Keyword Blacklist saved!', 'success');
                this.updateCounts();
            } catch (error) {
                console.error('Error saving keyword blacklist:', error);
                createStatusBarMessage("Error saving keywords", "error");
            }
        },
        
        updateCounts: function() { 
            try {
                updateCounts(this); 
            } catch (error) {
                console.error('Error updating counts:', error);
            }
        },
        
        scrollToTop: function() { 
            try {
                scrollToTop(); 
            } catch (error) {
                console.error('Error scrolling to top:', error);
            }
        },
        
        _loadInitialState: async function() {
            try {
                const [syncEnabled, imagesEnabled, urlsNewTab, filterMode, themeState] = await Promise.all([
                    loadSimpleState('syncEnabled'), loadSimpleState('imagesEnabled'),
                    loadSimpleState('openUrlsInNewTabEnabled'), loadFilterMode(),
                    loadSimpleState('theme', 'userSettings')
                ]);
                this.syncEnabled = syncEnabled.value ?? true;
                this.imagesEnabled = imagesEnabled.value ?? true;
                this.openUrlsInNewTabEnabled = urlsNewTab.value ?? true;
                this.filterMode = filterMode;
                this.theme = themeState.value ?? 'dark';
                this.isOnline = isOnline();
                
                const [rssFeeds, keywordBlacklist] = await Promise.all([
                    loadSimpleState('rssFeeds'), loadSimpleState('keywordBlacklist')
                ]);
                this.rssFeedsInput = rssFeeds.value || '';
                this.keywordBlacklistInput = Array.isArray(keywordBlacklist.value) 
                    ? keywordBlacklist.value.join('\n') : '';
            } catch (error) {
                console.error('Error loading initial state:', error);
                this.syncEnabled = true; this.imagesEnabled = true;
                this.openUrlsInNewTabEnabled = true; this.filterMode = 'unread';
                this.theme = 'dark'; this.rssFeedsInput = ''; this.keywordBlacklistInput = '';
            }
        },
        
        _loadAndManageAllData: async function() {
            try {
                console.log('Loading and managing all data...');
                console.log('Current entries count before state loading:', this.entries.length);
                
                const [rawStarredState, rawShuffledOutState, currentDeckState, shuffleState] = await Promise.all([
                    loadArrayState('starred'), loadArrayState('shuffledOutGuids'),
                    loadCurrentDeck(), loadShuffleState()
                ]);
                
                const sanitizedStarred = [];
                if (Array.isArray(rawStarredState.value)) {
                    for (const item of rawStarredState.value) {
                        const guid = (typeof item === 'string') ? item : item?.guid;
                        if (guid) sanitizedStarred.push({ guid, starredAt: item?.starredAt || new Date().toISOString() });
                    }
                }
                this.starred = [...new Map(sanitizedStarred.map(item => [item.guid, item])).values()];

                const sanitizedShuffled = [];
                if (Array.isArray(rawShuffledOutState.value)) {
                     for (const item of rawShuffledOutState.value) {
                        const guid = (typeof item === 'string') ? item : item?.guid;
                        if (guid) sanitizedShuffled.push({ guid, shuffledAt: item?.shuffledAt || new Date().toISOString() });
                    }
                }
                this.shuffledOutItems = [...new Map(sanitizedShuffled.map(item => [item.guid, item])).values()];
        
                this.currentDeckGuids = Array.isArray(currentDeckState) ? currentDeckState : [];
                this.shuffleCount = shuffleState.shuffleCount || 0;
                this.lastShuffleResetDate = shuffleState.lastShuffleResetDate;
                
                this.hidden = await loadAndPruneHiddenItems(Object.values(this.feedItems));
                console.log(`Loaded ${this.hidden.length} hidden items`);
                
                console.log('About to call manageDailyDeck with entries:', this.entries.length);
                if (this.entries.length === 0 && Object.keys(this.feedItems).length > 0) {
                    this.entries = mapRawItems(Object.values(this.feedItems), formatDate) || [];
                }
                
                const deckResult = await manageDailyDeck(
                    this.entries, this.hidden, this.starred,
                    this.shuffledOutItems, this.shuffleCount, this.filterMode, this.lastShuffleResetDate
                );
                
                this.deck = deckResult.deck;
                this.currentDeckGuids = deckResult.currentDeckGuids;
                this.shuffledOutItems = deckResult.shuffledOutGuids;
                this.shuffleCount = deckResult.shuffleCount;
                this.lastShuffleResetDate = deckResult.lastShuffleResetDate;
                
                console.log(`Final deck state has ${this.currentDeckGuids.length} items`);
                await this.loadAndDisplayDeck();
                console.log('Data management complete - final deck size:', this.deck.length);
            } catch (error) {
                console.error('Error loading and managing data:', error);
                this.starred = []; this.shuffledOutItems = []; this.currentDeckGuids = [];
                this.shuffleCount = 0; this.hidden = []; this.deck = [];
            }
        },

        updateAllUI: function() { 
            try {
                this.updateCounts(); 
            } catch (error) {
                console.error('Error updating UI:', error);
            }
        },

        _setupWatchers: function() {
            if (!this._initComplete) return;
            
            this.$watch("openSettings", async (isOpen) => {
                if (isOpen) {
                    this.modalView = 'main';
                    await manageSettingsPanelVisibility(this);
                } else {
                    await saveCurrentScrollPosition();
                }
            });
            
            this.$watch('openUrlsInNewTabEnabled', () => {
                this.$nextTick(() => {
                    document.querySelectorAll('.itemdescription').forEach(el => this.handleEntryLinks(el));
                });
            });
            
            this.$watch("modalView", async () => manageSettingsPanelVisibility(this));
            
            this.$watch('filterMode', async (newMode) => {
                if (!this._initComplete) return;
                try {
                    await setFilterMode(this, newMode);
                    if (newMode === 'unread') {
                        const deckResult = await manageDailyDeck(
                            this.entries, this.hidden, this.starred, this.shuffledOutItems,
                            this.shuffleCount, this.filterMode, this.lastShuffleResetDate
                        );
                        this.deck = deckResult.deck;
                        this.currentDeckGuids = deckResult.currentDeckGuids;
                    }
                    this.scrollToTop();
                } catch (error) {
                    console.error('Error in filterMode watcher:', error);
                }
            });
        },

        _setupEventListeners: function() {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && this._initComplete) {
                    this.performBackgroundSync();
                }
            });

            const backgroundSync = async () => {
                if (!this.syncEnabled || !this.isOnline) return;
                try {
                    await performFeedSync(this);
                    await pullUserState();
                    await this._loadAndManageAllData();
                    this.deckManaged = true;
                } catch (error) {
                    console.error('Background sync failed:', error);
                }
            };

            window.addEventListener('online', async () => {
                this.isOnline = true;
                this.updateSyncStatusMessage();
                if (this.syncEnabled) {
                    try {
                        await processPendingOperations();
                        await backgroundSync();
                    } catch (error) {
                        console.error('Error handling online event:', error);
                    }
                }
            });
            
            window.addEventListener('offline', () => {
                this.isOnline = false;
                this.updateSyncStatusMessage();
            });
            
            window.addEventListener('beforeunload', () => {
                try {
                    if (this.filterMode === 'unread' && !this.openSettings) {
                        saveCurrentScrollPosition();
                    }
                } catch (error) {
                    console.error('Error saving scroll position on beforeunload:', error);
                }
            });
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
                try {
                    await performFeedSync(this);
                    await pullUserState();
                    await this._loadAndManageAllData();
                    this.deckManaged = true;
                } catch (error) {
                    console.error('Periodic sync failed:', error);
                }
            }, SYNC_INTERVAL_MS);
        },

        _initScrollObserver: function() {
            try {
                const observer = new IntersectionObserver(async (entries) => {}, {
                    root: document.querySelector('#items'),
                    rootMargin: '0px',
                    threshold: 0.1
                });
                const feedContainer = document.querySelector('#items');
                if (!feedContainer) {
                    console.warn('Feed container not found for scroll observer');
                    return;
                }
                
                const observeElements = () => {
                    feedContainer.querySelectorAll('[data-guid]').forEach(item => {
                        observer.observe(item);
                    });
                };
                
                observeElements();
                
                const mutationObserver = new MutationObserver(() => {
                    observer.disconnect();
                    observeElements();
                });
                
                mutationObserver.observe(feedContainer, { childList: true, subtree: true });
                this.scrollObserver = observer;
            } catch (error) {
                console.error('Error initializing scroll observer:', error);
            }
        },

        handleEntryLinks: function(element) {
            if (!element) return;
            try {
                element.querySelectorAll('a').forEach(link => {
                    if (link.hostname !== window.location.hostname) {
                        if (this.openUrlsInNewTabEnabled) {
                            link.setAttribute('target', '_blank');
                            link.setAttribute('rel', 'noopener noreferrer');
                        } else {
                            link.removeAttribute('target');
                        }
                    }
                });
            } catch (error) {
                console.error('Error handling entry links:', error);
            }
        },
    };
}

// Register the rssApp component with Alpine.
Alpine.data('rssApp', rssApp);

// Start Alpine to initialize the application.
Alpine.start();