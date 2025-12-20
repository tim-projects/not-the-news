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
    closeDb,
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
    manageSettingsPanelVisibility,
    scrollToTop,
    attachScrollToTopHandler,
    saveCurrentScrollPosition,
    createStatusBarMessage
} from './js/ui/uiUpdaters.ts';
import {
    initSyncToggle,
    initImagesToggle,
    initTheme,
    initScrollPosition,
    initConfigPanelListeners
} from './js/ui/uiInitializers.ts';
import { manageDailyDeck, processShuffle } from './js/helpers/deckManager.ts';
import { isOnline } from './js/utils/connectivity.ts';
import { MappedFeedItem, DeckItem, AppState } from './types/app.ts';

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
        entries: [],
        read: [],
        starred: [],
        currentDeckGuids: [],
        shuffledOutGuids: [],
        errorMessage: '',
        isOnline: isOnline(),
        deckManaged: false,

        syncStatusMessage: '',
        showSyncStatus: false,
        theme: 'dark', // Default theme
        keywordSaveMessage: '', // Initialized as empty string
        rssSaveMessage: '', // Initialized as empty string
        _lastFilterHash: '',
        _cachedFilteredEntries: null,
        scrollObserver: null,
        db: null,
        _initComplete: false,
        staleItemObserver: null,
        _isSyncing: false,
        lastShuffleResetDate: null, // Initialized as null

        // --- Core Methods ---
        initApp: async function(this: AppState): Promise<void> {
            try {
                this.progressMessage = 'Connecting to database...';
                this.db = await initDb();
                
                this.progressMessage = 'Loading settings...';
                await this._loadInitialState();
                
                if (this.isOnline) {
                    this.progressMessage = 'Syncing latest content...'; // Set specific sync message
                    // Pull user state first, as feed items depend on it.
                    await pullUserState();
                    // Then sync feed items.
                    await performFeedSync(this);
                    
                    // Now that both syncs are complete, load all data into app state.
                    await this._loadAndManageAllData();
                    createStatusBarMessage(this, "Initial sync complete!");
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
                this._initObservers();

                this.progressMessage = '';
                this.loading = false;
                
                await this.updateSyncStatusMessage();
            } catch (error: any) {
                console.error("Initialization failed:", error);
                this.errorMessage = `Could not load feed: ${error.message}`;
                this.progressMessage = `Error: ${error.message}`;
                createStatusBarMessage(this, `Could not load feed: ${error.message}`);
            }
        },

        performBackgroundSync: async function(this: AppState): Promise<void> {
            if (!this.syncEnabled || !this.isOnline) return;
            console.log('Performing immediate background sync...');
            this.progressMessage = 'Syncing...';
            this.loading = true;
            try {
                await performFeedSync(this);
                await pullUserState();
                await this._loadAndManageAllData();
                this.deckManaged = true;
                this.progressMessage = '';
                this.loading = false;
                console.log('Immediate background sync complete.');
                createStatusBarMessage(this, 'Sync complete!');
            } catch (error: any) {
                console.error('Immediate background sync failed:', error);
                this.progressMessage = 'Sync Failed!';
                this.loading = false;
                createStatusBarMessage(this, `Sync failed: ${error.message}`);
            }
        },

        updateSyncStatusMessage: async function(this: AppState): Promise<void> {
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
        
        loadAndDisplayDeck: async function(this: AppState): Promise<void> {
            let guidsToDisplay: DeckItem[] = this.currentDeckGuids;
            if (!Array.isArray(guidsToDisplay)) {
                guidsToDisplay = [];
            }

            console.log(`[loadAndDisplayDeck] Processing ${guidsToDisplay.length} GUIDs for display`);
            console.log(`[loadAndDisplayDeck] feedItems contains ${Object.keys(this.feedItems).length} items`);

            const items: MappedFeedItem[] = [];
            const readSet = new Set(this.read.map(h => h.guid));
            const starredSet = new Set(this.starred.map(s => s.guid));
            const seenGuidsForDeck = new Set<string>();

            let foundCount = 0;
            let missingCount = 0;

            for (const deckItem of guidsToDisplay) { // Changed guid to deckItem for clarity
                const guid = deckItem.guid;
                if (typeof guid !== 'string' || !guid) continue;
                
                const item = this.feedItems[guid];
                if (item && item.guid && !seenGuidsForDeck.has(item.guid)) {
                    const mappedItem = mapRawItem(item, formatDate);
                    if (mappedItem) { // Ensure mappedItem is not null
                        mappedItem.isRead = readSet.has(mappedItem.guid);
                        mappedItem.isStarred = starredSet.has(mappedItem.guid);
                        items.push(mappedItem);
                        seenGuidsForDeck.add(mappedItem.guid);
                        foundCount++;
                    }
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
        loadFeedItemsFromDB: async function(this: AppState): Promise<void> {
            if (!this.db) {
                this.entries = [];
                this.feedItems = {};
                return;
            }
            const rawItemsFromDb = await getAllFeedItems();
            this.feedItems = {};
            const uniqueEntries: any[] = [];
            const seenGuids = new Set<string>();

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
        get filteredEntries(): MappedFeedItem[] {
            if (!Array.isArray(this.deck)) this.deck = [];
            const currentHash = `${this.entries.length}-${this.filterMode}-${this.read.length}-${this.starred.length}-${this.imagesEnabled}-${this.currentDeckGuids.length}-${this.deck.length}-${this.keywordBlacklistInput}`;
            if (this.entries.length > 0 && currentHash === this._lastFilterHash && this._cachedFilteredEntries !== null) {
                return this._cachedFilteredEntries;
            }

            let filtered: MappedFeedItem[] = [];
            const readMap = new Map(this.read.map(h => [h.guid, h.readAt]));
            const starredMap = new Map(this.starred.map(s => [s.guid, s.starredAt]));

            switch (this.filterMode) {
                case "unread":
                    filtered = this.deck.filter(item => !readMap.has(item.guid));
                    break;
                case "all":
                    filtered = this.entries;
                    break;
                case "read":
                    filtered = this.entries.filter(e => readMap.has(e.guid))
                        .sort((a, b) => (new Date(readMap.get(b.guid) || 0).getTime()) - (new Date(readMap.get(a.guid) || 0).getTime()));
                    break;
                case "starred":
                    filtered = this.entries.filter(e => starredMap.has(e.guid))
                        .sort((a, b) => (new Date(starredMap.get(b.guid) || 0).getTime()) - (new Date(starredMap.get(a.guid) || 0).getTime()));
                    break;
            }

            filtered = filtered.map(e => ({
                ...e,
                isRead: readMap.has(e.guid),
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
        isStarred: function(this: AppState, guid: string): boolean {
            return this.starred.some(e => e.guid === guid);
        },        isRead: function(this: AppState, guid: string): boolean {
            return this.read.some(e => e.guid === guid);
        },        toggleStar: async function(this: AppState, guid: string): Promise<void> {
            const isCurrentlyStarred = this.isStarred(guid);
            await toggleItemStateAndSync(this, guid, 'starred');
            
            // Directly update the item's starred status in the current deck and entries
            this.deck = this.deck.map(item =>
                item.guid === guid ? { ...item, isStarred: !isCurrentlyStarred } : item
            );
            this.entries = this.entries.map(item =>
                item.guid === guid ? { ...item, isStarred: !isCurrentlyStarred } : item
            );
            
            this.updateCounts();
            this.updateSyncStatusMessage();
        },        toggleRead: async function(this: AppState, guid: string): Promise<void> {
            const isCurrentlyRead = this.isRead(guid);
            await toggleItemStateAndSync(this, guid, 'read');
            
            // Directly update the item's read status in the current deck and entries
            this.deck = this.deck.map(item =>
                item.guid === guid ? { ...item, isRead: !isCurrentlyRead } : item
            );
            this.entries = this.entries.map(item =>
                item.guid === guid ? { ...item, isRead: !isCurrentlyRead } : item
            );

            if (this.filterMode === 'unread' && !isCurrentlyRead) {
                // If it was unread and now read, remove it from the deck in unread mode
                this.deck = this.deck.filter(item => item.guid !== guid);
            }
            
            this.updateCounts();
            await this._reconcileAndRefreshUI(); // Reconcile to handle potential item removals/animations
            this.updateSyncStatusMessage();
        },        processShuffle: async function(this: AppState): Promise<void> {
            await processShuffle(this);
            this.updateCounts();
        },        saveRssFeeds: async function(this: AppState): Promise<void> {
            // Parse the multi-line string into an array of strings, one URL per line
            const rssFeedsArray = this.rssFeedsInput.split(/\r?\n/).map(url => url.trim()).filter(Boolean);
            await saveSimpleState('rssFeeds', rssFeedsArray); // Send the array to the backend
            createStatusBarMessage(this, 'RSS Feeds saved!');
            this.loading = true;
            this.progressMessage = 'Saving feeds and performing full sync...';
            await performFullSync(this);
            await this.loadFeedItemsFromDB();
            await manageDailyDeck(
                Array.from(this.entries), this.read, this.starred, this.shuffledOutGuids,
                this.shuffleCount, this.filterMode, this.lastShuffleResetDate
            );
            this.progressMessage = '';
            this.loading = false;
        },        saveKeywordBlacklist: async function(this: AppState): Promise<void> {
            const keywordsArray = this.keywordBlacklistInput.split(/\r?\n/).map(kw => kw.trim()).filter(Boolean);
            await saveSimpleState('keywordBlacklist', keywordsArray);
            createStatusBarMessage(this, 'Keyword Blacklist saved!');
            this.updateCounts();
        },        updateCounts: async function(this: AppState): Promise<void> {
            updateCounts(this);
        },        scrollToTop: function(this: AppState): void {
            scrollToTop();
        },
        // --- New Function: Reset Application Data ---
        resetApplicationData: async function(this: AppState): Promise<void> {
            console.log('resetApplicationData called.');
            const isConfirmed = confirm('Are you sure you want to reset the application? This will clear all local data, cache, and unregister the service worker.');
            console.log('User confirmed reset:', isConfirmed);
            if (!isConfirmed) {
                console.log('Reset cancelled by user.');
                return;
            }

            this.loading = true;
            this.progressMessage = 'Resetting application data...';

            try {
                // 0. Close the current database connection
                console.log('Closing database connection...');
                await closeDb();

                // 1. Unregister Service Workers
                console.log('Unregistering service workers...');
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (const registration of registrations) {
                        await registration.unregister();
                        console.log('Service Worker unregistered:', registration.scope);
                    }
                }
                console.log('Service workers unregistered.');

                // 2. Clear IndexedDB databases
                console.log('Clearing IndexedDB databases...');
                const dbName = 'not-the-news-db';
                
                console.log(`Attempting to delete database: ${dbName}`);
                await new Promise<void>((resolve) => { // No reject, always resolve to continue
                    const req = indexedDB.deleteDatabase(dbName);
                    req.onsuccess = () => {
                        console.log(`IndexedDB database '${dbName}' deleted successfully.`);
                        resolve();
                    };
                    req.onerror = (event: Event) => {
                        console.error(`Error deleting IndexedDB database '${dbName}':`, (event.target as IDBRequest).error);
                        resolve(); // Continue to next even on error
                    };
                    req.onblocked = () => {
                        console.warn(`Deletion of database '${dbName}' is blocked.`);
                        resolve(); // Continue anyway
                    };
                });
                console.log('IndexedDB clearing finished.');

                // 3. Clear localStorage
                console.log('Clearing localStorage...');
                localStorage.clear();
                console.log('localStorage cleared.');

                // 4. Call backend to reset server-side data
                console.log('DEBUG: About to make fetch call to /api/admin/reset-app');
                const response = await fetch('/api/admin/reset-app', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include' // Important for sending cookies
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Failed to reset backend data.');
                }
                console.log('Backend application data reset successfully.');
                createStatusBarMessage(this, 'Application reset complete! Reloading...');
                window.location.reload(); // Reload immediately after backend confirms

            } catch (error: any) {
                console.error("Error during application reset:", error);
                this.errorMessage = `Failed to reset application: ${error.message}`;
                createStatusBarMessage(this, `Failed to reset application: ${error.message}`);
                this.loading = false;
            }
        },
        backupConfig: async function(this: AppState): Promise<void> {
            console.log('backupConfig called.');
            try {
                this.progressMessage = 'Fetching configuration for backup...';
                console.log('Fetching config for backup from:', '/api/admin/config-backup');
                const response = await fetch('/api/admin/config-backup', {
                    method: 'GET',
                    credentials: 'include'
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Failed to fetch config for backup.');
                }

                const configData = await response.json();
                const blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `not-the-news-config-backup-${new Date().toISOString().replace(/:/g, '-').split('.')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                createStatusBarMessage(this, 'Configuration backed up successfully!');
            } catch (error: any) {
                console.error("Error during config backup:", error);
                createStatusBarMessage(this, `Failed to backup configuration: ${error.message}`);
            } finally {
                this.progressMessage = '';
            }
        },
        restoreConfig: async function(this: AppState, event: Event): Promise<void> {
            if (!confirm('Are you sure you want to restore configuration? This will overwrite your current settings and reload the application.')) {
                return;
            }

            const file = (event.target as HTMLInputElement).files?.[0]; // Cast to HTMLInputElement
            if (!file) {
                createStatusBarMessage(this, 'No file selected for restoration.');
                return;
            }

            this.loading = true;
            this.progressMessage = 'Restoring configuration...';

            try {
                const fileContent: string = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target?.result as string); // Cast to string
                    reader.onerror = (e) => reject(e);
                    reader.readAsText(file);
                });

                const configToRestore = JSON.parse(fileContent);

                const response = await fetch('/api/admin/config-restore', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(configToRestore),
                    credentials: 'include'
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Failed to restore backend data.');
                }
                console.log('Backend configuration restored successfully.');
                createStatusBarMessage(this, 'Configuration restored successfully! Reloading...');

                // Reload the page to apply new settings and re-initialize
                setTimeout(() => {
                    window.location.reload();
                }, 1000);

            } catch (error: any) {
                console.error("Error during config restoration:", error);
                createStatusBarMessage(this, `Failed to restore configuration: ${error.message}`);
                this.loading = false;
            } finally {
                // Clear the file input value so the same file can be selected again
                (event.target as HTMLInputElement).value = ''; // Cast to HTMLInputElement
            }
        },
        // --- Private Helper Methods ---
        _loadInitialState: async function(this: AppState): Promise<void> {
            try {
                const [syncEnabled, imagesEnabled, urlsNewTab, filterModeResult, themeState] = await Promise.all([
                    loadSimpleState('syncEnabled'),
                    loadSimpleState('imagesEnabled'),
                    loadSimpleState('openUrlsInNewTabEnabled'),
                    loadFilterMode(), // loadFilterMode directly returns string, not object with value
                    loadSimpleState('theme')
                ]);

                this.syncEnabled = syncEnabled.value ?? true;
                this.imagesEnabled = imagesEnabled.value ?? true;
                this.openUrlsInNewTabEnabled = urlsNewTab.value ?? true;
                this.filterMode = filterModeResult; // filterModeResult is already the string
                this.theme = themeState.value ?? 'dark';
                this.isOnline = isOnline();
                
                const [rssFeeds, keywordBlacklist] = await Promise.all([
                    loadSimpleState('rssFeeds'),
                    loadSimpleState('keywordBlacklist')
                ]);

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
                // Set default values in case of error
                this.syncEnabled = true;
                this.imagesEnabled = true;
                this.openUrlsInNewTabEnabled = true;
                this.filterMode = 'unread';
                this.theme = 'dark';
                this.rssFeedsInput = '';
                this.keywordBlacklistInput = '';
            }
        },
        
                _loadAndManageAllData: async function(this: AppState): Promise<void> {
            console.log('_loadAndManageAllData: START');
            await this.loadFeedItemsFromDB();
            console.log(`_loadAndManageAllData: After loadFeedItemsFromDB. Entries: ${this.entries.length}`);

            this.progressMessage = 'Loading user state from storage...';
            const [starredState, shuffledOutState, currentDeckState, shuffleState] = await Promise.all([
                loadArrayState('starred'),
                loadArrayState('shuffledOutGuids'),
                loadCurrentDeck(),
                loadShuffleState()
            ]);
            console.log("_loadAndManageAllData: Loaded starred state:", starredState.value); //debug

            this.starred = Array.isArray(starredState.value) ? starredState.value : [];
            this.shuffledOutGuids = Array.isArray(shuffledOutState.value) ? shuffledOutState.value : [];
    
            this.currentDeckGuids = Array.isArray(currentDeckState) ? currentDeckState : [];
            console.log(`_loadAndManageAllData: Loaded currentDeckGuids:`, this.currentDeckGuids.slice(0, 3), typeof this.currentDeckGuids[0]);
    
            this.shuffleCount = shuffleState.shuffleCount;
            this.lastShuffleResetDate = shuffleState.lastShuffleResetDate;

            this.progressMessage = 'Pruning read items...';
            this.read = await loadAndPruneReadItems(Object.values(this.feedItems));
            console.log(`_loadAndManageAllData: After loadAndPruneReadItems. Read count: ${this.read.length}`);
            console.log("[deckManager] Starting deck management with all data loaded.");

            this.progressMessage = 'Managing today\'s deck...';
            console.log('_loadAndManageAllData: Before manageDailyDeck', { readCount: this.read.length, currentDeckGuidsCount: this.currentDeckGuids.length });
            const deckResult = await manageDailyDeck(
                Array.from(this.entries), this.read, this.starred, this.shuffledOutGuids, // Use shuffledOutGuids
                this.shuffleCount, this.filterMode, this.lastShuffleResetDate
            );

            this.deck = deckResult.deck;
            this.currentDeckGuids = deckResult.currentDeckGuids;
            this.shuffledOutGuids = deckResult.shuffledOutGuids;
            this.shuffleCount = deckResult.shuffleCount;
            this.lastShuffleResetDate = deckResult.lastShuffleResetDate;

            console.log('_loadAndManageAllData: After manageDailyDeck. Deck size:', this.deck.length);
            await this.loadAndDisplayDeck();
            console.log('_loadAndManageAllData: After loadAndDisplayDeck. Deck size:', this.deck.length);

            this.updateAllUI();
            console.log('_loadAndManageAllData: END');
        },
        updateAllUI: async function(this: AppState): Promise<void> {
            await this.updateCounts();
        },
        _reconcileAndRefreshUI: async function(this: AppState): Promise<void> {
            console.log('[UI] _reconcileAndRefreshUI: Initiating UI reconciliation and refresh.');
            // This function is intended to be called when the underlying data (read, starred, etc.) changes
            // and the UI needs to be updated to reflect those changes without a full deck reload.
            // For now, we'll re-run loadAndDisplayDeck and updateAllUI, but this could be optimized
            // in the future to only update changed items.
            await this.loadAndDisplayDeck();
            this.updateAllUI();
            console.log('[UI] _reconcileAndRefreshUI: Completed UI reconciliation and refresh.');
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
        _setupWatchers: function(this: AppState): void {
            this.$watch("openSettings", async (isOpen: boolean) => {
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
                document.querySelectorAll('.itemdescription').forEach((el: Element) => this.handleEntryLinks(el));
            });
            this.$watch("modalView", async () => manageSettingsPanelVisibility(this));
            this.$watch('filterMode', async (newMode: string) => {
                await setFilterMode(this, newMode);
                if (newMode === 'unread') {
                    await manageDailyDeck(
                        Array.from(this.entries), this.read, this.starred, this.shuffledOutGuids,
                        this.shuffleCount, this.filterMode, this.lastShuffleResetDate
                    );
                }
                this.scrollToTop();
            });
            
            this.$watch('entries', () => this.updateCounts());
            this.$watch('read', () => this.updateCounts());
            this.$watch('starred', () => this.updateCounts());
            this.$watch('currentDeckGuids', () => this.updateCounts());
        },
        _setupEventListeners: function(this: AppState): void {
            const backgroundSync = async (): Promise<void> => {
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
                await this.updateSyncStatusMessage(); // <-- FIX: Update status on online event
                if (this.syncEnabled) {
                    try {
                        await processPendingOperations();
                        await backgroundSync();
                    } catch (error: any) {
                        console.error('Error handling online event:', error);
                    }
                }
            });
            window.addEventListener('offline', async () => {
                this.isOnline = false;
                await this.updateSyncStatusMessage(); // <-- FIX: Update status on offline event
            });
            setTimeout(backgroundSync, 0);
        },
        _startPeriodicSync: function(this: AppState): void {
            let lastActivityTimestamp = Date.now();
            const recordActivity = () => lastActivityTimestamp = Date.now();
            ["mousemove", "mousedown", "keydown", "scroll", "click", "visibilitychange", "focus"].forEach((event: string) => {
                document.addEventListener(event, recordActivity, true);
                if (event === 'focus') window.addEventListener(event, recordActivity, true);
                if (event === 'visibilitychange') document.addEventListener(event, recordActivity, true);
            });

            const SYNC_INTERVAL_MS = 5 * 60 * 1000;
            const INACTIVITY_TIMEOUT_MS = 60 * 1000;

            setInterval(async () => {
                const now = Date.now();
                if (!this.isOnline || this.openSettings || !this.syncEnabled || (now - lastActivityTimestamp) > INACTIVITY_TIMEOUT_MS) {
                    return;
                }
                console.log('Starting scheduled background sync...');
                try { // Added try-catch for error handling
                    await performFeedSync(this);
                    await pullUserState();
                    await this._loadAndManageAllData();
                    this.deckManaged = true;
                    console.log('Scheduled sync complete.');
                } catch (error: any) {
                    console.error('Periodic sync failed:', error);
                }
            }, SYNC_INTERVAL_MS);
        },
        _initScrollObserver: function(this: AppState): void {
            const observer = new IntersectionObserver(async () => {
                // ... logic to observe item visibility
            }, {
                root: document.querySelector('#feed-container'),
                rootMargin: '0px',
                threshold: 0.1
            });
            const feedContainer = document.querySelector('#feed-container');
            if (!feedContainer) return;
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
        },
        handleEntryLinks: function(this: AppState, element: Element): void {
            if (!element) return;
            const links = element.querySelectorAll('a');
            links.forEach((link: HTMLAnchorElement) => {
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
        $nextTick: function(this: AppState, callback: (this: AppState) => void) {
            return Alpine.nextTick(callback);
        },
        $watch: function(this: AppState, property: string, callback: (newValue: any, oldValue: any) => void) {
            return Alpine.watch(this, property, callback);
        },
    };
}
// Register the rssApp component with Alpine.
Alpine.data('rssApp', rssApp);

// Start Alpine to initialize the application.
Alpine.start();