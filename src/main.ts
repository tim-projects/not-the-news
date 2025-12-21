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
import { formatDate, mapRawItem, mapRawItems, parseRssFeedsConfig } from './js/helpers/dataUtils.ts';
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
    initScrollPosition
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
        imageObserver: null,
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
                
                this._initImageObserver();

                if (this.isOnline) {
                    this.progressMessage = 'Syncing latest content...'; // Set specific sync message
                    // Pull user state first, as feed items depend on it.
                    await pullUserState(); // This fetches user preferences like rssFeeds from backend
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
                attachScrollToTopHandler();
                await initScrollPosition(this);
                
                this.progressMessage = 'Setting up app watchers...';
                this._setupWatchers();
                this._setupEventListeners();
                this._startPeriodicSync();
                this._initScrollObserver();
                this._initObservers();

                // Ensure initial sync messages are shown and loading screen is managed
                if (this.deck.length === 0) {
                    // If deck is still empty after sync/load, keep loading screen up with a message
                    if (this.entries.length > 0) {
                        this.progressMessage = 'Fetching and building your feed...';
                    } else {
                        this.progressMessage = 'No feed items found. Please configure your RSS feeds.';
                    }
                    // Keep loading screen visible for a moment longer if deck is empty
                    // This prevents a flash of blank screen before the message appears (if any)
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Show message for 1 second
                }
                
                this.loading = false; // Hide main loading screen after all processing and messages are set

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
                // Also remove it from currentDeckGuids so it's not re-added on refresh
                this.currentDeckGuids = this.currentDeckGuids.filter(deckItem => deckItem.guid !== guid);
                // Save the updated deck guids to the database
                const { saveCurrentDeck } = await import('./js/helpers/userStateUtils.ts');
                await saveCurrentDeck(this.currentDeckGuids);
            }
            
            this.updateCounts();
            await this._reconcileAndRefreshUI(); // Reconcile to handle potential item removals/animations
            this.updateSyncStatusMessage();

            // If the deck is now empty, trigger a deck refresh
            if (this.deck.length === 0) {
                console.log('[toggleRead] Deck is empty, initiating refresh process.');
                this.progressMessage = 'Generating new deck...';
                this.loading = true; // Show loading screen while new deck is generated
                try {
                    await this._loadAndManageAllData();
                } catch (error) {
                    console.error('[toggleRead] Error during deck refresh:', error);
                }
                console.log('[toggleRead] _loadAndManageAllData completed after deck empty.');
                this.loading = false;
                this.progressMessage = '';
                console.log('[toggleRead] Deck refresh process completed. Deck size:', this.deck.length);
            }
        },        processShuffle: async function(this: AppState): Promise<void> {
            await processShuffle(this);
            this.updateCounts();
        },        loadRssFeeds: async function(this: AppState): Promise<void> {
            try {
                const result = await loadSimpleState('rssFeeds');
                this.rssFeedsInput = parseRssFeedsConfig(result.value).join('\n');
            } catch (error) {
                console.error('Error loading RSS feeds:', error);
            }
        },        loadKeywordBlacklist: async function(this: AppState): Promise<void> {
            try {
                const result = await loadSimpleState('keywordBlacklist');
                const value = result.value;
                this.keywordBlacklistInput = Array.isArray(value) ? value.filter(Boolean).sort().join("\n") : (value || "");
            } catch (error) {
                console.error('Error loading keyword blacklist:', error);
            }
        },        saveRssFeeds: async function(this: AppState): Promise<void> {
            const rssFeedsArray = this.rssFeedsInput.split(/\r?\n/).map(url => url.trim()).filter(Boolean).sort();
            try {
                await saveSimpleState('rssFeeds', rssFeedsArray);
                this.rssFeedsInput = rssFeedsArray.join('\n');
                createStatusBarMessage(this, 'RSS Feeds saved!');
                this.loading = true;
                this.progressMessage = 'Saving feeds and performing full sync...';
                await performFullSync(this);
                await this.loadFeedItemsFromDB();
                
                const deckResult = await manageDailyDeck(
                    Array.from(this.entries), this.read, this.starred, this.shuffledOutGuids,
                    this.shuffleCount, this.filterMode, this.lastShuffleResetDate
                );
                
                // --- FIX: Correctly update the component state with the deck result ---
                this.deck = deckResult.deck;
                this.currentDeckGuids = deckResult.currentDeckGuids;
                this.shuffledOutGuids = deckResult.shuffledOutGuids;
                this.shuffleCount = deckResult.shuffleCount;
                this.lastShuffleResetDate = deckResult.lastShuffleResetDate;

                await this.loadAndDisplayDeck();
                this.progressMessage = '';
                this.loading = false;
            } catch (error: any) {
                console.error('Error saving RSS feeds:', error);
                createStatusBarMessage(this, `Failed to save RSS feeds: ${error.message}`);
                this.loading = false;
            }
        },        saveKeywordBlacklist: async function(this: AppState): Promise<void> {
            const keywordsArray = this.keywordBlacklistInput.split(/\r?\n/).map(kw => kw.trim()).filter(Boolean).sort();
            try {
                await saveSimpleState('keywordBlacklist', keywordsArray);
                this.keywordBlacklistInput = keywordsArray.join('\n');
                createStatusBarMessage(this, 'Keyword Blacklist saved!');
                this.updateCounts();
            } catch (error: any) {
                console.error('Error saving keyword blacklist:', error);
                createStatusBarMessage(this, `Failed to save keyword blacklist: ${error.message}`);
            }
        },        updateCounts: async function(this: AppState): Promise<void> {
            updateCounts(this);
        },        scrollToTop: function(this: AppState): void {
            scrollToTop();
        },
        observeImage: function(this: AppState, el: HTMLImageElement): void {
            if (this.imageObserver) {
                this.imageObserver.observe(el);
            }
        },
        _initImageObserver: function(this: AppState): void {
            this.imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target as HTMLImageElement;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            // Optionally remove the observer after loading
                            this.imageObserver?.unobserve(img);
                        }
                    }
                });
            }, {
                root: null, // use viewport
                rootMargin: '50% 0px', // preload slightly ahead
                threshold: 0.01
            });
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

                // 2. Clear specific IndexedDB object stores (read, starred, feedItems, deck info)
                console.log('Clearing specific IndexedDB object stores...');
                try {
                    const db = await initDb(); // Re-initialize/get DB connection
                    const storesToClear = ['read', 'starred', 'currentDeckGuids', 'shuffledOutGuids', 'feedItems'];
                    const tx = db.transaction(storesToClear, 'readwrite');
                    await Promise.all(storesToClear.map(storeName => {
                        console.log(`Clearing object store: ${storeName}`);
                        return tx.objectStore(storeName).clear();
                    }));
                    await tx.done;
                    console.log('Specific IndexedDB object stores cleared.');
                } catch (e) {
                    console.error('Error clearing specific IndexedDB stores:', e);
                }
                
                // localStorage is no longer cleared, as rssFeeds and keywordBlacklist should persist
                console.log('localStorage (excluding user settings) is implicitly maintained.');

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
                
                // --- FIX: Before reloading, ensure we pull the preserved state from the backend ---
                // Passing 'true' to force a fresh pull of all keys.
                await pullUserState(true);
                
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

                this.rssFeedsInput = parseRssFeedsConfig(rssFeeds.value).join('\n');
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
            this.progressMessage = 'Loading saved feed items...'; // New message
            await this.loadFeedItemsFromDB();
            console.log(`_loadAndManageAllData: After loadFeedItemsFromDB. Entries: ${this.entries.length}`);

            this.progressMessage = 'Loading user state from storage...'; // Existing message
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

            this.progressMessage = 'Pruning read items...'; // Existing message
            this.read = await loadAndPruneReadItems(Object.values(this.feedItems));
            console.log(`_loadAndManageAllData: After loadAndPruneReadItems. Read count: ${this.read.length}`);
            console.log("[deckManager] Starting deck management with all data loaded.");

            this.progressMessage = 'Organizing your deck...'; // New message
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
            this.progressMessage = 'Displaying your feed...'; // New message
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
                    this.rssFeedsInput = parseRssFeedsConfig(rssFeeds.value).join('\n');
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