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
import './css/themes/sepia.css';
import './css/themes/solarized-light.css';
import './css/themes/github-light.css';
import './css/themes/atom-one-light.css';
import './css/themes/gruvbox-light.css';
import './css/themes/catppuccin-latte.css';
import './css/themes/rose-pine-dawn.css';
import './css/themes/paper.css';
import './css/themes/morning.css';

import './css/themes/midnight.css';
import './css/themes/nord.css';
import './css/themes/dracula.css';
import './css/themes/monokai.css';
import './css/themes/gruvbox-dark.css';
import './css/themes/catppuccin-mocha.css';
import './css/themes/tokyo-night.css';
import './css/themes/synthwave.css';
import './css/themes/material-dark.css';

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
    createStatusBarMessage,
    showUndoNotification
} from './js/ui/uiUpdaters.ts';
import {
    initSyncToggle,
    initImagesToggle,
    initItemButtonMode,
    initShadowsToggle,
    initCurvesToggle,
    initUrlsNewTabToggle,
    initScrollPosition,
    initFlickToSelectToggle
} from './js/ui/uiInitializers.ts';
import { manageDailyDeck, processShuffle } from './js/helpers/deckManager.ts';
import { handleKeyboardShortcuts } from './js/helpers/keyboardManager.ts';
import { speakItem, stopSpeech } from './js/helpers/ttsManager.ts';
import { isOnline } from './js/utils/connectivity.ts';
import { MappedFeedItem, DeckItem, AppState, StarredItem, ShuffledOutItem } from './types/app.ts';
import { filterEntriesByQuery, toggleSearch } from './js/helpers/searchManager.ts';
import { discoverFeed } from './js/helpers/discoveryManager.ts';
import { auth } from './js/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';

// Enforce authentication before initializing the app
let authInitialized = false;
let initialAuthChecked = false;

onAuthStateChanged(auth, (user) => {
    const path = window.location.pathname;
    authInitialized = true;
    
    console.log(`[Auth Event] User: ${user?.uid || 'null'}, Path: ${path}, Initialized: ${initialAuthChecked}`);

    if (user) {
        if (path.endsWith('login.html')) {
            console.log(`[Auth Check] Already logged in, redirecting to home`);
            window.location.href = '/';
        }
    } else if (initialAuthChecked) {
        // Only redirect to login if we've already done the initial check 
        // AND the user session actually disappeared (logout)
        if (!path.endsWith('login.html')) {
            console.log(`[Auth Check] User logged out, redirecting to login.html`);
            window.location.href = '/login.html';
        }
    }
});

