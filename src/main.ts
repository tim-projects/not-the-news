// @filepath: src//main.ts

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
} from './js/data/database.ts';
import { formatDate, mapRawItem, mapRawItems } from './js/helpers/dataUtils.ts';
import {
    loadCurrentDeck,
    toggleItemStateAndSync,
    loadAndPruneReadItems,
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
} from './js/ui/uiUpdaters.ts';
import {
    initSyncToggle,
    initImagesToggle,
    initTheme,
    initConfigPanelListeners
} from './js/ui/uiInitializers.ts';
import { manageDailyDeck, processShuffle } from './js/helpers/deckManager.ts';
import { isOnline } from './js/utils/connectivity.ts';
import { MappedFeedItem, ReadItem, StarredItem, DeckItem, ShuffledOutItem, RssFeedsConfig, AppState } from '@/types/app.ts';

export function rssApp(): AppState {
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
        shuffledOutGuids: [],
        settingsButtonClicks: 0, // Added for debugging
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
        db: null,
        entries: [],


        // --- Core Methods ---
        initApp: async function(this: AppState): Promise<void> {
            
            try {
                console.log('Starting app initialization...');
                this.progressMessage = 'Connecting to database...';
                this.db = await initDb();
                console.log('Database initialized');
                console.log('Initial openSettings value:', this.openSettings);
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
                (window as any).appInitialized = true; // Cast window to any
                this._setupWatchers();
                // this._setupEventListeners();
                // this._initObservers();
                // this._startPeriodicSync();
                // // await this.$nextTick();
                // // //                 this._initScrollObserver();
                console.log('App initialization and background sync complete.');

                try {
                    createStatusBarMessage(this, "App ready", 'success');
                } catch (statusError: any) {
                    console.log("Status bar not ready yet, but initialization complete");
                }
                this.updateSyncStatusMessage();
            } catch (error: any) {
                console.error("Initialization failed:", error);
                this.errorMessage = `Could not load feed: ${error.message}`;
                this.progressMessage = `Error: ${error.message}`;
                this.loading = false;
            }
        },

        performBackgroundSync: async function(this: AppState): Promise<void> {
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
            } catch (error: any) {
                console.error('[Sync] Background sync failed:', error);
                createStatusBarMessage(this, "Background sync failed", 'error');
            } finally {
                this._isSyncing = false;
            }
        },

        _reconcileAndRefreshUI: async function(this: AppState): Promise<void> {
            console.log('[UI] Reconciling UI after sync...');
            console.log('[UI] _reconcileAndRefreshUI params:', { deck: this.deck, read: this.read, starred: this.starred, shuffledOutGuids: this.shuffledOutGuids, shuffleCount: this.shuffleCount, filterMode: this.filterMode, lastShuffleResetDate: this.lastShuffleResetDate });
            this.read = await loadAndPruneReadItems(Object.values(this.feedItems));
            this.starred = (await loadArrayState('starred')).value || [];
            const correctDeckResult = await manageDailyDeck(
                Array.from(this.entries), this.read, this.starred, this.shuffledOutGuids,
                this.shuffleCount, this.filterMode, this.lastShuffleResetDate
            );
            console.log('[UI] correctDeckResult:', correctDeckResult);
            let correctDeck: MappedFeedItem[] = [];
            if (correctDeckResult && correctDeckResult.deck) {
                correctDeck = correctDeckResult.deck;
            }
            console.log('[UI] correctDeck:', correctDeck);
            this.deck = correctDeck;
        },

        _initObservers: function(this: AppState): void {
            this.staleItemObserver = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
                entries.forEach((entry: IntersectionObserverEntry) => {
                    if (!entry.isIntersecting) {
                        const guid = (entry.target as HTMLElement).dataset.guid; // Cast to HTMLElement to access dataset
                        console.log(`[Observer] Stale item ${guid} is off-screen. Removing.`);
                        this.deck = this.deck.filter(item => item.guid !== guid);
                        this.staleItemObserver?.unobserve(entry.target); // Use optional chaining
                    }
                });
            }, { root: null, threshold: 0 });
        },

        updateSyncStatusMessage: async function(this: AppState): Promise<void> {
            const online = isOnline();
            let message = '';
            let show = false;
            if (!online) { message = 'Offline.'; show = true; } 
            else if (!this.syncEnabled) { message = 'Sync is disabled.'; show = true; }
            this.syncStatusMessage = message;
            this.showSyncStatus = show;
        },
        
        loadAndDisplayDeck: async function(this: AppState): Promise<void> {
            try {
                console.log('Loading and displaying deck...');
                console.log('[loadAndDisplayDeck] this.read:', JSON.parse(JSON.stringify(this.read)));
                const guidsToDisplay = this.currentDeckGuids.map(item => item.guid);
                const items: MappedFeedItem[] = [];
                const readSet = new Set(this.read.map(h => h.guid));
                const starredSet = new Set(this.starred.map(s => s.guid));
                const seenGuidsForDeck = new Set<string>();
                for (const guid of guidsToDisplay) {
                    if (typeof guid !== 'string' || !guid) continue;
                    const item = this.feedItems[guid];
                    if (item && item.guid && !seenGuidsForDeck.has(item.guid)) {
                        const mappedItem = mapRawItem(item, formatDate);
                        if (mappedItem) { // Ensure mappedItem is not null
                            mappedItem.isRead = readSet.has(mappedItem.guid);
                            mappedItem.isStarred = starredSet.has(mappedItem.guid);
                            items.push(mappedItem);
                            seenGuidsForDeck.add(mappedItem.guid);
                        }
                    }
                }
                console.log('[loadAndDisplayDeck] items before deck assignment:', JSON.parse(JSON.stringify(items)));
                this.deck = Array.isArray(items) ? items.sort((a, b) => b.timestamp - a.timestamp) : [];
                console.log('[loadAndDisplayDeck] this.deck after assignment:', JSON.parse(JSON.stringify(this.deck)));
                console.log(`Deck loaded with ${this.deck.length} items`);
            } catch (error: any) {
                console.error('Error loading deck:', error);
                this.deck = [];
            }
        },

        loadFeedItemsFromDB: async function(this: AppState): Promise<void> {
            try {
                console.log('Loading feed items from database...');
                if (!this.db) {
                    console.warn('Database not available');
                    this.entries = []; this.feedItems = {}; return;
                }
                const rawItemsFromDb = await getAllFeedItems();
                console.log(`Retrieved ${rawItemsFromDb.length} raw items from DB`);
                this.feedItems = {};
                const uniqueEntries: any[] = []; // Type should be more specific if possible
                const seenGuids = new Set<string>();
                rawItemsFromDb.forEach(item => {
                    if (item && item.guid && !seenGuids.has(item.guid)) {
                        this.feedItems[item.guid] = item;
                        uniqueEntries.push(item);
                        seenGuids.add(item.guid);
                    }
                });
                this.entries = mapRawItems(uniqueEntries, formatDate) || [];
                console.log(`Processed ${this.entries.length} unique entries`);
            } catch (error: any) {
                console.error('Error loading feed items from DB:', error);
                this.entries = []; this.feedItems = {};
            }
        },        
        get filteredEntries(): MappedFeedItem[] {
            if (!Array.isArray(this.deck)) this.deck = [];
            let filtered: MappedFeedItem[] = [];
            const readMap = new Map(this.read.map(h => [h.guid, h.readAt]));
            const starredMap = new Map(this.starred.map(s => [s.guid, s.starredAt]));
            switch (this.filterMode) {
                case "unread": filtered = this.deck.filter(item => !item.isStale && !readMap.has(item.guid)); break;
                case "all": filtered = this.entries; break;
                case "read": filtered = this.entries.filter(e => readMap.has(e.guid)).sort((a, b) => (new Date(readMap.get(b.guid) || 0).getTime()) - (new Date(readMap.get(a.guid) || 0).getTime())); break;
                case "starred": filtered = this.entries.filter(e => starredMap.has(e.guid)).sort((a, b) => (new Date(starredMap.get(b.guid) || 0).getTime()) - (new Date(starredMap.get(a.guid) || 0).getTime())); break;
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

        isStarred: function(this: AppState, guid: string): boolean { return this.starred.some(e => e.guid === guid); },
        
        // --- FIX: Centralize UI updates ---
        toggleStar: async function(this: AppState, guid: string): Promise<void> {
            try {
                await toggleItemStateAndSync(this, guid, 'starred');
                await this._reconcileAndRefreshUI(); // Use the master UI update function
                this.updateSyncStatusMessage();
            } catch (error: any) {
                console.error('Error toggling star:', error);
                createStatusBarMessage(this, "Error updating star status", 'error');
            }
        },
        
        // --- FIX: Centralize UI updates ---
        toggleRead: async function(this: AppState, guid: string): Promise<void> {
            try {
                await toggleItemStateAndSync(this, guid, 'read');
                // Force Alpine to re-evaluate filteredEntries and re-render the deck
                this.deck = [...this.deck];
                this.updateSyncStatusMessage();
                this.updateCounts();
            } catch (error: any) {
                console.error('Error toggling read:', error);
                createStatusBarMessage(this, "Error updating read status", 'error');
            }
        },
        
        processShuffle: async function(this: AppState): Promise<void> {
            try {
                await processShuffle(this);
                await this.loadAndDisplayDeck();
                this.updateCounts();
            } catch (error: any) {
                console.error('Error processing shuffle:', error);
                createStatusBarMessage(this, "Error shuffling items", 'error');
            }
        },        
        saveRssFeeds: async function(this: AppState): Promise<void> {
            const feedsData: RssFeedsConfig = {};
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
            createStatusBarMessage(this, 'RSS Feeds saved!', 'success');
            this.loading = true;
            this.progressMessage = 'Saving feeds and performing full sync...';
            await performFullSync(this);
            await this.loadFeedItemsFromDB();
            const deckResult = await manageDailyDeck(
                this.entries, this.read, this.starred, this.shuffledOutGuids,
                this.shuffleCount, this.filterMode, this.lastShuffleResetDate
            );
            this.deck = deckResult.deck;
            this.currentDeckGuids = deckResult.currentDeckGuids;
            this.progressMessage = '';
            this.loading = false;
        },
        
        async saveKeywordBlacklist(this: AppState): Promise<void> {
            try {
                const keywordsArray = this.keywordBlacklistInput.split(/\r?\n/).map(kw => kw.trim()).filter(Boolean);
                await saveSimpleState('keywordBlacklist', keywordsArray);
                this.keywordSaveMessage = 'Keywords saved!';
                createStatusBarMessage(this, 'Keyword Blacklist saved!', 'success');
                this.updateCounts();
            } catch (error: any) {
                console.error('Error saving keyword blacklist:', error);
                createStatusBarMessage(this, "Error saving keywords", 'error');
            }
        },        
        updateCounts: async function(this: AppState): Promise<void> { 
            try { 
                await updateCounts(this); 
            } catch (error: any) { 
                console.error('Error updating counts:', error); 
            } 
        },        
        scrollToTop: function(this: AppState): void { 
            try { 
                scrollToTop(); 
            } catch (error: any) { 
                console.error('Error scrolling to top:', error); 
            } 
        },

        _loadInitialState: async function(this: AppState): Promise<void> {
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
                let allRssUrls: string[] = [];
                if (rssFeeds.value && typeof rssFeeds.value === 'object') {
                    for (const category in rssFeeds.value) {
                        if (typeof rssFeeds.value[category] === 'object') {
                            for (const subcategory in rssFeeds.value[category]) {
                                if (Array.isArray(rssFeeds.value[category][subcategory])) {
                                    rssFeeds.value[category][subcategory].forEach((feed: { url?: string }) => {
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
            } catch (error: any) {
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
        _loadAndManageAllData: async function(this: AppState, initialEntries?: MappedFeedItem[]): Promise<void> {
            try {
                console.log('Loading and managing all data...');
                
                const [rawStarredState, rawShuffledOutState, currentDeckState, shuffleState, rawReadState] = await Promise.all([
                    loadArrayState('starred'),
                    loadArrayState('shuffledOutGuids'),
                    loadCurrentDeck(),
                    loadShuffleState(),
                    loadArrayState('read')
                ]);
                
                const sanitizedStarred: StarredItem[] = [];
                if (Array.isArray(rawStarredState.value)) {
                    for (const item of rawStarredState.value) {
                        const guid = (typeof item === 'string') ? item : item?.guid;
                        if (guid) sanitizedStarred.push({ guid, starredAt: item?.starredAt || new Date().toISOString() });
                    }
                }
                this.starred = [...new Map(sanitizedStarred.map(item => [item.guid, item])).values()];

                const sanitizedShuffled: ShuffledOutItem[] = [];
                if (Array.isArray(rawShuffledOutState.value)) {
                     for (const item of rawShuffledOutState.value) {
                        const guid = (typeof item === 'string') ? item : item?.guid;
                        if (guid) sanitizedShuffled.push({ guid, shuffledAt: item?.shuffledAt || new Date().toISOString() });
                    }
                }
                this.shuffledOutGuids = [...new Map(sanitizedShuffled.map(item => [item.guid, item])).values()];

                const sanitizedRead: ReadItem[] = [];
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
                    Array.from(this.entries), this.read, this.starred, this.shuffledOutGuids,
                    this.shuffleCount, this.filterMode, this.lastShuffleResetDate
                );
                
                // Ensure deckResult is valid before proceeding
                let managedDeck: MappedFeedItem[] = [];
                let managedCurrentDeckGuids: DeckItem[] = [];
                let managedShuffledOutGuids: ShuffledOutItem[] = [];
                let managedShuffleCount: number = 0;
                let managedLastShuffleResetDate: string | null = null;

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
                this.shuffledOutGuids = managedShuffledOutGuids;
                this.shuffleCount = managedShuffleCount;
                this.lastShuffleResetDate = managedLastShuffleResetDate;
                
                await this.loadAndDisplayDeck();
                console.log('Data management complete - final deck size:', this.deck.length);
            } catch (error: any) {
                console.error('Error loading and managing data:', error);
                this.starred = []; this.shuffledOutGuids = []; this.currentDeckGuids = [];
                this.shuffleCount = 0; this.read = []; this.deck = [];
            }
        },
        updateAllUI: async function(this: AppState): Promise<void> { 
            try { 
                this.updateCounts();
                await this.loadAndDisplayDeck();
            } 
            catch (error: any) { console.error('Error updating UI:', error); } 
        },
        _setupWatchers: function(this: AppState): void {
            if (!this._initComplete) return; 
            
            this.$watch("openSettings", async (isOpen: boolean) => {
                console.log('openSettings changed to:', isOpen);
                if (isOpen) {


                } else {
                    await saveCurrentScrollPosition();
                }
            });
            
            this.$watch('openUrlsInNewTabEnabled', () => {
                this.$nextTick(() => {
                    document.querySelectorAll('.itemdescription').forEach((el: Element) => this.handleEntryLinks(el));
                });
            });
            
            // this.$watch("modalView", async () => manageSettingsPanelVisibility(this));
            
            this.$watch('filterMode', async (newMode: string) => {
                if (!this._initComplete) return;
                try {
                    await setFilterMode(this, newMode);
                    if (newMode === 'unread') {
                        const deckResult = await manageDailyDeck(
                            this.entries, this.read, this.starred, this.shuffledOutGuids,
                            this.shuffleCount, this.filterMode, this.lastShuffleResetDate
                        );
                        this.deck = deckResult.deck;
                        this.currentDeckGuids = deckResult.currentDeckGuids;
                    }
                    this.scrollToTop();
                } catch (error: any) {
                    console.error('Error in filterMode watcher:', error);
                }
            });
        },
        _setupEventListeners: function(this: AppState): void {
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
                } catch (error: any) {
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
                    } catch (error: any) {
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
                } catch (error: any) {
                    console.error('Error saving scroll position on beforeunload:', error);
                }
            });
        },

        _startPeriodicSync: function(this: AppState): void {
            let lastActivityTimestamp = Date.now();
            const recordActivity = () => lastActivityTimestamp = Date.now();
            ["mousemove", "mousedown", "keydown", "scroll", "click", "visibilitychange", "focus"].forEach((event: string) => {
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
                } catch (error: any) {
                    console.error('Periodic sync failed:', error);
                }
            }, SYNC_INTERVAL_MS);
        },
        _initScrollObserver: function(this: AppState): void {
            try {
                const observer = new IntersectionObserver(async () => {}, {
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
                    feedContainer.querySelectorAll('[data-guid]').forEach((item: Element) => {
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
            } catch (error: any) {
                console.error('Error initializing scroll observer:', error);
            }
        },
        handleEntryLinks: function(this: AppState, element: HTMLElement): void {
            if (!element) return;
            try {
                element.querySelectorAll('a').forEach((link: HTMLAnchorElement) => {
                    if (link.hostname !== window.location.hostname) {
                        if (this.openUrlsInNewTabEnabled) {
                            link.setAttribute('target', '_blank');
                            link.setAttribute('rel', 'noopener noreferrer');
                        } else {
                            link.removeAttribute('target');
                        }
                    }
                });
            } catch (error: any) {
                console.error('Error handling entry links:', error);
            }
        },    };
}

// Register the rssApp component with Alpine.
Alpine.data('rssApp', rssApp);

// Start Alpine to initialize the application.
Alpine.start();