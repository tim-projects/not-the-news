// @filepath: src//main.ts

import Alpine from 'alpinejs';
import collapse from '@alpinejs/collapse';
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
    getAllFeedItems
} from './js/data/dbSyncOperations.ts';
import { getAuthToken } from './js/data/dbAuth.ts';
import {
    loadSimpleState,
    loadArrayState,
    USER_STATE_DEFS
} from './js/data/dbStateDefs.ts';
import {
    initDb,
    closeDb
} from './js/data/dbCore.ts';
import {
    saveSimpleState
} from './js/data/dbUserState.ts';
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
import { onAuthStateChanged, signOut, updatePassword, deleteUser, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || window.location.origin;

// Enforce authentication before initializing the app
let authInitialized = false;
let initialAuthChecked = false;

onAuthStateChanged(auth, (user) => {
    const path = window.location.pathname;
    authInitialized = true;
    
    console.log(`[Auth Event] User: ${user?.uid || 'null'}, Path: ${path}, Initialized: ${initialAuthChecked}`);

    if (user) {
        localStorage.setItem('isAuthenticated', 'true');
        if (path.endsWith('login.html')) {
            console.log(`[Auth Check] Already logged in, redirecting to home`);
            window.location.replace('/');
        }
    } else {
        localStorage.removeItem('isAuthenticated');
        // Only redirect if we explicitly KNOW we are logged out
        // AND we've already done the first pass of initialization
        if (initialAuthChecked && !path.endsWith('login.html')) {
            console.log(`[Auth Check] User session ended, redirecting to login.html`);
            window.location.replace('/login.html');
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
        lastFeedSync: 0,
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
        entries: [],
        read: [],
        starred: [],
        currentDeckGuids: [],
        shuffledOutGuids: [],
        pregeneratedOnlineDeck: null,
        pregeneratedOfflineDeck: null,
        errorMessage: '',
        userEmail: '',
        isOnline: isOnline(),
        deckManaged: false,
        syncStatusMessage: '',
        showSyncStatus: false,
        theme: localStorage.getItem('theme') || 'dark',
        themeStyle: localStorage.getItem('theme') === 'light' ? (localStorage.getItem('themeStyleLight') || 'originalLight') : (localStorage.getItem('themeStyleDark') || 'originalDark'),
        themeStyleLight: localStorage.getItem('themeStyleLight') || 'originalLight',
        themeStyleDark: localStorage.getItem('themeStyleDark') || 'originalDark',
        fontTitle: "'Playfair Display', serif",
        fontBody: "inherit",
        _initialRssFeedsInput: '',
        _initialKeywordBlacklistInput: '',
        customCss: '',
        fontSize: 100,
        feedWidth: 50,
        animationSpeed: 100,
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
        activeMenuGuid: null,
        readingGuid: null,
        speakingGuid: null,
        closingGuid: null,
        nextSwipeDirection: 'left',
        fullscreenImage: null,
        activeExpandGuid: null,
        db: null,
        _lastFilterHash: '',
        _cachedFilteredEntries: null,
        scrollObserver: null,
        imageObserver: null,
        staleItemObserver: null,
        _initComplete: false,
        _isSyncing: false,
        _isPregenerating: false,
        
        // --- Backup & Restore ---
        backupSelections: {
            feeds: true,
            appearance: true,
            history: true,
            settings: true
        },
        showRestorePreview: false,
        restoreData: null,
        
        // --- Core Methods ---
        initApp: async function(this: AppState): Promise<void> {
            try {
                // OPTIMISTIC AUTH: If we have a hint that we're logged in, proceed immediately
                const authHint = localStorage.getItem('isAuthenticated') === 'true';
                
                if (!authHint) {
                    console.log("[Auth] No hint found, waiting for verification...");
                    this.progressMessage = 'Verifying authentication...';
                    let waitCount = 0;
                    while (!authInitialized && waitCount < 50) { 
                        await new Promise(resolve => setTimeout(resolve, 100));
                        waitCount++;
                    }
                } else {
                    console.log("[Auth] Hint found, proceeding with optimistic load.");
                }

                // Redirect if we definitely aren't logged in (after hint check or verification)
                if (!authHint && !auth.currentUser && !window.location.pathname.endsWith('login.html')) {
                    console.log("[Auth] Not logged in, redirecting to login.html");
                    window.location.replace('/login.html');
                    return;
                }

                if (auth.currentUser) {
                    initialAuthChecked = true;
                    this.userEmail = auth.currentUser.email || (auth.currentUser.isAnonymous ? 'Guest' : 'Authenticated User');
                }

                this.progressMessage = 'Connecting to database...';
                try {
                    this.db = await initDb();
                } catch (dbError: any) {
                    console.error("Database initialization failed:", dbError);
                    throw new Error(`Local database failed: ${dbError.message}`);
                }
                
                this.progressMessage = 'Loading settings...';
                try {
                    await this._loadInitialState();
                } catch (stateError: any) {
                    console.error("Initial state load failed:", stateError);
                }
                
                // DETECT NEW DEVICE / EMPTY STATE
                // If we have no sync history, we should perform a full blocking sync instead of optimistic loading
                const isNewDevice = this.lastFeedSync === 0;
                if (isNewDevice && authHint) {
                    console.log("[Init] New device detected (no local sync history). Performing full blocking sync.");
                }

                this._initImageObserver();

                // Warm up TTS voices
                if ('speechSynthesis' in window) {
                    window.speechSynthesis.getVoices();
                    window.speechSynthesis.onvoiceschanged = () => {
                        const voices = window.speechSynthesis.getVoices();
                        console.log(`[TTS] Voices loaded: ${voices.length} available.`);
                    };
                }

                // Refresh online status
                this.isOnline = isOnline();

                // Background Sync Phase
                if (this.isOnline) {
                    // Wait for actual auth before triggering network sync if we only had a hint
                    if (!authInitialized) {
                        console.log("[Init] Waiting for background auth verification before network sync...");
                        
                        const syncLogic = async () => {
                            let syncWait = 0;
                            while (!authInitialized && syncWait < 100) { // Max 10s wait
                                await new Promise(t => setTimeout(t, 100));
                                syncWait++;
                            }
                            if (auth.currentUser) {
                                console.log("[Init] Auth verified in background, triggering sync.");
                                if (isNewDevice) this.progressMessage = 'Restoring account data...';
                                
                                await processPendingOperations();
                                
                                // PHASE 1: Pull essential metadata only (deck, theme check)
                                // If new device, pull everything immediately
                                const skipKeys = isNewDevice ? [] : ['rssFeeds', 'keywordBlacklist', 'customCss', 'shuffleCount', 'lastShuffleResetDate', 'animationSpeed', 'openUrlsInNewTabEnabled', 'themeStyle', 'themeStyleLight', 'themeStyleDark', 'read', 'starred'];
                                await pullUserState(false, skipKeys, this);
                                
                                // PHASE 2: Trigger expensive content refresh
                                const SYNC_THRESHOLD_MS = 10 * 60 * 1000;
                                if ((Date.now() - (this.lastFeedSync || 0)) > SYNC_THRESHOLD_MS) {
                                    if (isNewDevice) this.progressMessage = 'Downloading latest news...';
                                    await performFeedSync(this);
                                }
                            }
                        };

                        if (isNewDevice) {
                            await syncLogic(); // Block if new device
                        } else {
                            syncLogic(); // Background if existing
                        }
                    } else if (auth.currentUser) {
                        // Already verified
                        this.progressMessage = isNewDevice ? 'Restoring profile...' : 'Syncing user profile...';
                        try {
                            if (isOnline()) await processPendingOperations();
                            // Phase 1 sync (or full if new)
                            const skipKeys = isNewDevice ? [] : ['rssFeeds', 'keywordBlacklist', 'customCss', 'shuffleCount', 'lastShuffleResetDate', 'animationSpeed', 'openUrlsInNewTabEnabled', 'themeStyle', 'themeStyleLight', 'themeStyleDark', 'read', 'starred'];
                            await pullUserState(false, skipKeys, this);
                        } catch (e) {
                            console.error("Profile sync failed:", e);
                        }

                        const SYNC_THRESHOLD_MS = 10 * 60 * 1000;
                        if ((Date.now() - (this.lastFeedSync || 0)) > SYNC_THRESHOLD_MS) {
                            const hasItems = Object.keys(this.feedItems).length > 0;
                            if (hasItems && !isNewDevice) {
                                performFeedSync(this); // Fire and forget
                            } else {
                                this.progressMessage = isNewDevice ? 'Building your feed...' : 'Syncing latest content...';
                                try {
                                    await performFeedSync(this);
                                } catch (e) {
                                    console.warn("Initial feed sync failed.");
                                }
                            }
                        }
                    }
                }

                // Always load local data immediately
                this.progressMessage = 'Loading local data...';
                await this._loadAndManageAllData();

                this.progressMessage = 'Applying user preferences...';
                initSyncToggle(this);
                initImagesToggle(this);
                initItemButtonMode(this);
                initShadowsToggle(this);
                initCurvesToggle(this);
                initUrlsNewTabToggle(this);
                attachScrollToTopHandler();
                this.$nextTick(() => { initScrollPosition(this); });
                
                if (this.deck.length === 0) {
                    if (this.entries.length > 0) {
                        this.progressMessage = 'Fetching and building your feed...';
                    } else {
                        this.progressMessage = 'No feed items found. Please configure your RSS feeds.';
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    if (!this.selectedGuid) {
                        const { value: lastId } = await loadSimpleState('lastViewedItemId');
                        const isRestoring = lastId && this.deck.some(item => item.guid === lastId);
                        if (!isRestoring && this.deck.length > 0) {
                            this.selectItem(this.deck[0].guid);
                        }
                    }
                }
                
                this.loading = false; // Hide main loading screen as soon as feed is ready
                this._initComplete = true;

                (async () => {
                    console.log("[Init] Starting background initialization tasks...");
                    this._setupWatchers();
                    this._setupEventListeners();
                    this._startPeriodicSync();
                    this._startWorkerFeedSync();
                    this._initScrollObserver();
                    this._initObservers();
                    this.pregenerateDecks();
                    await this.updateSyncStatusMessage();
                    
                    if (authInitialized && auth.currentUser) {
                        console.log("[Init] Pulling remaining user state in background...");
                        await pullUserState(false, [], this);
                    }
                    console.log("[Init] Background initialization complete.");
                })();

            } catch (error: any) {
                console.error("Initialization failed:", error);
                this.errorMessage = `Could not load feed: ${error.message}`;
                this.progressMessage = `Error: ${error.message}`;
                this.loading = false;
                createStatusBarMessage(this, `Could not load feed: ${error.message}`);
            }
        },

        performBackgroundSync: async function (this: AppState): Promise<void> {
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
                if (!syncSuccess) {
                    createStatusBarMessage(this, 'Sync finished with errors.');
                }
            } catch (error: any) {
                console.error('Immediate background sync failed:', error);
                this.progressMessage = 'Sync Failed!';
                this.loading = false;
                createStatusBarMessage(this, `Sync failed: ${error.message}`);
            }
        },

        updateSyncStatusMessage: async function (this: AppState): Promise<void> {
            const online = isOnline();

            if (!online) {
                createStatusBarMessage(this, 'Offline.');
            } else if (!this.syncEnabled) {
                createStatusBarMessage(this, 'Sync is disabled.');
            } else {
                // When coming back online, we don't necessarily need a toast 
                // unless we want to confirm the reconnection.
                // But the user might prefer it stays clean.
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

        changePassword: function(this: AppState): void {
            const user = auth.currentUser;
            if (!user) return;
            this.modalView = 'change-password';
        },

        submitPasswordChange: async function(this: AppState): Promise<void> {
            const user = auth.currentUser;
            if (!user) return;
            
            const passwordInput = document.getElementById('new-password-input') as HTMLInputElement;
            const newPassword = passwordInput.value;

            if (!newPassword || newPassword.length < 6) {
                alert("Password must be at least 6 characters long.");
                return;
            }

            try {
                await updatePassword(user, newPassword);
                createStatusBarMessage(this, "Password updated successfully!");
                passwordInput.value = ''; // Clear input
                this.modalView = 'advanced'; // Go back
            } catch (error: any) {
                console.error("Password update error:", error);
                if (error.code === 'auth/requires-recent-login') {
                    alert("This operation requires recent authentication. Please log out and log back in, then try again.");
                } else {
                    createStatusBarMessage(this, `Failed to update password: ${error.message}`);
                }
            }
        },

        deleteAccount: async function(this: AppState): Promise<void> {
            const user = auth.currentUser;
            if (!user) return;

            const confirmation = confirm("CRITICAL: This will permanently delete your account and all your saved data from the server. This action CANNOT be undone.\n\nAre you absolutely sure?");
            if (!confirmation) return;

            const secondConfirmation = confirm("FINAL WARNING: Are you really, really sure you want to delete your account?");
            if (!secondConfirmation) return;

            try {
                // 1. Call backend to clear server-side data (optional but good practice)
                await this.resetApplicationData(); // This also clears local DB

                // 2. Delete user from Firebase Auth
                await deleteUser(user);
                
                alert("Your account has been successfully deleted.");
                window.location.href = '/login.html';
            } catch (error: any) {
                console.error("Account deletion error:", error);
                if (error.code === 'auth/requires-recent-login') {
                    alert("This operation requires recent authentication. Please log out and log back in, then try again.");
                } else {
                    createStatusBarMessage(this, `Failed to delete account: ${error.message}`);
                }
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
            const readSet = new Set(this.read.map(h => h.guid.toLowerCase()));
            const starredSet = new Set(this.starred.map(s => s.guid.toLowerCase()));
            const seenGuidsForDeck = new Set<string>();

            const missingGuids: string[] = [];
            let foundCount = 0;

            for (const deckItem of guidsToDisplay) { 
                const guid = deckItem.guid;
                if (typeof guid !== 'string' || !guid) continue;
                
                const item = this.feedItems[guid.toLowerCase()];
                // Check for item existence AND presence of content (description) AND title
                if (item && item.guid && item.description && item.title && !seenGuidsForDeck.has(item.guid.toLowerCase())) {
                    const mappedItem = mapRawItem(item, formatDate);
                    if (mappedItem && mappedItem.title) { 
                        const g = mappedItem.guid.toLowerCase();
                        mappedItem.isRead = readSet.has(g);
                        mappedItem.isStarred = starredSet.has(g);
                        items.push(mappedItem);
                        seenGuidsForDeck.add(g);
                        foundCount++;
                    } else {
                         // If mapRawItem returns null OR title is missing after mapping, treat as missing
                        missingGuids.push(guid);
                    }
                } else {
                    missingGuids.push(guid);
                }
            }

            console.log(`[loadAndDisplayDeck] Found ${foundCount} items locally, ${missingGuids.length} items missing.`);

            // --- SOLUTION: Fetch missing items from server ---
            if (missingGuids.length > 0 && isOnline()) {
                console.log(`[loadAndDisplayDeck] Attempting to fetch ${missingGuids.length} missing items from server...`);
                const { _fetchItemsInBatches } = await import('./js/data/dbSyncOperations.ts');
                const fetchedItems = await _fetchItemsInBatches(missingGuids, this, missingGuids.length, foundCount);
                
                if (fetchedItems && fetchedItems.length > 0) {
                    console.log(`[loadAndDisplayDeck] Successfully fetched ${fetchedItems.length} items from server.`);
                    // Save to local DB so they are available next time
                    const { withDb } = await import('./js/data/dbCore.ts');
                    await withDb(async (db: any) => {
                        const tx = db.transaction('feedItems', 'readwrite');
                        for (const item of fetchedItems) {
                            if (item.guid) {
                                await tx.store.put(item);
                                this.feedItems[item.guid.toLowerCase()] = item;
                            }
                        }
                        await tx.done;
                    });

                    // Re-process the missing items into the display items array
                    for (const item of fetchedItems) {
                        const mappedItem = mapRawItem(item, formatDate);
                        if (mappedItem && !seenGuidsForDeck.has(mappedItem.guid.toLowerCase())) {
                            const g = mappedItem.guid.toLowerCase();
                            mappedItem.isRead = readSet.has(g);
                            mappedItem.isStarred = starredSet.has(g);
                            items.push(mappedItem);
                            seenGuidsForDeck.add(g);
                            foundCount++;
                        }
                    }
                }
            }
            // --- END SOLUTION ---

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
                if (item && item.guid && !seenGuids.has(item.guid.toLowerCase())) {
                    this.feedItems[item.guid.toLowerCase()] = item;
                    uniqueEntries.push(item);
                    seenGuids.add(item.guid.toLowerCase());
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
            const readMap = new Map(this.read.map(h => [h.guid.toLowerCase(), h.readAt]));
            const starredMap = new Map(this.starred.map(s => [s.guid.toLowerCase(), s.starredAt]));

            switch (this.filterMode) {
                case "unread":
                    filtered = this.deck.filter(item => !readMap.has(item.guid.toLowerCase()));
                    break;
                case "all":
                    filtered = this.entries;
                    break;
                case "read":
                    filtered = this.entries.filter(e => readMap.has(e.guid.toLowerCase()))
                        .sort((a, b) => (new Date(readMap.get(b.guid.toLowerCase()) || 0).getTime()) - (new Date(readMap.get(a.guid.toLowerCase()) || 0).getTime()));
                    break;
                case "starred":
                    filtered = this.entries.filter(e => starredMap.has(e.guid.toLowerCase()))
                        .sort((a, b) => (new Date(starredMap.get(b.guid.toLowerCase()) || 0).getTime()) - (new Date(starredMap.get(a.guid.toLowerCase()) || 0).getTime()));
                    break;
            }

            filtered = filtered.map(e => {
                const g = e.guid.toLowerCase();
                return {
                    ...e,
                    isRead: readMap.has(g),
                    isStarred: starredMap.has(g)
                };
            });

            // Apply Keyword Blacklist
            const keywordBlacklist = (this.keywordBlacklistInput ?? '')
                .split(/\r?\n/)
                .map(kw => kw.trim().toLowerCase())
                .filter(kw => kw.length > 0);
            
            if (keywordBlacklist.length > 0) {
                filtered = filtered.filter(item => {
                    const searchable = `${item.title} ${item.description} ${item.guid}`.toLowerCase();
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
            const starredGuids = new Set(this.starred.map(s => (typeof s === 'string' ? s : s.guid).toLowerCase()));
            return this.entries.filter(e => starredGuids.has(e.guid.toLowerCase())).length;
        },
        get readCount(): number {
            if (!this.entries.length) return 0;
            const readGuids = new Set(this.read.map(r => (typeof r === 'string' ? r : r.guid).toLowerCase()));
            return this.entries.filter(e => readGuids.has(e.guid.toLowerCase())).length;
        },
        get unreadCount(): number {
            if (!this.entries.length || !this.currentDeckGuids.length) return 0;
            const readGuids = new Set(this.read.map(r => (typeof r === 'string' ? r : r.guid).toLowerCase()));
            const shuffledOutGuids = new Set(this.shuffledOutGuids.map(s => (typeof s === 'string' ? s : s.guid).toLowerCase()));
            const deckGuids = new Set(this.currentDeckGuids.map(item => (typeof item === 'string' ? item : item.guid).toLowerCase()));
            
            const keywordBlacklist = (this.keywordBlacklistInput ?? '')
                .split(/\r?\n/)
                .map(kw => kw.trim().toLowerCase())
                .filter(kw => kw.length > 0);

            return this.entries.filter(e => {
                const g = e.guid.toLowerCase();
                // Basic unread check
                const isUnread = deckGuids.has(g) && !readGuids.has(g) && !shuffledOutGuids.has(g);
                if (!isUnread) return false;

                // Blacklist check
                if (keywordBlacklist.length > 0) {
                    const searchable = `${e.title} ${e.description} ${e.guid}`.toLowerCase();
                    if (keywordBlacklist.some(keyword => searchable.includes(keyword))) {
                        return false;
                    }
                }

                return true;
            }).length;
        },
        get isSettingsDirty(): boolean {
            return this.rssFeedsInput !== this._initialRssFeedsInput || 
                   this.keywordBlacklistInput !== this._initialKeywordBlacklistInput;
        },
        // --- Action Methods ---
        isStarred: function (this: AppState, guid: string): boolean {
            if (!guid) return false;
            const g = guid.toLowerCase();
            return this.starred.some(e => (typeof e === 'string' ? e : e.guid).toLowerCase() === g);
        }, isRead: function (this: AppState, guid: string): boolean {
            if (!guid) return false;
            const g = guid.toLowerCase();
            return this.read.some(e => (typeof e === 'string' ? e : e.guid).toLowerCase() === g);
        },
        toggleStar: async function (this: AppState, guid: string): Promise<void> {
            const isStarring = !this.starred.some(item => item.guid === guid);
            if (isStarring) {
                this.starredGuid = guid;
                const animDuration = 667 * (100 / (this.animationSpeed || 100));
                setTimeout(() => {
                    if (this.starredGuid === guid) this.starredGuid = null;
                }, animDuration); // Sync with CSS draw-outline duration + delay
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
                const animFactor = 100 / (this.animationSpeed || 100);
                // Phase 1: Fold animation (333ms baseline)
                if (this.filterMode === 'unread') {
                    this.closingGuid = guid;
                    await new Promise(resolve => setTimeout(resolve, 333 * animFactor));
                    
                    // Phase 2: Swipe animation (300ms baseline)
                    await new Promise(resolve => setTimeout(resolve, 300 * animFactor));
                } else {
                    // Just the short delay for the button animation if not removing
                    await new Promise(resolve => setTimeout(resolve, 333 * animFactor));
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

            if (!isCurrentlyRead) {
                this.nextSwipeDirection = this.nextSwipeDirection === 'left' ? 'right' : 'left';
            }

            if (this.filterMode === 'unread' && !isCurrentlyRead) {
                // If it was unread and now read, remove it from the deck in unread mode
                removedIndex = this.currentDeckGuids.findIndex(item => item.guid === guid);
                if (removedIndex === -1) removedIndex = null;

                this.deck = this.deck.filter(item => item.guid !== guid);
                this.currentDeckGuids = this.currentDeckGuids.filter(deckItem => deckItem.guid !== guid);
                
                // Select next item AFTER animations and state update to ensure stable DOM positions
                if (nextGuidToSelect) {
                    this.selectItem(nextGuidToSelect);
                } else if (wasSelected) {
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
                }
            }
            
            this.updateCounts();
            this.updateSyncStatusMessage();

            if (!isCurrentlyRead && this.filterMode !== 'all') {
                showUndoNotification(this, guid, removedIndex);
            }

            // --- BACKGROUND WORK: Move DB and Sync actions to background to keep UI snappy ---
            (async () => {
                // 1. Sync and array updates (Awaited but inside background scope)
                await toggleItemStateAndSync(this, guid, 'read');

                // 2. Save current deck state
                const { saveCurrentDeck } = await import('./js/helpers/userStateUtils.ts');
                await saveCurrentDeck(this.currentDeckGuids);

                // 3. UI Reconcile (minor cleanup)
                await this._reconcileAndRefreshUI();

                // 4. Refresh logic: ONLY when deck is completely finished (0 unread)
                let remainingUnreadInDeck = this.deck.filter(item => !this.isRead(item.guid)).length;
                
                if (this.filterMode === 'unread' && remainingUnreadInDeck === 0) {
                    console.log("[toggleRead] Current deck finished. Preparing next batch in background...");
                    
                    // Trigger background tasks while user sees the undo button
                    this.pregenerateDecks();
                    this.loadFeedItemsFromDB();
                    const refreshPromise = this._loadAndManageAllData(true); // skipLoad: true

                    // Wait while undo is visible (max 5.5s) without blocking the UI
                    while (this.showUndo) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    
                    // Once undo is gone, wait for the already-started refresh to finish
                    await refreshPromise;

                    // Re-verify after potential undo
                    remainingUnreadInDeck = this.deck.filter(item => !this.isRead(item.guid)).length;
                    if (remainingUnreadInDeck > 0) {
                        console.log("[toggleRead] Undo detected, batch preserved.");
                        return;
                    }

                    // Auto-select first item of the new batch
                    if (this.deck.length > 0) {
                        this.selectItem(this.deck[0].guid);
                    }
                }
            })();
        },

        toggleItemMenu: function(this: AppState, guid: string): void {
            if (this.activeMenuGuid === guid) {
                this.activeMenuGuid = null;
            } else {
                this.activeMenuGuid = guid;
            }
        },

        shareItem: function(this: AppState, guid: string): void {
            const entry = this.entries.find(e => e.guid === guid);
            if (!entry) return;
            
            console.log(`[Share] Sharing item: ${entry.title}`);
            createStatusBarMessage(this, 'Sharing feature coming soon!');
            
            // Close menu after action
            this.activeMenuGuid = null;
        },

        undoMarkRead: async function(this: AppState): Promise<void> {
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
                console.log(`[DEBUG] Content for rssFeeds input: ${this.rssFeedsInput}`);
            } catch (error) {
                console.error('Error loading RSS feeds:', error);
            }
        },        loadKeywordBlacklist: async function(this: AppState): Promise<void> {
            const { value } = await loadSimpleState('keywordBlacklist');
            this.keywordBlacklistInput = Array.isArray(value) ? value.join('\n') : '';
            console.log(`[DEBUG] Content for keywordBlacklist input: ${this.keywordBlacklistInput}`);
        },
        loadCustomCss: async function(this: AppState): Promise<void> {
            const { value } = await loadSimpleState('customCss');
            this.customCss = (typeof value === 'string' && value.trim() !== '') ? value : this.generateCustomCssTemplate();
            this.applyCustomCss();
        },
        saveRssFeeds: async function(this: AppState): Promise<void> {
            const lines = this.rssFeedsInput.split(/\r?\n/);
            const normalizedLines = lines.map(line => {
                const trimmed = line.trim();
                if (trimmed.length === 0 || trimmed.startsWith('#')) return line;
                
                // If it looks like a URL but has no protocol, add https://
                if (!trimmed.includes('://') && trimmed.includes('.')) {
                    return `https://${trimmed}`;
                }
                return line;
            });

            const rssFeedsArray = normalizedLines.map(url => url.trim());
            
            // Check if anything has actually changed to avoid redundant syncs
            const { value: currentFeeds } = await loadSimpleState('rssFeeds');
            const currentArray = parseRssFeedsConfig(currentFeeds);
            const isSame = currentArray.length === rssFeedsArray.filter(u => u && !u.startsWith('#')).length && 
                           rssFeedsArray.filter(u => u && !u.startsWith('#')).every(u => currentArray.includes(u));
            
            if (isSame) {
                console.log('[saveRssFeeds] No changes detected, skipping save and sync.');
                createStatusBarMessage(this, 'No changes to feeds.');
                return;
            }

            // Validate URLs
            const invalidUrls: string[] = [];
            rssFeedsArray.forEach(line => {
                const trimmed = line.trim();
                if (trimmed.length > 0 && !trimmed.startsWith('#')) {
                    try {
                        const url = new URL(trimmed);
                        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                            invalidUrls.push(line);
                        }
                    } catch {
                        invalidUrls.push(line);
                    }
                }
            });

            if (invalidUrls.length > 0) {
                const proceed = confirm(`The following URLs appear to be invalid:\n\n${invalidUrls.slice(0, 5).join('\n')}${invalidUrls.length > 5 ? '\n...and more' : ''}\n\nInvalid URLs will be saved but ignored by the sync process. Proceed anyway?`);
                if (!proceed) return;
            }

            try {
                await saveSimpleState('rssFeeds', rssFeedsArray);
                this.rssFeedsInput = normalizedLines.join('\n');
                this._initialRssFeedsInput = this.rssFeedsInput;
                createStatusBarMessage(this, 'RSS Feeds saved!');
                this.loading = true;
                this.progressMessage = 'Saving feeds and performing full sync...';
                
                // Trigger worker to start fetching these new feeds immediately
                const token = await getAuthToken();
                if (token) {
                    await fetch(`${API_BASE_URL}/api/refresh`, { 
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).catch(e => console.error('[Worker Sync] Immediate sync failed:', e));
                }

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
            const keywordsArray = this.keywordBlacklistInput.split(/\r?\n/).map(kw => kw.trim().toLowerCase()).filter(Boolean).sort();
            
            // Check if anything changed
            const { value: currentBlacklist } = await loadSimpleState('keywordBlacklist');
            const currentArray = Array.isArray(currentBlacklist) ? [...currentBlacklist].sort() : [];
            const isSame = currentArray.length === keywordsArray.length && 
                           keywordsArray.every((kw, idx) => kw === currentArray[idx]);

            if (isSame) {
                console.log('[saveKeywordBlacklist] No changes detected, skipping save.');
                createStatusBarMessage(this, 'No changes to blacklist.');
                return;
            }

            try {
                await saveSimpleState('keywordBlacklist', keywordsArray);
                this.keywordBlacklistInput = keywordsArray.join('\n');
                this._initialKeywordBlacklistInput = this.keywordBlacklistInput;
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
                     
                    await saveSimpleState('theme', newTheme);
                    
                    if (newTheme === 'light') {
                        this.themeStyleLight = newStyle;
                        localStorage.setItem('themeStyleLight', newStyle);
                        await saveSimpleState('themeStyleLight', newStyle);
                    } else {
                        this.themeStyleDark = newStyle;
                        localStorage.setItem('themeStyleDark', newStyle);
                        await saveSimpleState('themeStyleDark', newStyle);
                    }
                    
                    await saveSimpleState('themeStyle', newStyle);
                    this.applyThemeStyle();
                    createStatusBarMessage(this, `Theme set to ${newTheme} (${newStyle}).`);
                },
                saveThemeStyle: async function(this: AppState): Promise<void> {
                    // This method is now mostly handled by updateThemeAndStyle
                    // But we keep it for backward compatibility or if called directly
                    if (this.theme === 'light') {
                        this.themeStyleLight = this.themeStyle;
                        localStorage.setItem('themeStyleLight', this.themeStyleLight);
                        await saveSimpleState('themeStyleLight', this.themeStyleLight);
                    } else {
                        this.themeStyleDark = this.themeStyle;
                        localStorage.setItem('themeStyleDark', this.themeStyleDark);
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
                    if (classesToRemove.length > 0) {
                        htmlEl.classList.remove(...classesToRemove);
                    }
                    
                    // Add the theme class (now including original themes)
                    if (this.themeStyle) {
                        htmlEl.classList.add(`theme-${this.themeStyle}`);
                    }
                },
                loadFontSize: async function(this: AppState): Promise<void> {
                    const { value } = await loadSimpleState('fontSize');
                    this.fontSize = (typeof value === 'number') ? value : 100;
                    this.applyFontSize();
                },
                saveFontSize: async function(this: AppState): Promise<void> {
                    await saveSimpleState('fontSize', this.fontSize);
                    this.applyFontSize();
                },
                applyFontSize: function(this: AppState): void {
                    document.documentElement.style.setProperty('--font-scale', (this.fontSize / 100).toString());
                },
                loadFeedWidth: async function(this: AppState): Promise<void> {
                    const { value } = await loadSimpleState('feedWidth');
                    this.feedWidth = (typeof value === 'number') ? value : 50;
                    this.applyFeedWidth();
                },
                saveFeedWidth: async function(this: AppState): Promise<void> {
                                    await saveSimpleState('feedWidth', this.feedWidth);
                                    this.applyFeedWidth();
                                },
                                applyFeedWidth: function (this: AppState): void {
                                    document.documentElement.style.setProperty('--feed-width', `${this.feedWidth}%`);
                                },
                                saveFonts: async function (this: AppState): Promise<void> {
                                    await Promise.all([
                                        saveSimpleState('fontTitle', this.fontTitle),
                                        saveSimpleState('fontBody', this.fontBody)
                                    ]);
                                    this.applyFonts();
                                },
                                applyFonts: function (this: AppState): void {
                                    document.documentElement.style.setProperty('--font-title', this.fontTitle);
                                    document.documentElement.style.setProperty('--font-body', this.fontBody);
                                },
                                loadAnimationSpeed: async function (this: AppState): Promise<void> {                                    const { value } = await loadSimpleState('animationSpeed');
                                    this.animationSpeed = (typeof value === 'number') ? value : 100;
                                    this.applyAnimationSpeed();
                                },
                                saveAnimationSpeed: async function (this: AppState): Promise<void> {
                                    await saveSimpleState('animationSpeed', this.animationSpeed);
                                    this.applyAnimationSpeed();
                                },
                                applyAnimationSpeed: function (this: AppState): void {
                                    // 200% speed means 0.5x duration, 50% speed means 2x duration
                                    const factor = 100 / (this.animationSpeed || 100);
                                    document.documentElement.style.setProperty('--animation-duration-factor', factor.toString());
                                },
                                updateCounts: function (this: AppState): void {
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
                        } else if (img.src) {
                            // If it already has a src (e.g. description image), ensure it gets the loaded class
                            if (img.complete) {
                                img.classList.add('loaded');
                            } else {
                                img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
                            }
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
            
            if (!this.isOnline) {
                alert("Resetting the application requires an internet connection to re-download your data.");
                return;
            }

            const isConfirmed = confirm('Are you sure you want to reset the application? This will clear all local data and re-download everything from the server. Use this if your local feed is out of sync.');
            console.log('User confirmed reset:', isConfirmed);
            if (!isConfirmed) {
                console.log('Reset cancelled by user.');
                return;
            }

            this.openSettings = false; // Close settings immediately
            this.loading = true;
            this.progressMessage = 'Clearing local data...';

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

                // 3. Skip server wipe. We want to Restore, not Delete.
                console.log('Skipping server wipe to allow restoration.');
                
                console.log("Local data cleared. Triggering re-sync...");
                this.progressMessage = 'Restoring data from cloud...';
                
                // --- FIX: Before reloading, ensure we pull the preserved state from the backend ---
                // Passing 'true' to force a fresh pull of all keys.
                await pullUserState(true, [], this);
                
                createStatusBarMessage(this, 'Local reset complete! Reloading...');
                
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
        backupConfig: async function (this: AppState): Promise<void> {
            console.log('backupConfig called.');
            this.showUndo = false;
            createStatusBarMessage(this, 'Generating backup file...');
            try {
                this.progressMessage = 'Fetching configuration for backup...';
                 
                const token = await getAuthToken();
                const response = await fetch(`${API_BASE_URL}/api/admin/archive-export`, {
                    method: 'GET',
                    headers: {
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    }
                });

                if (!response.ok) {
                    let errorMsg = 'Failed to fetch config for backup.';
                    try {
                        const errorData = await response.json();
                        errorMsg = errorData.message || errorData.error || errorMsg;
                    } catch (e) {
                        const text = await response.text();
                        errorMsg = `Server error (${response.status}): ${text.substring(0, 100)}`;
                    }
                    throw new Error(errorMsg);
                }

                const configData = await response.json();
                
                const CATEGORIES = {
                    feeds: ['rssFeeds', 'keywordBlacklist'],
                    appearance: ['theme', 'themeStyle', 'themeStyleLight', 'themeStyleDark', 'fontSize', 'feedWidth', 'animationSpeed', 'customCss', 'shadowsEnabled', 'curvesEnabled', 'imagesEnabled'],
                    history: ['read', 'starred', 'hidden'],
                    settings: ['syncEnabled', 'openUrlsInNewTabEnabled', 'itemButtonMode', 'filterMode', 'lastViewedItemId', 'lastViewedItemOffset', 'searchQuery', 'showSearchBar']
                };

                // Filter based on selections
                const filteredConfig: Record<string, any> = {};
                for (const [category, enabled] of Object.entries(this.backupSelections)) {
                    if (enabled) {
                        const keys = CATEGORIES[category as keyof typeof CATEGORIES];
                        keys.forEach(key => {
                            if (configData[key] !== undefined) {
                                filteredConfig[key] = configData[key];
                            }
                        });
                    }
                }

                if (Object.keys(filteredConfig).length === 0) {
                    createStatusBarMessage(this, 'No data selected for backup.');
                    return;
                }

                const blob = new Blob([JSON.stringify(filteredConfig, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `not-the-news-config-backup-${new Date().toISOString().replace(/:/g, '-').split('.')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                createStatusBarMessage(this, 'Backup ready for download!');
                console.log("Configuration backed up successfully!")
            } catch (e: any) {
                console.error("Error during config backup:", e);
                createStatusBarMessage(this, `Failed to backup configuration: ${e.message}`);
            } finally {
                this.progressMessage = '';
            }
        },
        restoreConfig: async function(this: AppState, event: Event): Promise<void> {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) return;

            try {
                const fileContent: string = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target?.result as string);
                    reader.onerror = (e) => reject(e);
                    reader.readAsText(file);
                });

                this.restoreData = JSON.parse(fileContent);
                
                // Validate if it's a valid backup file by checking for common keys
                const validKeys = ['rssFeeds', 'theme', 'read', 'starred', 'keywordBlacklist', 'fontSize'];
                const keysFound = Object.keys(this.restoreData).filter(key => validKeys.includes(key));

                if (keysFound.length === 0) {
                    createStatusBarMessage(this, "The selected file does not appear to be a valid Not The News backup.");
                    this.restoreData = null;
                    this.modalView = 'advanced';
                    return;
                }

                console.log(`[Restore] valid keys found: ${keysFound.join(', ')}`);
                this.showRestorePreview = true;
                this.modalView = 'restore';
                
                // Initialize selection based on what's actually in the file
                const CATEGORIES = {
                    feeds: ['rssFeeds', 'keywordBlacklist'],
                    appearance: ['theme', 'themeStyle', 'themeStyleLight', 'themeStyleDark', 'fontSize', 'feedWidth', 'animationSpeed', 'customCss', 'shadowsEnabled', 'curvesEnabled', 'imagesEnabled'],
                    history: ['read', 'starred', 'hidden'],
                    settings: ['syncEnabled', 'openUrlsInNewTabEnabled', 'itemButtonMode', 'filterMode', 'lastViewedItemId', 'lastViewedItemOffset', 'searchQuery', 'showSearchBar']
                };

                for (const [cat, keys] of Object.entries(CATEGORIES)) {
                    (this.backupSelections as any)[cat] = keys.some(k => this.restoreData[k] !== undefined);
                }

            } catch (error: any) {
                console.error("Error parsing restoration file:", error);
                createStatusBarMessage(this, `Invalid backup file: ${error.message}`);
            } finally {
                (event.target as HTMLInputElement).value = '';
            }
        },

        confirmRestore: async function (this: AppState): Promise<void> {
            if (!this.restoreData) return;

            if (!confirm('This will overwrite selected settings and reload the application. Proceed?')) {
                return;
            }

            this.openSettings = false; // Close modal so loading screen is visible
            this.loading = true;
            this.progressMessage = 'Restoring configuration...';

            try {
                const CATEGORIES = {
                    feeds: ['rssFeeds', 'keywordBlacklist'],
                    appearance: ['theme', 'themeStyle', 'themeStyleLight', 'themeStyleDark', 'fontSize', 'feedWidth', 'animationSpeed', 'customCss', 'shadowsEnabled', 'curvesEnabled', 'imagesEnabled'],
                    history: ['read', 'starred', 'hidden'],
                    settings: ['syncEnabled', 'openUrlsInNewTabEnabled', 'itemButtonMode', 'filterMode', 'lastViewedItemId', 'lastViewedItemOffset', 'searchQuery', 'showSearchBar']
                };

                const dataToRestore: Record<string, any> = {};
                let keysCount = 0;
                for (const [category, enabled] of Object.entries(this.backupSelections)) {
                    if (enabled) {
                        const keys = CATEGORIES[category as keyof typeof CATEGORIES];
                        keys.forEach(key => {
                            if (this.restoreData[key] !== undefined) {
                                let val = this.restoreData[key];
                                // Normalize legacy theme values
                                if (key === 'themeStyle' && val === 'original') {
                                    val = this.restoreData.theme === 'light' ? 'originalLight' : 'originalDark';
                                }
                                if (key === 'themeStyleLight' && val === 'original') val = 'originalLight';
                                if (key === 'themeStyleDark' && val === 'original') val = 'originalDark';
                                
                                dataToRestore[key] = val;
                                keysCount++;
                            }
                        });
                    }
                }

                // Always enable sync after restore
                dataToRestore['syncEnabled'] = true;

                if (keysCount === 0) {
                    createStatusBarMessage(this, 'No data selected for restoration.');
                    this.loading = false;
                    return;
                }

                console.log(`[Restore] Uploading ${keysCount} keys to cloud...`);
                const token = await getAuthToken();
                const response = await fetch(`${API_BASE_URL}/api/admin/archive-import`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify(dataToRestore)
                });

                if (!response.ok) {
                    let errorMsg = 'Failed to restore backend data.';
                    try {
                        const errorData = await response.json();
                        errorMsg = errorData.error || errorData.message || errorMsg;
                    } catch (e) {
                        const text = await response.text();
                        errorMsg = `Server error (${response.status}): ${text.substring(0, 100)}`;
                    }
                    throw new Error(errorMsg);
                }

                const importResult = await response.json();
                console.log('[Restore] Import result:', importResult);

                if (importResult.failed > 0) {
                    createStatusBarMessage(this, `Warning: ${importResult.failed} items failed to restore.`);
                }

                this.progressMessage = 'Cloud restore successful. Syncing local device...';
                
                // Force a full pull to ensure local DB matches the restored server state
                // We await this to ensure IndexedDB is populated before reload
                await pullUserState(true, [], this);

                createStatusBarMessage(this, 'Restoration complete! Reloading...');
                
                // Allow some time for state to settle and user to read message
                await new Promise(resolve => setTimeout(resolve, 1500));
                window.location.reload();

            } catch (error: any) {
                console.error("Error during restoration:", error);
                createStatusBarMessage(this, `Restoration failed: ${error.message}`);
                this.loading = false;
            }
        },
        // --- Private Helper Methods ---
                                        _loadInitialState: async function (this: AppState): Promise<void> {
                                            try {
                                                const [syncEnabled, imagesEnabled, itemButtonMode, urlsNewTab, filterModeResult, themeState, curvesState, animSpeedRes, lastFeedSyncRes, fontTitleRes, fontBodyRes] = await Promise.all([
                                                    loadSimpleState('syncEnabled'),
                                                    loadSimpleState('imagesEnabled'),
                                                    loadSimpleState('itemButtonMode'),
                                                    loadSimpleState('openUrlsInNewTabEnabled'),
                                                    loadFilterMode(), // loadFilterMode directly returns string, not object with value
                                                    loadSimpleState('theme'),
                                                    loadSimpleState('curvesEnabled'),
                                                    loadSimpleState('animationSpeed'),
                                                    loadSimpleState('lastFeedSync'),
                                                    loadSimpleState('fontTitle'),
                                                    loadSimpleState('fontBody')
                                                ]);
                                                                
                                                this.syncEnabled = syncEnabled.value ?? true;
                                                this.imagesEnabled = imagesEnabled.value ?? true;
                                                this.itemButtonMode = itemButtonMode.value ?? 'play';
                                                this.openUrlsInNewTabEnabled = urlsNewTab.value ?? true;
                                                this.curvesEnabled = curvesState.value ?? true;
                                                this.animationSpeed = animSpeedRes.value ?? 100;                                        this.lastFeedSync = lastFeedSyncRes.value ?? 0;
                                        this.fontTitle = fontTitleRes.value ?? "'Playfair Display', serif";
                                        this.fontBody = fontBodyRes.value ?? "inherit";
                                        this.filterMode = filterModeResult;                
                const newTheme = (themeState.value === 'light' || themeState.value === 'dark') ? themeState.value : 'dark';
                                                if (this.theme !== newTheme) {
                                                    this.theme = newTheme;
                                                    localStorage.setItem('theme', this.theme);
                                                }
                                                
                                                this.isOnline = isOnline();
                                                
                                                const [rssFeeds, keywordBlacklist, themeStyleLightRes, themeStyleDarkRes] = await Promise.all([
                                                    loadSimpleState('rssFeeds'),
                                                    loadSimpleState('keywordBlacklist'),
                                                    loadSimpleState('themeStyleLight'),
                                                    loadSimpleState('themeStyleDark')
                                                ]);
                                
                                                const newLightStyle = typeof themeStyleLightRes.value === 'string' ? themeStyleLightRes.value : 'originalLight';
                                                const newDarkStyle = typeof themeStyleDarkRes.value === 'string' ? themeStyleDarkRes.value : 'originalDark';
                                                
                                                // Normalize legacy "original" value from old backups
                                                this.themeStyleLight = newLightStyle === 'original' ? 'originalLight' : newLightStyle;
                                                this.themeStyleDark = newDarkStyle === 'original' ? 'originalDark' : newDarkStyle;
                                                
                                                localStorage.setItem('themeStyleLight', this.themeStyleLight);
                                                localStorage.setItem('themeStyleDark', this.themeStyleDark);
                                
                                                const newStyle = this.theme === 'light' ? this.themeStyleLight : this.themeStyleDark;
                                                if (this.themeStyle !== newStyle) {
                                                    this.themeStyle = newStyle;
                                                    this.applyThemeStyle();
                                                }
                                
                                                this.rssFeedsInput = parseRssFeedsConfig(rssFeeds.value).join('\n');                this.keywordBlacklistInput = Array.isArray(keywordBlacklist.value) 
                    ? keywordBlacklist.value.join('\n') 
                    : '';
                
                await this.loadCustomCss();
                await this.loadFontSize();
                await this.loadFeedWidth();
                this.applyAnimationSpeed();
                this.applyThemeStyle();
                this.applyFonts();

                this._initialRssFeedsInput = this.rssFeedsInput;
                this._initialKeywordBlacklistInput = this.keywordBlacklistInput;

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
        
        _loadAndManageAllData: async function(this: AppState, skipLoad: boolean = false): Promise<void> {
            console.log('_loadAndManageAllData: START');
            if (!skipLoad) {
                this.progressMessage = 'Loading saved feed items...';
                await this.loadFeedItemsFromDB();
            }
            console.log(`_loadAndManageAllData: After loadFeedItemsFromDB. Entries: ${this.entries.length}`);

            this.progressMessage = 'Loading user state from storage...';
            // Also reload metadata into Alpine state so settings UI is updated after sync
            const [starredRes, shuffledRes, currentDeckRes, shuffleState, rssFeedsRes, blacklistRes] = await Promise.all([
                loadArrayState('starred'),
                loadArrayState('shuffledOutGuids'),
                loadCurrentDeck(),
                loadShuffleState(),
                loadSimpleState('rssFeeds'),
                loadSimpleState('keywordBlacklist')
            ]);

            console.log('_loadAndManageAllData: Loaded starred state:', starredRes.value);
            this.starred = Array.isArray(starredRes.value) ? starredRes.value : [];
            this.shuffledOutGuids = Array.isArray(shuffledRes.value) ? shuffledRes.value : [];
            this.currentDeckGuids = Array.isArray(currentDeckRes) ? currentDeckRes : [];
            console.log('_loadAndManageAllData: Loaded currentDeckGuids:', this.currentDeckGuids.slice(0, 3), typeof this.currentDeckGuids[0]);

            this.shuffleCount = shuffleState.shuffleCount;
            this.lastShuffleResetDate = shuffleState.lastShuffleResetDate;
            
            // Update UI strings for settings
            const { parseRssFeedsConfig } = await import('./js/helpers/dataUtils.ts');
            this.rssFeedsInput = parseRssFeedsConfig(rssFeedsRes.value).join('\n');
            this.keywordBlacklistInput = Array.isArray(blacklistRes.value) ? blacklistRes.value.join('\n') : '';
            this._initialRssFeedsInput = this.rssFeedsInput;
            this._initialKeywordBlacklistInput = this.keywordBlacklistInput;

            this.progressMessage = 'Optimizing local storage...';
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
                    // Push state to history to enable browser back button support
                    if (window.location.hash !== '#settings') {
                        window.history.pushState({ modal: 'settings' }, '', '#settings');
                    }

                    this.showUndo = false;
                    // Default backup selections to all
                    this.backupSelections = {
                        feeds: true,
                        appearance: true,
                        history: true,
                        settings: true
                    };
                    this.showRestorePreview = false;
                    this.restoreData = null;

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
                    
                    // Sync initial values so dirty check works correctly
                    this._initialRssFeedsInput = this.rssFeedsInput;
                    this._initialKeywordBlacklistInput = this.keywordBlacklistInput;

                    await saveCurrentScrollPosition();
                } else {
                    // Remove hash if it exists when closing via UI
                    if (window.location.hash === '#settings') {
                        window.history.back();
                    }
                    document.body.classList.remove('no-scroll');
                    document.body.style.overflow = '';
                    await saveCurrentScrollPosition();
                }
            });

            this.$watch('fullscreenImage', (img: string | null) => {
                if (img) {
                    if (window.location.hash !== '#image') {
                        window.history.pushState({ modal: 'image' }, '', '#image');
                    }
                } else if (window.location.hash === '#image') {
                    window.history.back();
                }
            });

            // Handle browser back button via popstate
            window.addEventListener('popstate', (event) => {
                if (this.openSettings && window.location.hash !== '#settings') {
                    this.openSettings = false;
                }
                if (this.openShortcuts && window.location.hash !== '#shortcuts') {
                    this.openShortcuts = false;
                }
                if (this.fullscreenImage && window.location.hash !== '#image') {
                    this.fullscreenImage = null;
                }
            });

            this.$watch("openShortcuts", async (isOpen: boolean) => {
                const isMobile = window.innerWidth < 1024;
                if (isOpen) {
                    if (window.location.hash !== '#shortcuts') {
                        window.history.pushState({ modal: 'shortcuts' }, '', '#shortcuts');
                    }
                    if (!isMobile) document.body.classList.add('no-scroll');
                    await saveCurrentScrollPosition();
                } else {
                    if (window.location.hash === '#shortcuts') {
                        window.history.back();
                    }
                    document.body.classList.remove('no-scroll');
                    document.body.style.overflow = '';
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
                    const result = await manageDailyDeck(
                        Array.from(this.entries), this.read, this.starred, this.shuffledOutGuids,
                        this.shuffleCount, this.filterMode, this.lastShuffleResetDate
                    );
                    this.deck = result.deck;
                    this.currentDeckGuids = result.currentDeckGuids;
                    this.shuffleCount = result.shuffleCount;
                    this.lastShuffleResetDate = result.lastShuffleResetDate;
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

            this.$watch('isOnline', (online: boolean) => {
                document.documentElement.style.setProperty('--offline-padding', online ? '0' : '30px');
            });
            this.$watch('fontTitle', () => this.applyFonts());
            this.$watch('fontBody', () => this.applyFonts());
            // Apply initial state
            document.documentElement.style.setProperty('--offline-padding', this.isOnline ? '0' : '30px');
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

            // Re-verify connectivity when returning to the app
            window.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    const online = isOnline();
                    if (this.isOnline !== online) {
                        console.log(`[Connectivity] Visibility change detected. Updating status: ${online ? 'ONLINE' : 'OFFLINE'}`);
                        this.isOnline = online;
                        this.updateSyncStatusMessage();
                    }
                    
                    if (this.selectedGuid) {
                        console.log('[Visibility] App returned to foreground. Redrawing selection animation.');
                        const currentGuid = this.selectedGuid;
                        this.selectedGuid = null;
                        this.$nextTick(() => {
                            this.selectedGuid = currentGuid;
                        });
                    }
                }
            });

            // Periodic heartbeat to prevent getting stuck in a stale state
            setInterval(() => {
                const online = isOnline();
                if (this.isOnline !== online) {
                    console.log(`[Connectivity] Heartbeat status change: ${online ? 'ONLINE' : 'OFFLINE'}`);
                    this.isOnline = online;
                    this.updateSyncStatusMessage();
                }
            }, 30000);
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
                        if (!syncSuccess) {
                            createStatusBarMessage(this, 'Sync finished with issues.');
                        }
                        
                        // After sync, pre-generate decks for next shuffle
                        await this.pregenerateDecks();
                    } catch (error) {
                    console.error('Periodic sync failed:', error);
                    createStatusBarMessage(this, 'Sync failed!');
                }
            }, SYNC_INTERVAL_MS);
        },
                _startWorkerFeedSync: function (this: AppState): void {
                    // Periodically trigger worker to fetch and process RSS feeds (every 10 minutes)
                    setInterval(async () => {
                if (!this.isOnline || !this.syncEnabled) return;
                console.log('[Worker Sync] Triggering background feed processing...');
                try {
                     
                    const token = await getAuthToken();
                    if (!token) return;

                    fetch(`${API_BASE_URL}/api/refresh`, { 
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                        .then(r => r.json())
                        .then(d => console.log('[Worker Sync] Background sync complete:', d))
                        .catch(e => console.error('[Worker Sync] Background sync failed:', e));
                } catch (err) {
                    console.error('[Worker Sync] Periodic setup failed:', err);
                }
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
                
                // Add click listener to the link itself to implement the >90% coverage check
                link.addEventListener('click', (e: MouseEvent) => {
                    // Find the parent item element
                    const item = (e.target as HTMLElement).closest('.item') as HTMLElement;
                    if (!item) return;
                    
                    const guid = item.dataset.guid;
                    if (!guid) return;

                    // If already selected, allow normal link behavior
                    if (this.selectedGuid === guid) return;

                    // Check screen coverage
                    const rect = item.getBoundingClientRect();
                    const viewHeight = window.innerHeight;
                    const visibleHeight = Math.min(rect.bottom, viewHeight) - Math.max(rect.top, 0);
                    const coverage = visibleHeight / viewHeight;

                    console.log(`[LinkClick] Item coverage: ${(coverage * 100).toFixed(1)}%`);

                    if (coverage > 0.9) {
                        // Covered >90%, allow instant follow. 
                        // We also select it silently for consistency but don't prevent the click.
                        this.selectedGuid = guid;
                        console.log(`[LinkClick] High coverage (${(coverage * 100).toFixed(1)}%), skipping double-click.`);
                    } else {
                        // Low coverage, require selection first
                        e.preventDefault();
                        e.stopPropagation();
                        console.log(`[LinkClick] Low coverage (${(coverage * 100).toFixed(1)}%), selecting item first.`);
                        this.selectItem(guid);
                    }
                });
            });
        },

        handleEntryImages: function(this: AppState, element: Element): void {
            if (!element) return;
            // Find all images in this element (e.g. in the description HTML)
            element.querySelectorAll('img').forEach(img => {
                this.observeImage(img as HTMLImageElement);
            });
        },

        toggleSearch: function(this: AppState): void {
            toggleSearch(this);
        },

        loadSvg: async function(this: AppState, element: HTMLElement, filename: string): Promise<void> {
            try {
                const response = await fetch(`/images/icons/${filename}`);
                if (response.ok) {
                    const svgText = await response.text();
                    element.innerHTML = svgText;
                    
                    // If it's a direct SVG injection, ensure classes are preserved if needed
                    const svg = element.querySelector('svg');
                    if (svg) {
                        // Inherit dimensions 
                        svg.setAttribute('width', '100%');
                        svg.setAttribute('height', '100%');
                    }
                }
            } catch (e) {
                console.error(`Failed to load SVG: ${filename}`, e);
            }
        },

        discoverFeed: async function(this: AppState): Promise<void> {
            await discoverFeed(this);
        },

        preloadThemes: function(this: AppState): void {
            console.log('[Theme] Preloading all theme styles into browser cache...');
            const themes = [
                'sepia', 'solarized-light', 'github-light', 'atom-one-light', 'gruvbox-light', 
                'catppuccin-latte', 'rose-pine-dawn', 'paper', 'morning', 'midnight', 
                'nord', 'dracula', 'monokai', 'gruvbox-dark', 'catppuccin-mocha', 
                'tokyo-night', 'synthwave', 'material-dark'
            ];
            
            // To truly pre-cache in a Vite environment where CSS is bundled, 
            // we can't easily fetch individual files because they don't exist as such.
            // However, we can "warm up" the styles by temporarily applying them 
            // to a hidden element, which forces the browser to parse and ready them.
            
            const staging = document.createElement('div');
            staging.style.display = 'none';
            staging.id = 'theme-preloader';
            document.body.appendChild(staging);

            themes.forEach(t => {
                const probe = document.createElement('div');
                probe.className = `theme-${t}`;
                staging.appendChild(probe);
                // Trigger a layout/style calculation
                window.getComputedStyle(probe).getPropertyValue('--bg');
            });

            // Clean up after a delay
            setTimeout(() => {
                document.body.removeChild(staging);
                console.log('[Theme] Preloading completed.');
            }, 2000);
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