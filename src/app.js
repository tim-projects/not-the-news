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
    pruneStaleRead, // This function is now a pure utility.
    loadAndPruneReadItems, // <-- NEW: Use this for startup!
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
        read: [],
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
                    this.progressMessage = 'Syncing latest content...'; // Set specific sync message
                    // Pull user state first, as feed items depend on it.
                    await pullUserState();
                    // Then sync feed items.
                    await performFeedSync(this);
                    
                    // Now that both syncs are complete, load all data into app state.
                    await this._loadAndManageAllData();
                    createStatusBarMessage(this, "Initial sync complete!", "success");
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
                createStatusBarMessage(this, `Could not load feed: ${error.message}`, 'error');
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
            const readSet = new Set(this.read.map(h => h.guid));
            const starredSet = new Set(this.starred.map(s => s.guid));
            const seenGuidsForDeck = new Set();

            let foundCount = 0;
            let missingCount = 0;

            for (const guid of guidsToDisplay) {
                if (typeof guid !== 'string' || !guid) continue;
                
                const item = this.feedItems[guid];
                if (item && item.guid && !seenGuidsForDeck.has(item.guid)) {
                    const mappedItem = mapRawItem(item, formatDate);
                    
                    mappedItem.isRead = readSet.has(mappedItem.guid);
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
            const currentHash = `${this.entries.length}-${this.filterMode}-${this.read.length}-${this.starred.length}-${this.imagesEnabled}-${this.currentDeckGuids.length}-${this.deck.length}-${this.keywordBlacklistInput}`;
            if (this.entries.length > 0 && currentHash === this._lastFilterHash && this._cachedFilteredEntries !== null) {
                return this._cachedFilteredEntries;
            }

            let filtered = [];
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
                        .sort((a, b) => new Date(readMap.get(b.guid)).getTime() - new Date(readMap.get(a.guid)).getTime());
                    break;
                case "starred":
                    filtered = this.entries.filter(e => starredMap.has(e.guid))
                        .sort((a, b) => new Date(starredMap.get(b.guid)).getTime() - new Date(starredMap.get(a.guid)).getTime());
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
        isStarred: function(guid) {
            return this.starred.some(e => e.guid === guid);
        },
        isRead: function(guid) {
            return this.read.some(e => e.guid === guid);
        },
        toggleStar: async function(guid) {
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
        },
        toggleRead: async function(guid) {
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
        },
        processShuffle: async function() {
            await processShuffle(this);
            this.updateCounts();
        },
        saveRssFeeds: async function() {
            // Parse the multi-line string into an array of strings, one URL per line
            const rssFeedsArray = this.rssFeedsInput.split(/\r?\n/).map(url => url.trim()).filter(Boolean);
            await saveSimpleState('rssFeeds', rssFeedsArray); // Send the array to the backend
            createStatusBarMessage(this, 'RSS Feeds saved!', 'success');
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
            createStatusBarMessage(this, 'Keyword Blacklist saved!', 'success');
            this.updateCounts();
        },
        updateCounts: function() {
            updateCounts(this);
        },
        scrollToTop: function() {
            scrollToTop();
        },

        // --- New Function: Reset Application Data ---
        resetApplicationData: async function() {
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
                // 1. Clear IndexedDB databases
                console.log('Clearing IndexedDB databases...');
                const dbNames = await indexedDB.databases();
                for (const dbInfo of dbNames) {
                    await new Promise((resolve, reject) => {
                        const req = indexedDB.deleteDatabase(dbInfo.name);
                        req.onsuccess = () => {
                            console.log(`IndexedDB database '${dbInfo.name}' deleted.`);
                            resolve();
                        };
                        req.onerror = (event) => {
                            console.error(`Error deleting IndexedDB database '${dbInfo.name}':`, event.target.error);
                            reject(event.target.error);
                        };
                        req.onblocked = () => {
                            // If there are open connections, onblocked will fire.
                            // User needs to close all tabs for the site.
                            alert('Please close all other tabs of this application and try again to clear the database.');
                            reject(new Error('IndexedDB deletion blocked.'));
                        };
                    });
                }

                // 2. Clear localStorage
                console.log('Clearing localStorage...');
                localStorage.clear();
                console.log('localStorage cleared.');

                // 3. Unregister Service Workers
                console.log('Unregistering service workers...');
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (const registration of registrations) {
                        await registration.unregister();
                        console.log('Service Worker unregistered:', registration.scope);
                    }
                }
                console.log('Service workers unregistered.');

                // 4. Call backend to reset server-side data
                console.log('Calling backend to reset application data...');
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
                createStatusBarMessage(this, 'Application reset complete! Reloading...', 'success');

                // 5. Reload the page to ensure a fresh start
                setTimeout(() => {
                    window.location.reload();
                }, 1000);

            } catch (error) {
                console.error("Error during application reset:", error);
                this.errorMessage = `Failed to reset application: ${error.message}`;
                createStatusBarMessage(this, `Failed to reset application: ${error.message}`, 'error');
                this.loading = false;
            }
        },

        backupConfig: async function() {
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
                a.download = `not-the-news-config-backup-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                createStatusBarMessage(this, 'Configuration backed up successfully!', 'success');
            } catch (error) {
                console.error("Error during config backup:", error);
                createStatusBarMessage(this, `Failed to backup configuration: ${error.message}`, 'error');
            } finally {
                this.progressMessage = '';
            }
        },

        restoreConfig: async function(event) {
            if (!confirm('Are you sure you want to restore configuration? This will overwrite your current settings and reload the application.')) {
                return;
            }

            const file = event.target.files[0];
            if (!file) {
                createStatusBarMessage(this, 'No file selected for restoration.', 'info');
                return;
            }

            this.loading = true;
            this.progressMessage = 'Restoring configuration...';

            try {
                const fileContent = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
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
                createStatusBarMessage(this, 'Configuration restored successfully! Reloading...', 'success');

                // Reload the page to apply new settings and re-initialize
                setTimeout(() => {
                    window.location.reload();
                }, 1000);

            } catch (error) {
                console.error("Error during config restoration:", error);
                createStatusBarMessage(this, `Failed to restore configuration: ${error.message}`, 'error');
                this.loading = false;
            } finally {
                // Clear the file input value so the same file can be selected again
                event.target.value = '';
            }
        },

        // --- Private Helper Methods ---
        _loadInitialState: async function() {
            const [syncEnabled, imagesEnabled, urlsNewTab, filterMode] = await Promise.all([
            this.syncEnabled = syncEnabled.value ?? true;
            this.imagesEnabled = imagesEnabled.value ?? true;
            this.openUrlsInNewTabEnabled = urlsNewTab.value ?? true;
            this.filterMode = filterMode;
            this.isOnline = isOnline();
        },
        
                _loadAndManageAllData: async function() {
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
            await manageDailyDeck(this);
            console.log('_loadAndManageAllData: After manageDailyDeck. Deck size:', this.deck.length);
            await this.loadAndDisplayDeck();
            console.log('_loadAndManageAllData: After loadAndDisplayDeck. Deck size:', this.deck.length);

            this.updateAllUI();
            console.log('_loadAndManageAllData: END');
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
            this.$watch('read', () => this.updateCounts());
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
                this.updateSyncStatusMessage(); // <-- FIX: Update status on online event
                if (this.syncEnabled) {
                    await processPendingOperations();
                    await backgroundSync();
                }
            });
            window.addEventListener('offline', () => {
                this.isOnline = false;
                this.updateSyncStatusMessage(); // <-- FIX: Update status on offline event
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
                if (!this.isOnline || this.openSettings || !this.syncEnabled || (now - lastActivityTimestamp) > INACTIVITY_TIMEOUT_MS) {
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