export function rssApp(): AppState {
    return {
        // --- State Properties ---
        loading: true,
        progressMessage: 'Initializing...',
        deck: [],
        feedItems: {},
        filterMode: 'unread',
        openSettings: false,
        openShortcuts: false,
        modalView: 'main',
        showSearchBar: false,
        searchQuery: '',
        shuffleCount: 0,
        lastShuffleResetDate: null,
        syncEnabled: true,
        imagesEnabled: true,
        itemButtonMode: 'play',
        openUrlsInNewTabEnabled: true,
        rssFeedsInput: '',
        keywordBlacklistInput: '',
        discoveryUrl: '',
        isDiscovering: false,
        discoveryResults: [],
        discoveryError: '',
        shadowsEnabled: true,
        curvesEnabled: true,
        flickToSelectEnabled: true,
        entries: [],
        read: [],
        starred: [],
        currentDeckGuids: [],
        shuffledOutGuids: [],
        pregeneratedOnlineDeck: null,
        pregeneratedOfflineDeck: null,
        errorMessage: '',
        isOnline: isOnline(),
        deckManaged: false,
        syncStatusMessage: '',
        showSyncStatus: false,
        theme: 'dark',
        themeStyle: 'originalDark',
        themeStyleLight: 'originalLight',
        themeStyleDark: 'originalDark',
        customCss: '',
        fontSize: 100,
        feedWidth: 50,
        showUndo: false,
        undoTimerActive: false,
        undoItemGuid: null,
        undoItemIndex: null,
        undoStack: [],
        undoBtnRadius: 20,
        selectedGuid: null,
        selectedSubElement: 'item',
        selectedTimestamp: null,
        lastSelectedGuid: null,
        starredGuid: null,
        readingGuid: null,
        speakingGuid: null,
        closingGuid: null,
        db: null,
        _lastFilterHash: '',
        _cachedFilteredEntries: null,
        scrollObserver: null,
        imageObserver: null,
        staleItemObserver: null,
        _initComplete: false,
        _isSyncing: false,
        _isPregenerating: false,
        
        // --- Core Methods ---
        initApp: async function(this: AppState): Promise<void> {
            try {
                // Wait for Firebase Auth to initialize before proceeding
                this.progressMessage = 'Verifying authentication...';
                let waitCount = 0;
                while (!authInitialized && waitCount < 50) { 
                    await new Promise(resolve => setTimeout(resolve, 100));
                    waitCount++;
                }

                if (!auth.currentUser) {
                    if (!window.location.pathname.endsWith('login.html')) {
                        console.log("[Auth] Not logged in after wait, redirecting...");
                        window.location.href = '/login.html';
                        return;
                    }
                } else {
                    initialAuthChecked = true; // Mark that we found a user during init
                    console.log("[Auth] User verified, proceeding with data initialization.");
                }

                this.progressMessage = 'Connecting to database...';
                this.db = await initDb();
                
                this.progressMessage = 'Loading settings...';
                await this._loadInitialState();
                
                this._initImageObserver();

                // Warm up TTS voices
                if ('speechSynthesis' in window) {
                    window.speechSynthesis.getVoices();
                    window.speechSynthesis.onvoiceschanged = () => {
                        const voices = window.speechSynthesis.getVoices();
                        console.log(`[TTS] Voices loaded: ${voices.length} available.`);
                    };
                }

                // Refresh online status immediately before potentially starting sync
                this.isOnline = isOnline();

                if (this.isOnline && initialAuthChecked) {
                    this.progressMessage = 'Syncing latest content...'; // Set specific sync message
                    
                    // STABILITY: Double-check connectivity before each network call
                    if (isOnline()) await processPendingOperations();
                    if (isOnline()) await pullUserState(); // This fetches user preferences like rssFeeds from backend
                    
                    let syncSuccess = true;
                    try {
                        if (isOnline()) {
                            syncSuccess = await performFeedSync(this);
                        }
                    } catch (syncError) {
                        console.error("Priority sync failed:", syncError);
                        syncSuccess = false;
                    }
                    
                    // Now that syncs are attempted (or skipped if offline), load data.
                    await this._loadAndManageAllData();
                    
                    if (syncSuccess && this.isOnline) {
                        createStatusBarMessage(this, "Initial sync complete!");
                    } else if (!this.isOnline) {
                        createStatusBarMessage(this, "Sync skipped (Offline).");
                    } else {
                        createStatusBarMessage(this, "Sync finished with some issues. Check console for details.");
                    }
                } else {
                    this.progressMessage = 'Offline mode. Loading local data...';
                    await this._loadAndManageAllData();
                }

                this.progressMessage = 'Applying user preferences...';
                // initTheme is no longer needed as we handle it via _loadInitialState and toggleTheme
                initSyncToggle(this);
                initImagesToggle(this);
                initItemButtonMode(this);
                initShadowsToggle(this);
                initCurvesToggle(this);
                initFlickToSelectToggle(this);
                initUrlsNewTabToggle(this);
                attachScrollToTopHandler();
                this.$nextTick(() => {
                    initScrollPosition(this);
                });
                
                this.progressMessage = 'Setting up app watchers...';
                this._setupWatchers();
                this._setupEventListeners();
                this._setupFlickToSelectListeners();
                this._startPeriodicSync();
                this._startWorkerFeedSync();
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
                } else {
                    // Stabilization delay to ensure data is propagated to Alpine components
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    if (!this.selectedGuid) {
                        const { value: lastId } = await loadSimpleState('lastViewedItemId');
                        const isRestoring = lastId && this.deck.some(item => item.guid === lastId);
                        
                        if (!isRestoring && this.deck.length > 0) {
                            // Auto-select first item only if we aren't restoring a previous position
                            this.selectItem(this.deck[0].guid);
                        }
                    }
                }
                
                // Kick off first background pre-generation
                this.pregenerateDecks();

                this.loading = false; // Hide main loading screen after all processing and messages are set
                this._initComplete = true;

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
                await processPendingOperations();
                const syncSuccess = await performFeedSync(this);
                await pullUserState();
                await this._loadAndManageAllData();
                this.deckManaged = true;
                this.progressMessage = '';
                this.loading = false;
                console.log('Immediate background sync complete.');
                if (syncSuccess) {
                    createStatusBarMessage(this, 'Sync complete!');
                } else {
                    createStatusBarMessage(this, 'Sync finished with errors.');
                }
            } catch (error: any) {
                console.error('Immediate background sync failed:', error);
                this.progressMessage = 'Sync Failed!';
                this.loading = false;
                createStatusBarMessage(this, `Sync failed: ${error.message}`);
            }
        },

        updateSyncStatusMessage: async function(this: AppState): Promise<void> {
            const online = isOnline();

            if (!online) {
                this.syncStatusMessage = 'Offline.';
                this.showSyncStatus = true;
            } else if (!this.syncEnabled) {
                this.syncStatusMessage = 'Sync is disabled.';
                this.showSyncStatus = true;
            } else {
                this.showSyncStatus = false;
                this.syncStatusMessage = '';
            }
        },
        
        logout: async function(this: AppState): Promise<void> {
            try {
                await signOut(auth);
                // Redirect will be handled by onAuthStateChanged in main.ts
            } catch (error: any) {
                console.error("Logout error:", error);
                createStatusBarMessage(this, `Logout failed: ${error.message}`);
            }
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

            this.deck = Array.isArray(items) ? items : [];
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
            
            // --- FIX: Include deck content and search query in hash to invalidate cache ---
            const deckContentHash = this.deck.length > 0 ? this.deck[0].guid.substring(0, 8) : 'empty';
            const currentHash = `${this.entries.length}-${this.filterMode}-${this.read.length}-${this.starred.length}-${this.imagesEnabled}-${this.currentDeckGuids.length}-${this.deck.length}-${this.keywordBlacklistInput}-${this.searchQuery}-${deckContentHash}`;
            
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

            // Apply Keyword Blacklist
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

            // Apply Search Query
            filtered = filterEntriesByQuery(filtered, this.searchQuery);
            
            this._cachedFilteredEntries = filtered;
            this._lastFilterHash = currentHash;
            return filtered;
        },
        get allCount(): number {
            return this.entries.length;
        },
        get starredCount(): number {
            if (!this.entries.length) return 0;
            const starredSet = new Set(this.starred.map(s => s.guid));
            return this.entries.filter(e => starredSet.has(e.guid)).length;
        },
        get readCount(): number {
            if (!this.entries.length) return 0;
            const readSet = new Set(this.read.map(r => r.guid));
            return this.entries.filter(e => readSet.has(e.guid)).length;
        },
        get unreadCount(): number {
            if (!this.entries.length || !this.currentDeckGuids.length) return 0;
            const readSet = new Set(this.read.map(r => r.guid));
            const deckGuidsSet = new Set(this.currentDeckGuids.map(item => item.guid));
            return this.entries.filter(e => deckGuidsSet.has(e.guid) && !readSet.has(e.guid)).length;
        },
        // --- Action Methods ---
        isStarred: function(this: AppState, guid: string): boolean {
            return this.starred.some(e => e.guid === guid);
        },        isRead: function(this: AppState, guid: string): boolean {
            return this.read.some(e => e.guid === guid);
        },
        toggleStar: async function(this: AppState, guid: string): Promise<void> {
            const isStarring = !this.starred.some(item => item.guid === guid);
            if (isStarring) {
                this.starredGuid = guid;
                setTimeout(() => {
                    if (this.starredGuid === guid) this.starredGuid = null;
                }, 1000); // 0.5s for title + 0.5s for button
            }

            // --- IMMEDIATE STATE UPDATE ---
            this.deck = this.deck.map(item =>
                item.guid === guid ? { ...item, isStarred: isStarring } : item
            );
            this.entries = this.entries.map(item =>
                item.guid === guid ? { ...item, isStarred: isStarring } : item
            );

            await toggleItemStateAndSync(this, guid, 'starred');
        },

        speakItem: function(this: AppState, guid: string): void {
            speakItem(this, guid);
        },

        toggleRead: async function(this: AppState, guid: string): Promise<void> {
            // Stop TTS if it's playing for the item being marked read (UX improvement)
            if (this.speakingGuid === guid) {
                stopSpeech(this);
            }

            const isCurrentlyRead = this.isRead(guid);
            const wasSelected = this.selectedGuid === guid;
            let nextGuidToSelect: string | null = null;

            // Identify next item BEFORE we change the read status, if it's currently selected in unread mode
            if (!isCurrentlyRead && wasSelected && this.filterMode === 'unread') {
                const entries = this.filteredEntries;
                const currentIndex = entries.findIndex(e => e.guid === guid);
                if (currentIndex !== -1) {
                    if (currentIndex < entries.length - 1) {
                        nextGuidToSelect = entries[currentIndex + 1].guid;
                    } else if (currentIndex > 0) {
                        nextGuidToSelect = entries[currentIndex - 1].guid;
                    }
                }
            }
            
            if (!isCurrentlyRead) {
                this.readingGuid = guid;
                // Phase 1: Fold animation (500ms)
                if (this.filterMode === 'unread') {
                    this.closingGuid = guid;
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Select next item AFTER fold but DURING swipe for smoother feel
                    if (nextGuidToSelect) {
                        this.selectItem(nextGuidToSelect);
                    }

                    // Phase 2: Swipe animation (450ms)
                    await new Promise(resolve => setTimeout(resolve, 450));
                } else {
                    // Just the short delay for the button animation if not removing
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                this.readingGuid = null;
                this.closingGuid = null;
            }

            let removedIndex: number | null = null;
            
            // --- IMMEDIATE STATE UPDATE ---
            // Directly update the item's read status in the current deck and entries
            this.deck = this.deck.map(item =>
                item.guid === guid ? { ...item, isRead: !isCurrentlyRead } : item
            );
            this.entries = this.entries.map(item =>
                item.guid === guid ? { ...item, isRead: !isCurrentlyRead } : item
            );

            // Trigger the sync and array updates (now backgrounded in the helper)
            await toggleItemStateAndSync(this, guid, 'read');

            if (this.filterMode === 'unread' && !isCurrentlyRead) {
                // If it was unread and now read, remove it from the deck in unread mode
                removedIndex = this.currentDeckGuids.findIndex(item => item.guid === guid);
                if (removedIndex === -1) removedIndex = null;

                this.deck = this.deck.filter(item => item.guid !== guid);
                // Also remove it from currentDeckGuids so it's not re-added on refresh
                this.currentDeckGuids = this.currentDeckGuids.filter(deckItem => deckItem.guid !== guid);
                // Save the updated deck guids to the database
                const { saveCurrentDeck } = await import('./js/helpers/userStateUtils.ts');
                await saveCurrentDeck(this.currentDeckGuids);
                
                // If we didn't select nextGuidToSelect during the animation, clear selection
                if (!nextGuidToSelect && wasSelected) {
                    this.selectedGuid = null;
                }
            } else if (this.filterMode === 'unread' && isCurrentlyRead) {
                // If it was read and now unread (Undo), add it back to the deck if missing
                if (!this.currentDeckGuids.some(deckItem => deckItem.guid === guid)) {
                    const deckItem = { guid, addedAt: new Date().toISOString() };
                    if (this.undoItemIndex !== null && this.undoItemIndex >= 0) {
                        this.currentDeckGuids.splice(this.undoItemIndex, 0, deckItem);
                    } else {
                        this.currentDeckGuids.push(deckItem);
                    }
                    // Save the updated deck guids to the database
                    const { saveCurrentDeck } = await import('./js/helpers/userStateUtils.ts');
                    await saveCurrentDeck(this.currentDeckGuids);
                }
            }
            
            this.updateCounts();
            await this._reconcileAndRefreshUI(); // Reconcile to handle potential item removals/animations
            this.updateSyncStatusMessage();

            if (!isCurrentlyRead && this.filterMode !== 'all') {
                showUndoNotification(this, guid, removedIndex);
            }

            // Check if we need to refresh the deck (if unread items in current deck are low)
            let remainingUnreadInDeck = this.deck.filter(item => !this.isRead(item.guid)).length;
            
            if (this.filterMode === 'unread' && remainingUnreadInDeck === 0) {
                console.log("[toggleRead] Last item read. Preloading next deck during undo period...");
                
                // Kick off background work while the user has a chance to undo
                this.pregenerateDecks();
                this.loadFeedItemsFromDB();

                // Wait while undo is visible (max 5.5s)
                while (this.showUndo) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                
                // If the user didn't undo, we clear the stack permanently before refresh
                this.undoStack = [];
                
                // Re-calculate after potential undo
                remainingUnreadInDeck = this.deck.filter(item => !this.isRead(item.guid)).length;
                if (remainingUnreadInDeck > 0) {
                    console.log("[toggleRead] Undo detected, skipping refresh.");
                    return;
                }
            }

            if (this.filterMode === 'unread' && remainingUnreadInDeck < 3) {
                console.log(`[toggleRead] Deck running low (${remainingUnreadInDeck} unread), initiating refresh.`);
                
                // OPTIMIZATION: Check if we have a pre-generated deck ready to skip loading screen
                const pregenKey = this.isOnline ? 'pregeneratedOnlineDeck' : 'pregeneratedOfflineDeck';
                const hasPregen = !!this[pregenKey as keyof AppState];

                // Show loading only if deck is totally empty AND we don't have a pre-generated backup
                if (remainingUnreadInDeck === 0 && !hasPregen) {
                    this.progressMessage = 'Generating new deck...';
                    this.loading = true;
                }
                try {
                    await this._loadAndManageAllData();
                    if (remainingUnreadInDeck === 0 && this.deck.length > 0) {
                        this.selectItem(this.deck[0].guid);
                    }
                } catch (error) {
                    console.error('[toggleRead] Error during deck refresh:', error);
                } finally {
                    this.loading = false;
                    this.progressMessage = '';
                }
            }
        },        undoMarkRead: async function(this: AppState): Promise<void> {
            if (this.undoStack.length === 0) {
                this.showUndo = false;
                return;
            }
            
            const lastAction = this.undoStack.pop();
            if (!lastAction) return;

            const guid = lastAction.guid;
            // Temporarily set these for any logic that depends on single-item undo state
            this.undoItemGuid = guid;
            this.undoItemIndex = lastAction.index;

            // If we've popped the last item, hide the notification
            if (this.undoStack.length === 0) {
                this.showUndo = false;
            }

            await this.toggleRead(guid);
            
            // Clear temp state
            this.undoItemGuid = null;
            this.undoItemIndex = null;
        },        selectItem: function(this: AppState, guid: string): void {
            if (this.selectedGuid === guid) {
                // Even if already selected, clicking should close shortcuts if they are open
                if (this.openShortcuts) this.openShortcuts = false;
                return;
            }
            this.selectedGuid = guid;
            if (this.openShortcuts) this.openShortcuts = false;
            // Use the same scroll logic as keyboard manager
            import('./js/helpers/keyboardManager.ts').then(m => {
                m.scrollSelectedIntoView(guid, this);
            });
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
            const { loadSimpleState } = await import('./js/data/dbUserState.ts');
            const { value } = await loadSimpleState('keywordBlacklist');
            this.keywordBlacklistInput = Array.isArray(value) ? value.join('\n') : '';
        },
        loadCustomCss: async function(this: AppState): Promise<void> {
            const { loadSimpleState } = await import('./js/data/dbUserState.ts');
            const { value } = await loadSimpleState('customCss');
            this.customCss = (typeof value === 'string' && value.trim() !== '') ? value : this.generateCustomCssTemplate();
            this.applyCustomCss();
        },
        saveRssFeeds: async function(this: AppState): Promise<void> {
            const rssFeedsArray = this.rssFeedsInput.split(/\r?\n/).map(url => url.trim());
            try {
                await saveSimpleState('rssFeeds', rssFeedsArray);
                this.rssFeedsInput = rssFeedsArray.join('\n');
                createStatusBarMessage(this, 'RSS Feeds saved!');
                this.loading = true;
                this.progressMessage = 'Saving feeds and performing full sync...';
                const syncSuccess = await performFullSync(this);
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
                
                if (this.deck.length > 0) {
                    this.selectItem(this.deck[0].guid);
                }

                this.progressMessage = '';
                this.loading = false;
                if (!syncSuccess) {
                    createStatusBarMessage(this, 'Feeds saved, but sync finished with errors.');
                }
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
        },        saveCustomCss: async function(this: AppState): Promise<void> {
            try {
                await saveSimpleState('customCss', this.customCss);
                this.applyCustomCss();
                createStatusBarMessage(this, 'Custom CSS saved!');
            } catch (error: any) {
                console.error('Error saving custom CSS:', error);
                createStatusBarMessage(this, `Failed to save custom CSS: ${error.message}`);
            }
        },
        resetCustomCss: async function(this: AppState): Promise<void> {
            if (!confirm('Reset Custom CSS to default template? This will overwrite your current customizations.')) {
                return;
            }
            this.customCss = this.generateCustomCssTemplate();
            await this.saveCustomCss();
            createStatusBarMessage(this, 'Custom CSS reset to template!');
        },
        generateCustomCssTemplate: function(this: AppState): string {
            const style = getComputedStyle(document.documentElement);
            const vars = [
                '--bg', '--fg', '--primary', '--secondary', '--card-bg', 
                '--card-border', '--card-shadow-color', '--fg-muted', '--border-radius'
            ];
            
            let template = `/* Custom CSS Template - Current theme: ${this.theme} ${this.themeStyle} */\n:root {\n`;
            vars.forEach(v => {
                const val = style.getPropertyValue(v).trim();
                if (val) template += `  ${v}: ${val};\n`;
            });
            template += `}\n\n/* Add custom styles below */\n`;
            return template;
        },
                applyCustomCss: function(this: AppState): void {
                    let styleEl = document.getElementById('custom-user-css');
                    if (!styleEl) {
                        styleEl = document.createElement('style');
                        styleEl.id = 'custom-user-css';
                        document.head.appendChild(styleEl);
                    }
                    styleEl.textContent = this.customCss;
                },
                loadThemeStyle: async function(this: AppState): Promise<void> {
                    const { loadSimpleState } = await import('./js/data/dbUserState.ts');
                    const [, lightRes, darkRes] = await Promise.all([
                        loadSimpleState('themeStyle'),
                        loadSimpleState('themeStyleLight'),
                        loadSimpleState('themeStyleDark')
                    ]);
                    
                    this.themeStyleLight = typeof lightRes.value === 'string' ? lightRes.value : 'originalLight';
                    this.themeStyleDark = typeof darkRes.value === 'string' ? darkRes.value : 'originalDark';
                    
                    // If we just loaded, set themeStyle based on current theme to ensure consistency
                    if (this.theme === 'light') {
                        this.themeStyle = this.themeStyleLight;
                    } else {
                        this.themeStyle = this.themeStyleDark;
                    }
                    
                    this.applyThemeStyle();
                },
                updateThemeAndStyle: async function(this: AppState, newStyle: string, newTheme: 'light' | 'dark'): Promise<void> {
                    console.log(`Updating theme to ${newTheme} and style to ${newStyle}`);
                    
                    this.theme = newTheme;
                    this.themeStyle = newStyle;
                    
                    // Apply theme class to HTML element
                    const htmlEl = document.documentElement;
                    htmlEl.classList.remove('light', 'dark');
                    htmlEl.classList.add(newTheme);
                    localStorage.setItem('theme', newTheme);
                    
                    // Persist to DB
                    const { saveSimpleState } = await import('./js/data/dbUserState.ts');
                    await saveSimpleState('theme', newTheme);
                    
                    if (newTheme === 'light') {
                        this.themeStyleLight = newStyle;
                        await saveSimpleState('themeStyleLight', newStyle);
                    } else {
                        this.themeStyleDark = newStyle;
                        await saveSimpleState('themeStyleDark', newStyle);
                    }
                    
                    await saveSimpleState('themeStyle', newStyle);
                    this.applyThemeStyle();
                    createStatusBarMessage(this, `Theme set to ${newTheme} (${newStyle}).`);
                },
                saveThemeStyle: async function(this: AppState): Promise<void> {
                    // This method is now mostly handled by updateThemeAndStyle
                    // But we keep it for backward compatibility or if called directly
                    const { saveSimpleState } = await import('./js/data/dbUserState.ts');
                    
                    if (this.theme === 'light') {
                        this.themeStyleLight = this.themeStyle;
                        await saveSimpleState('themeStyleLight', this.themeStyleLight);
                    } else {
                        this.themeStyleDark = this.themeStyle;
                        await saveSimpleState('themeStyleDark', this.themeStyleDark);
                    }
                    
                    await saveSimpleState('themeStyle', this.themeStyle);
                    this.applyThemeStyle();
                },
                applyThemeStyle: function(this: AppState): void {
                    const htmlEl = document.documentElement;
                    
                    // Manage light/dark base classes
                    htmlEl.classList.remove('light', 'dark');
                    htmlEl.classList.add(this.theme);
                    
                    // Manage theme style specific classes
                    const classesToRemove = Array.from(htmlEl.classList).filter(c => c.startsWith('theme-'));
                    htmlEl.classList.remove(...classesToRemove);
                    if (this.themeStyle !== 'originalLight' && this.themeStyle !== 'originalDark') {
                        htmlEl.classList.add(`theme-${this.themeStyle}`);
                    }
                },
                loadFontSize: async function(this: AppState): Promise<void> {
                    const { loadSimpleState } = await import('./js/data/dbUserState.ts');
                    const { value } = await loadSimpleState('fontSize');
                    this.fontSize = (typeof value === 'number') ? value : 100;
                    this.applyFontSize();
                },
                saveFontSize: async function(this: AppState): Promise<void> {
                    const { saveSimpleState } = await import('./js/data/dbUserState.ts');
                    await saveSimpleState('fontSize', this.fontSize);
                    this.applyFontSize();
                },
                applyFontSize: function(this: AppState): void {
                    document.documentElement.style.setProperty('--font-scale', (this.fontSize / 100).toString());
                },
                loadFeedWidth: async function(this: AppState): Promise<void> {
                    const { loadSimpleState } = await import('./js/data/dbUserState.ts');
                    const { value } = await loadSimpleState('feedWidth');
                    this.feedWidth = (typeof value === 'number') ? value : 50;
                    this.applyFeedWidth();
                },
                saveFeedWidth: async function(this: AppState): Promise<void> {
                    const { saveSimpleState } = await import('./js/data/dbUserState.ts');
                    await saveSimpleState('feedWidth', this.feedWidth);
                    this.applyFeedWidth();
                },
                applyFeedWidth: function(this: AppState): void {
                    document.documentElement.style.setProperty('--feed-width', `${this.feedWidth}%`);
                },
                updateCounts: function(this: AppState): void {
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
                console.log('Clearing feed and progress IndexedDB object stores...');
                try {
                    const db = await initDb(); // Re-initialize/get DB connection
                    const storesToClear = ['read', 'starred', 'currentDeckGuids', 'shuffledOutGuids', 'feedItems', 'pendingOperations'];
                    const tx = db.transaction([...storesToClear, 'userSettings'], 'readwrite');
                    await Promise.all(storesToClear.map(storeName => {
                        console.log(`Clearing object store: ${storeName}`);
                        return tx.objectStore(storeName).clear();
                    }));
                    
                    // Also clear sync metadata to force a fresh pull from server
                    console.log('Clearing sync metadata from userSettings...');
                    const userSettingsStore = tx.objectStore('userSettings');
                    await Promise.all([
                        userSettingsStore.delete('lastFeedSync'),
                        userSettingsStore.delete('lastStateSync')
                    ]);

                    await tx.done;
                    console.log('Specific IndexedDB object stores and sync metadata cleared.');
                } catch (e) {
                    console.error('Error clearing IndexedDB stores:', e);
                }
                
                // localStorage is no longer cleared to keep theme and other preferences
                console.log('localStorage is preserved.');

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
                
                // Reload after a short delay to allow the message to be seen
                setTimeout(() => {
                    window.location.reload();
                }, 1000);

            } catch (error: any) {
                console.error("Error during application reset:", error);
                this.errorMessage = `Failed to reset application: ${error.message}`;
                createStatusBarMessage(this, `Failed to reset application: ${error.message}`);
                this.loading = false;
            }
        },
        backupConfig: async function(this: AppState): Promise<void> {
            console.log('backupConfig called.');
            this.showUndo = false;
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
                const [syncEnabled, imagesEnabled, itemButtonMode, urlsNewTab, filterModeResult, themeState, curvesState, flickState] = await Promise.all([
                    loadSimpleState('syncEnabled'),
                    loadSimpleState('imagesEnabled'),
                    loadSimpleState('itemButtonMode'),
                    loadSimpleState('openUrlsInNewTabEnabled'),
                    loadFilterMode(), // loadFilterMode directly returns string, not object with value
                    loadSimpleState('theme'),
                    loadSimpleState('curvesEnabled'),
                    loadSimpleState('flickToSelectEnabled')
                ]);

                this.syncEnabled = syncEnabled.value ?? true;
                this.imagesEnabled = imagesEnabled.value ?? true;
                this.itemButtonMode = itemButtonMode.value ?? 'play';
                this.openUrlsInNewTabEnabled = urlsNewTab.value ?? true;
                this.curvesEnabled = curvesState.value ?? true;
                this.flickToSelectEnabled = flickState.value ?? true;
                this.filterMode = filterModeResult; // filterModeResult is already the string
                this.theme = (themeState.value === 'light' || themeState.value === 'dark') ? themeState.value : 'dark';
                localStorage.setItem('theme', this.theme); // Ensure localStorage matches DB
                this.isOnline = isOnline();
                
                const [rssFeeds, keywordBlacklist, themeStyleLightRes, themeStyleDarkRes] = await Promise.all([
                    loadSimpleState('rssFeeds'),
                    loadSimpleState('keywordBlacklist'),
                    loadSimpleState('themeStyleLight'),
                    loadSimpleState('themeStyleDark')
                ]);

                this.themeStyleLight = typeof themeStyleLightRes.value === 'string' ? themeStyleLightRes.value : 'originalLight';
                this.themeStyleDark = typeof themeStyleDarkRes.value === 'string' ? themeStyleDarkRes.value : 'originalDark';
                this.themeStyle = this.theme === 'light' ? this.themeStyleLight : this.themeStyleDark;

                this.rssFeedsInput = parseRssFeedsConfig(rssFeeds.value).join('\n');
                this.keywordBlacklistInput = Array.isArray(keywordBlacklist.value) 
                    ? keywordBlacklist.value.join('\n') 
                    : '';
                
                await this.loadCustomCss();
                await this.loadFontSize();
                await this.loadFeedWidth();
                this.applyThemeStyle();

                // Load pre-generated decks (local only)
                const [onlineDeckRes, offlineDeckRes] = await Promise.all([
                    loadSimpleState('pregeneratedOnlineDeck'),
                    loadSimpleState('pregeneratedOfflineDeck')
                ]);
                this.pregeneratedOnlineDeck = onlineDeckRes.value;
                this.pregeneratedOfflineDeck = offlineDeckRes.value;
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
            console.log("_loadAndManageAllData: START");
            this.progressMessage = "Loading saved feed items...";
            await this.loadFeedItemsFromDB();
            console.log(`_loadAndManageAllData: After loadFeedItemsFromDB. Entries: ${this.entries.length}`);

            this.progressMessage = "Loading user state from storage...";
            // Load all necessary state in parallel
            const [starredState, shuffledState, currentDeck, shuffleState] = await Promise.all([
                loadArrayState('starred'),
                loadArrayState('shuffledOutGuids'),
                loadCurrentDeck(),
                loadShuffleState()
            ]);

            console.log("_loadAndManageAllData: Loaded starred state:", starredState.value);
            this.starred = Array.isArray(starredState.value) ? starredState.value as StarredItem[] : [];
            this.shuffledOutGuids = Array.isArray(shuffledState.value) ? shuffledState.value as ShuffledOutItem[] : [];
            this.currentDeckGuids = Array.isArray(currentDeck) ? currentDeck : [];
            console.log("_loadAndManageAllData: Loaded currentDeckGuids:", this.currentDeckGuids.slice(0, 3), typeof this.currentDeckGuids[0]);
            
            this.shuffleCount = shuffleState.shuffleCount;
            this.lastShuffleResetDate = shuffleState.lastShuffleResetDate;

            this.progressMessage = "Optimizing local storage...";
            // Prune old read items before we use them
            this.read = await loadAndPruneReadItems(Object.values(this.feedItems));
            console.log(`_loadAndManageAllData: After loadAndPruneReadItems. Read count: ${this.read.length}`);

            console.log("[deckManager] Starting deck management with all data loaded.");
            this.progressMessage = "Organizing your deck...";

            console.log("_loadAndManageAllData: Before manageDailyDeck", { readCount: this.read.length, currentDeckGuidsCount: this.currentDeckGuids.length, shuffleCount: this.shuffleCount });

            const isOnline = this.isOnline;
            const pregenKey = isOnline ? 'pregeneratedOnlineDeck' : 'pregeneratedOfflineDeck';
            const pregenDeck = this[pregenKey as keyof AppState] as DeckItem[] | null;
            
            const result = await manageDailyDeck(
                Array.from(this.entries),
                this.read,
                this.starred,
                this.shuffledOutGuids,
                this.shuffleCount,
                this.filterMode,
                this.lastShuffleResetDate,
                pregenDeck // Pass the pre-generated deck
            );

            this.deck = result.deck;
            this.currentDeckGuids = result.currentDeckGuids;
            this.shuffledOutGuids = result.shuffledOutGuids;
            this.shuffleCount = result.shuffleCount;
            this.lastShuffleResetDate = result.lastShuffleResetDate;

            // If the pre-generated deck was used, clear it from state and DB
            // We can infer usage if the returned currentDeckGuids length matches pregenDeck length 
            // and the GUIDs match (simple check: first item guid matches)
            // Or simpler: just check if manageDailyDeck returned a non-empty deck and we passed a pregen deck.
            // But manageDailyDeck might NOT have used it (if deck wasn't empty).
            // Let's rely on a GUID comparison of the first item to be reasonably sure.
            if (pregenDeck && pregenDeck.length > 0 && this.currentDeckGuids.length > 0 && 
                this.currentDeckGuids[0].guid === pregenDeck[0].guid) {
                console.log(`[deckManager] Consumed pre-generated ${isOnline ? 'ONLINE' : 'OFFLINE'} deck in _loadAndManageAllData.`);
                if (pregenKey === 'pregeneratedOnlineDeck') {
                    this.pregeneratedOnlineDeck = null;
                } else {
                    this.pregeneratedOfflineDeck = null;
                }
                const { saveSimpleState } = await import('./js/data/dbUserState.ts');
                await saveSimpleState(pregenKey, null);
                
                // Trigger background generation for the NEXT deck
                this.pregenerateDecks(); 
            }

            console.log("_loadAndManageAllData: After manageDailyDeck. Deck size:", this.deck.length);

            this.progressMessage = "Displaying your feed...";
            await this.loadAndDisplayDeck();
            console.log("_loadAndManageAllData: After loadAndDisplayDeck. Final Deck size:", this.deck.length);

            this.updateAllUI();

            if (this._initComplete && this.deck.length > 0 && !this.showUndo) {
                console.log("[_loadAndManageAllData] Auto-selecting first item after refresh.");
                this.selectItem(this.deck[0].guid);
            }

            console.log("_loadAndManageAllData: END");
        },
        updateAllUI: function(this: AppState): void {
            this.updateCounts();
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
            this.$watch("openShortcuts", async (isOpen: boolean) => {
                const isMobile = window.innerWidth < 1024;
                if (isOpen) {
                    if (!isMobile) document.body.classList.add('no-scroll');
                    await saveCurrentScrollPosition();
                } else {
                    document.body.classList.remove('no-scroll');
                    document.body.style.overflow = '';
                }
            });
            this.$watch('openSettings', async (open: boolean) => {
                const isMobile = window.innerWidth < 1024;
                if (open) {
                    this.showUndo = false;
                    if (!isMobile) document.body.classList.add('no-scroll');
                    this.modalView = 'main';
                    await manageSettingsPanelVisibility(this);
                    
                    // Focus logic
                    this.$nextTick(() => {
                        const modal = document.querySelector('.modal-content');
                        const firstFocusable = modal?.querySelector('button, select, input, textarea') as HTMLElement;
                        firstFocusable?.focus();
                    });

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
                    await saveCurrentScrollPosition();
                } else {
                    document.body.classList.remove('no-scroll');
                    document.body.style.overflow = '';
                    await saveCurrentScrollPosition();
                }
            });
            this.$watch('openUrlsInNewTabEnabled', () => {
                document.querySelectorAll('.itemdescription').forEach((el: Element) => this.handleEntryLinks(el));
            });
            this.$watch("modalView", async () => {
                await manageSettingsPanelVisibility(this);
                this.$nextTick(() => {
                    const modal = document.querySelector('.modal-content');
                    // Find the first visible focusable element in the current view
                    const firstFocusable = modal?.querySelector('div[style*="display: block"] button, div[style*="display: block"] select, div[style*="display: block"] input, div[style*="display: block"] textarea') as HTMLElement;
                    firstFocusable?.focus();
                });
            });
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
            
            this.$watch('shadowsEnabled', (enabled: boolean) => {
                document.body.classList.toggle('no-shadows', !enabled);
            });
            // Initial state for shadows
            document.body.classList.toggle('no-shadows', !this.shadowsEnabled);

            this.$watch('curvesEnabled', (enabled: boolean) => {
                document.body.classList.toggle('no-curves', !enabled);
                if (!enabled) {
                    this.undoBtnRadius = 0;
                } else {
                    // Trigger a re-calculation of radius next time undo is shown
                    this.undoBtnRadius = 20; 
                }
            });
            // Initial state for curves
            document.body.classList.toggle('no-curves', !this.curvesEnabled);
            if (!this.curvesEnabled) this.undoBtnRadius = 0;
            
            this.$watch('entries', () => this.updateCounts());
            this.$watch('read', () => this.updateCounts());
            this.$watch('starred', () => this.updateCounts());
            this.$watch('currentDeckGuids', () => this.updateCounts());
            this.$watch('selectedGuid', (newGuid: string | null) => {
                if (newGuid) {
                    this.lastSelectedGuid = newGuid;
                    this.selectedTimestamp = Date.now();
                    this.selectedSubElement = 'item'; // Reset focus to item itself on change
                } else {
                    this.selectedTimestamp = null;
                    this.selectedSubElement = 'item';
                }
            });
        },
        _setupEventListeners: function(this: AppState): void {
            const backgroundSync = async (): Promise<void> => {
                if (!this.syncEnabled || !this.isOnline) return;
                console.log('Performing periodic background sync...');
                await processPendingOperations();
                const syncSuccess = await performFeedSync(this);
                await pullUserState();
                await this._loadAndManageAllData();
                this.deckManaged = true;
                console.log(`Background sync complete. Success: ${syncSuccess}`);
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

            // Auto-save scroll position
            let scrollTimeout: any;
            window.addEventListener('scroll', () => {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    saveCurrentScrollPosition();
                }, 1000);
            }, { passive: true });

            // Global Keyboard Shortcuts
            window.addEventListener('keydown', (e: KeyboardEvent) => {
                handleKeyboardShortcuts(e, this);
            });

            // Re-trigger selection animation when returning to the app
            window.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && this.selectedGuid) {
                    console.log('[Visibility] App returned to foreground. Redrawing selection animation.');
                    const currentGuid = this.selectedGuid;
                    this.selectedGuid = null;
                    this.$nextTick(() => {
                        this.selectedGuid = currentGuid;
                    });
                }
            });
        },
        _setupFlickToSelectListeners: function(this: AppState): void {
            let lastFlickTime = 0;
            const FLICK_COOLDOWN = 800; // ms
            const VELOCITY_THRESHOLD = 0.5; // pixels per ms
            const DISTANCE_THRESHOLD = 50; // pixels
            const WHEEL_DELTA_THRESHOLD = 100;

            const getTargetGuid = (direction: number): string | null => {
                const entries = this.filteredEntries;
                if (entries.length === 0) return null;
                
                const currentIndex = this.selectedGuid ? entries.findIndex(e => e.guid === this.selectedGuid) : -1;
                let nextIndex = currentIndex + direction;
                
                if (nextIndex < 0) nextIndex = 0;
                if (nextIndex >= entries.length) nextIndex = entries.length - 1;
                
                return entries[nextIndex].guid;
            };

            const triggerFlickSelection = (direction: number) => {
                const now = Date.now();
                if (now - lastFlickTime < FLICK_COOLDOWN) return;
                
                const targetGuid = getTargetGuid(direction);
                if (!targetGuid || targetGuid === this.selectedGuid) return;

                console.log(`[Flick] Triggering selection move: direction=${direction}`);
                lastFlickTime = now;
                
                // Kill current inertia/scrolling
                window.scrollTo(window.scrollX, window.scrollY);
                
                // Trigger smooth scroll to target
                this.selectItem(targetGuid);
            };

            // --- Mouse Wheel Flick ---
            window.addEventListener('wheel', (e: WheelEvent) => {
                if (!this.flickToSelectEnabled || this.openSettings || this.showSearchBar) return;

                if (Math.abs(e.deltaY) > WHEEL_DELTA_THRESHOLD) {
                    // We don't preventDefault, but we do intercept and override if it's a "flick"
                    triggerFlickSelection(e.deltaY > 0 ? 1 : -1);
                }
            }, { passive: true });

            // --- Touch Flick ---
            let touchStartY = 0;
            let touchStartTime = 0;

            window.addEventListener('touchstart', (e: TouchEvent) => {
                if (!this.flickToSelectEnabled || this.openSettings || this.showSearchBar) return;
                touchStartY = e.touches[0].clientY;
                touchStartTime = Date.now();
            }, { passive: true });

            window.addEventListener('touchend', (e: TouchEvent) => {
                if (!this.flickToSelectEnabled || this.openSettings || this.showSearchBar) return;
                
                const touchEndY = e.changedTouches[0].clientY;
                const touchEndTime = Date.now();
                
                const distanceY = touchEndY - touchStartY;
                const duration = touchEndTime - touchStartTime;
                
                if (duration > 0) {
                    const velocity = Math.abs(distanceY) / duration;
                    if (velocity > VELOCITY_THRESHOLD && Math.abs(distanceY) > DISTANCE_THRESHOLD) {
                        triggerFlickSelection(distanceY < 0 ? 1 : -1);
                    }
                }
            }, { passive: true });
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
                    try {
                        await processPendingOperations();
                        const syncSuccess = await performFeedSync(this);
                        await pullUserState();
                        await this._loadAndManageAllData();
                        this.deckManaged = true;
                        console.log(`Scheduled sync complete. Success: ${syncSuccess}`);
                        
                        // After sync, pre-generate decks for next shuffle
                        await this.pregenerateDecks();
                    } catch (error) {
                    console.error('Periodic sync failed:', error);
                }
            }, SYNC_INTERVAL_MS);
        },
        _startWorkerFeedSync: function(this: AppState): void {
            // Trigger an initial sync shortly after startup
            setTimeout(() => {
                fetch(`${window.location.origin}/api/feed-sync`, { method: 'POST' })
                    .then(r => r.json())
                    .then(d => console.log('[Worker Sync] Startup sync triggered:', d))
                    .catch(e => console.error('[Worker Sync] Startup sync failed:', e));
            }, 5000);

            // Periodically trigger worker to fetch and process RSS feeds (every 10 minutes)
            setInterval(() => {
                if (!this.isOnline || !this.syncEnabled) return;
                console.log('[Worker Sync] Triggering background feed processing...');
                fetch(`${window.location.origin}/api/feed-sync`, { method: 'POST' })
                    .then(r => r.json())
                    .then(d => console.log('[Worker Sync] Background sync complete:', d))
                    .catch(e => console.error('[Worker Sync] Background sync failed:', e));
            }, 10 * 60 * 1000);
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
            element.querySelectorAll('a').forEach(link => {
                if ((link as HTMLAnchorElement).hostname !== window.location.hostname) {
                    if (this.openUrlsInNewTabEnabled) {
                        link.setAttribute('target', '_blank');
                        link.setAttribute('rel', 'noopener noreferrer');
                    } else {
                        link.removeAttribute('target');
                    }
                }
            });
        },

        toggleSearch: function(this: AppState): void {
            toggleSearch(this);
        },

        discoverFeed: async function(this: AppState): Promise<void> {
            await discoverFeed(this);
        },

        // --- Background Generation ---
        pregenerateDecks: async function(this: AppState): Promise<void> {
            if (this._isPregenerating) return;
            this._isPregenerating = true;
            console.log('[Background] Starting pre-generation of decks...');
            
            try {
                // Pre-generate online deck (always do this if possible)
                await this._generateAndSavePregeneratedDeck(true);
                
                // Pre-generate offline deck (optimized for offline reliability)
                await this._generateAndSavePregeneratedDeck(false);
                
                console.log('[Background] Deck pre-generation completed.');
            } catch (error) {
                console.error('[Background] Deck pre-generation failed:', error);
            } finally {
                this._isPregenerating = false;
            }
        },

        _generateAndSavePregeneratedDeck: async function(this: AppState, online: boolean): Promise<void> {
            const { generateNewDeck } = await import('./js/helpers/dataUtils.ts');
            const { saveSimpleState } = await import('./js/data/dbUserState.ts');
            
            // We use current state but mimic the target connectivity
            const deckItems = await generateNewDeck(
                Array.from(this.entries),
                this.read,
                this.starred,
                this.shuffledOutGuids,
                'unread',
                online // Target connectivity
            );

            const timestamp = new Date().toISOString();
            const deckGuids = (deckItems || []).map(item => ({
                guid: item.guid,
                addedAt: timestamp
            }));

            const key = online ? 'pregeneratedOnlineDeck' : 'pregeneratedOfflineDeck';
            this[key] = deckGuids;
            await saveSimpleState(key, deckGuids);
            console.log(`[Background] Pregenerated ${online ? 'ONLINE' : 'OFFLINE'} deck saved. Size: ${deckGuids.length}`);
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
(window as any).Alpine = Alpine;
Alpine.start();