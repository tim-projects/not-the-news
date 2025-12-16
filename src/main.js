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
    pruneStaleRead,
    loadAndPruneReadItems,
    saveShuffleState,
    loadShuffleState,
    setFilterMode,
    loadFilterMode
} from './js/helpers/userStateUtils.ts';
import {
    updateCounts,
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
        read: [],
        starred: [],
        currentDeckGuids: [],
        shuffledOutItems: [],
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
        _initComplete: false,
        staleItemObserver: null,
        _isSyncing: false,

        // --- Core Methods ---
        initApp: async function() {
            
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
                this.$nextTick(() => { // Wrap in $nextTick to ensure DOM is ready
                    initConfigPanelListeners(this);
                });

                attachScrollToTopHandler();
                console.log('UI components initialized');
                this.progressMessage = 'Loading existing data...';
                await this.loadFeedItemsFromDB();
                this.entries = mapRawItems(Object.values(this.feedItems), formatDate) || [];
                await this._loadAndManageAllData();
                this.updateAllUI();
                console.log('Initial UI rendered from local cache.');
                this.loading = false;
                this.progressMessage = '';
                console.log('App is visible. Proceeding with background sync.');
                console.log(`[Sync Check] Before conditional sync: isOnline=${this.isOnline}, syncEnabled=${this.syncEnabled}`);
                if (this.isOnline && this.syncEnabled) {
                    console.log(`[Sync] isOnline: ${this.isOnline}, syncEnabled: ${this.syncEnabled}. Calling performBackgroundSync.`);
                    await this.performBackgroundSync();
                }
                this._initComplete = true;
                window.appInitialized = true;
                this._setupWatchers();
                // this._setupEventListeners();
                // this._initObservers();
                // this._startPeriodicSync();
                // // await this.$nextTick();
                // // //                 this._initScrollObserver();
                console.log('App initialization and background sync complete.');

                try {
                    createStatusBarMessage("App ready", "success");
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

        performBackgroundSync: async function() {
            console.log('[Sync] Entering performBackgroundSync.');
            console.log('[Sync] performBackgroundSync: _isSyncing:', this._isSyncing, 'isOnline:', this.isOnline, 'syncEnabled:', this.syncEnabled);
            if (this._isSyncing || !this.isOnline || !this.syncEnabled) return;
            this._isSyncing = true;
            console.log('[Sync] Starting background sync...');
            try {
                await processPendingOperations();
                await pullUserState();
                await performFeedSync(this);
                await this.loadFeedItemsFromDB();
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
            console.log('[UI] _reconcileAndRefreshUI params:', { deck: this.deck, read: this.read, starred: this.starred, shuffledOutItems: this.shuffledOutItems, shuffleCount: this.shuffleCount, filterMode: this.filterMode, lastShuffleResetDate: this.lastShuffleResetDate });
            const MIN_ACTIVE_DECK_SIZE = 5;
            this.read = await loadAndPruneReadItems(Object.values(this.feedItems));
            this.starred = (await loadArrayState('starred')).value || [];
            const correctDeckResult = await manageDailyDeck(
                Array.from(this.entries), this.read, this.starred, this.shuffledOutItems,
                this.shuffleCount, this.filterMode, this.lastShuffleResetDate
            );
            console.log('[UI] correctDeckResult:', correctDeckResult);
            let correctDeck = [];
            if (correctDeckResult && correctDeckResult.deck) {
                correctDeck = correctDeckResult.deck;
            }
            console.log('[UI] correctDeck:', correctDeck);

            let correctGuids = new Set();
            if (correctDeck && Array.isArray(correctDeck)) {
                correctGuids = new Set(correctDeck.map(item => item.guid));
            }
            this.deck = correctDeck;
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
            if (!online) { message = 'Offline.'; show = true; } 
            else if (!this.syncEnabled) { message = 'Sync is disabled.'; show = true; }
            this.syncStatusMessage = message;
            this.showSyncStatus = show;
        },
        
        loadAndDisplayDeck: async function() {
            try {
                console.log('Loading and displaying deck...');
                console.log('[loadAndDisplayDeck] this.read:', JSON.parse(JSON.stringify(this.read)));
                const guidsToDisplay = this.currentDeckGuids.map(item => item.guid);
                const items = [];
                const readSet = new Set(this.read.map(h => h.guid));
                const starredSet = new Set(this.starred.map(s => s.guid));
                const seenGuidsForDeck = new Set();
                for (const guid of guidsToDisplay) {
                    if (typeof guid !== 'string' || !guid) continue;
                    const item = this.feedItems[guid];
                    if (item && item.guid && !seenGuidsForDeck.has(item.guid)) {
                        const mappedItem = mapRawItem(item, formatDate);
                        mappedItem.isRead = readSet.has(mappedItem.guid);
                        mappedItem.isStarred = starredSet.has(mappedItem.guid);
                        items.push(mappedItem);
                        seenGuidsForDeck.add(mappedItem.guid);
                    }
                }
                console.log('[loadAndDisplayDeck] items before deck assignment:', JSON.parse(JSON.stringify(items)));
                this.deck = Array.isArray(items) ? items.sort((a, b) => b.timestamp - a.timestamp) : [];
                console.log('[loadAndDisplayDeck] this.deck after assignment:', JSON.parse(JSON.stringify(this.deck)));
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
                    this.entries = []; this.feedItems = {}; return;
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
                this.entries = []; this.feedItems = {};
            }
        },
        
        get filteredEntries() {
            if (!Array.isArray(this.deck)) this.deck = [];
            let filtered = [];
            const readMap = new Map(this.read.map(h => [h.guid, h.readAt]));
            const starredMap = new Map(this.starred.map(s => [s.guid, s.starredAt]));
            switch (this.filterMode) {
                case "unread": filtered = this.deck.filter(item => !item.isStale && !readMap.has(item.guid)); break;
                case "all": filtered = this.entries; break;
                case "read": filtered = this.entries.filter(e => readMap.has(e.guid)).sort((a, b) => new Date(readMap.get(b.guid)).getTime() - new Date(readMap.get(a.guid)).getTime()); break;
                case "starred": filtered = this.entries.filter(e => starredMap.has(e.guid)).sort((a, b) => new Date(starredMap.get(b.guid)).getTime() - new Date(starredMap.get(a.guid)).getTime()); break;
            }
            if (this.filterMode !== 'unread') {
                filtered = filtered.map(e => ({ ...e, isRead: readMap.has(e.guid), isStarred: starredMap.has(e.guid) }));
            }
            const keywordBlacklist = (this.keywordBlacklistInput ?? '').split(/\r?\n/).map(kw => kw.trim().toLowerCase()).filter(kw => kw.length > 0);
            if (keywordBlacklist.length > 0) {
                filtered = filtered.filter(item => {
                    const searchable = `${item.title} ${item.description}`.toLowerCase();
                    return !keywordBlacklist.some(keyword => searchable.includes(keyword));
                });
            }
            return filtered;
        },

        isStarred: function(guid) { return this.starred.some(e => e.guid === guid); },
        
        // --- FIX: Centralize UI updates ---
        toggleStar: async function(guid) {
            try {
                await toggleItemStateAndSync(this, guid, 'starred');
                await this._reconcileAndRefreshUI(); // Use the master UI update function
                this.updateSyncStatusMessage();
            } catch (error) {
                console.error('Error toggling star:', error);
                createStatusBarMessage("Error updating star status", "error");
            }
        },
        
        // --- FIX: Centralize UI updates ---
        toggleRead: async function(guid) {
            try {
                await toggleItemStateAndSync(this, guid, 'read');
                // Force Alpine to re-evaluate filteredEntries and re-render the deck
                this.deck = [...this.deck];
                this.updateSyncStatusMessage();
                this.updateCounts();
            } catch (error) {
                console.error('Error toggling read:', error);
                createStatusBarMessage("Error updating read status", "error");
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
        
                saveRssFeeds: async function() {
            const feedsData = {};
            const defaultCategory = "Uncategorized";
            const defaultSubcategory = "Default";

            feedsData[defaultCategory] = {};
            feedsData[defaultCategory][defaultSubcategory] = [];

            this.rssFeedsInput.split(/\r?\n/)
                .map(url => url.trim())
                .filter(Boolean)
                .forEach(url => {
                    feedsData[defaultCategory][defaultSubcategory].push({ url: url });
                });

            await saveSimpleState('rssFeeds', feedsData); // Send the nested object to the backend
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true;
            this.progressMessage = 'Saving feeds and performing full sync...';
            await performFullSync(this);
            await this.loadFeedItemsFromDB();
            const deckResult = await manageDailyDeck(
                this.entries, this.read, this.starred, this.shuffledOutItems,
                this.shuffleCount, this.filterMode, this.lastShuffleResetDate
            );
            this.deck = deckResult.deck;
            this.currentDeckGuids = deckResult.currentDeckGuids;
            this.progressMessage = '';
            this.loading = false;
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
                
                const [rssFeeds, keywordBlacklist] = await Promise.all([
                    loadSimpleState('rssFeeds'),
                    loadSimpleState('keywordBlacklist')
                ]);
                // Convert nested object of categories/subcategories to multi-line string of URLs
                let allRssUrls = [];
                if (rssFeeds.value && typeof rssFeeds.value === 'object') {
                    for (const category in rssFeeds.value) {
                        if (typeof rssFeeds.value[category] === 'object') {
                            for (const subcategory in rssFeeds.value[category]) {
                                if (Array.isArray(rssFeeds.value[category][subcategory])) {
                                    rssFeeds.value[category][subcategory].forEach(feed => {
                                        if (feed && feed.url) {
                                            allRssUrls.push(feed.url);
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
                this.rssFeedsInput = allRssUrls.join('\n');
                this.keywordBlacklistInput = Array.isArray(keywordBlacklist.value) 
                    ? keywordBlacklist.value.join('\n') 
                    : '';
            } catch (error) {
                console.error('Error loading initial state:', error);
                this.syncEnabled = true;
                this.imagesEnabled = true;
                this.openUrlsInNewTabEnabled = true;
                this.filterMode = 'unread';
                this.theme = 'dark';
                this.rssFeedsInput = '';
                this.keywordBlacklistInput = '';
            }
        },
        
        _loadAndManageAllData: async function(initialEntries) {
            try {
                console.log('Loading and managing all data...');
                
                const [rawStarredState, rawShuffledOutState, currentDeckState, shuffleState, rawReadState] = await Promise.all([
                    loadArrayState('starred'),
                    loadArrayState('shuffledOutGuids'),
                    loadCurrentDeck(),
                    loadShuffleState(),
                    loadArrayState('read')
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

                const sanitizedRead = [];
                if (Array.isArray(rawReadState.value)) {
                    for (const item of rawReadState.value) {
                        const guid = (typeof item === 'string') ? item : item?.guid;
                        if (guid) sanitizedRead.push({ guid, readAt: item?.readAt || new Date().toISOString() });
                    }
                }
                this.read = [...new Map(sanitizedRead.map(item => [item.guid, item])).values()];
        
                this.currentDeckGuids = Array.isArray(currentDeckState) ? currentDeckState : [];
                this.shuffleCount = shuffleState.shuffleCount || 0;
                this.lastShuffleResetDate = shuffleState.lastShuffleResetDate;
                
                this.read = await loadAndPruneReadItems(Object.values(this.feedItems));
                console.log(`Loaded ${this.read.length} read items`);
                
                // Assign initialEntries to this.entries here
                this.entries = initialEntries || [];

                const deckResult = await manageDailyDeck(
                    Array.from(this.entries), this.read, this.starred, this.shuffledOutItems,
                    this.shuffleCount, this.filterMode, this.lastShuffleResetDate
                );
                
                // Ensure deckResult is valid before proceeding
                let managedDeck = [];
                let managedCurrentDeckGuids = [];
                let managedShuffledOutGuids = [];
                let managedShuffleCount = 0;
                let managedLastShuffleResetDate = null;

                if (deckResult && Array.isArray(deckResult.deck)) {
                    managedDeck = deckResult.deck;
                    managedCurrentDeckGuids = deckResult.currentDeckGuids || [];
                    managedShuffledOutGuids = deckResult.shuffledOutGuids || [];
                    managedShuffleCount = deckResult.shuffleCount || 0;
                    managedLastShuffleResetDate = deckResult.lastShuffleResetDate || null;
                } else {
                    console.warn('[UI] manageDailyDeck returned an invalid deckResult. Using default empty values.');
                }

                this.currentDeckGuids = managedCurrentDeckGuids; // Move this line up
                this.deck = managedDeck;
                this.shuffledOutItems = managedShuffledOutGuids;
                this.shuffleCount = managedShuffleCount;
                this.lastShuffleResetDate = managedLastShuffleResetDate;
                
                await this.loadAndDisplayDeck();
                console.log('Data management complete - final deck size:', this.deck.length);
            } catch (error) {
                console.error('Error loading and managing data:', error);
                this.starred = []; this.shuffledOutItems = []; this.currentDeckGuids = [];
                this.shuffleCount = 0; this.read = []; this.deck = [];
            }
        },

        updateAllUI: async function() { 
            try { 
                this.updateCounts();
                await this.loadAndDisplayDeck();
            } 
            catch (error) { console.error('Error updating UI:', error); } 
        },

        _setupWatchers: function() {
            if (!this._initComplete) return; 
            
            this.$watch("openSettings", async (isOpen) => {
                if (isOpen) {

                    // await manageSettingsPanelVisibility(this);
                } else {
                    await saveCurrentScrollPosition();
                }
            });
            
            this.$watch('openUrlsInNewTabEnabled', () => {
                this.$nextTick(() => {
                    document.querySelectorAll('.itemdescription').forEach(el => this.handleEntryLinks(el));
                });
            });
            
            // this.$watch("modalView", async () => manageSettingsPanelVisibility(this));
            
            this.$watch('filterMode', async (newMode) => {
                if (!this._initComplete) return;
                try {
                    await setFilterMode(this, newMode);
                    if (newMode === 'unread') {
                        const deckResult = await manageDailyDeck(
                            this.entries, this.read, this.starred, this.shuffledOutItems,
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