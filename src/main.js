// @filepath: src/main.js (or wherever your main entry point is)

import Alpine from 'alpinejs';
// CSS imports remain the same
import './css/variables.css';
import './css/buttons.css';
import './css/forms.css';
import './css/layout.css';
import './css/content.css';
import './css/modal.css';
import './css/status.css';

// --- FIX: Import the entire modular data and helper layer ---
import {
    initDb,
    performFeedSync,
    pullUserState,
    processPendingOperations,
    loadSimpleState,
    loadArrayState,
    saveSimpleState,
    updateArrayState,
    getAllFeedItems,
    queueAndAttemptSyncOperation // Ensure this is imported for user actions
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


// --- Main Alpine.js Application ---
document.addEventListener('alpine:init', () => {
    Alpine.data('rssApp', () => ({
        // --- State Properties (from the advanced app.js) ---
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

        // --- Core Methods ---
        async initApp() {
            try {
                this.progressMessage = 'Connecting to database...';
                // FIX: Use the modular initDb
                await initDb(); 
                
                this.progressMessage = 'Loading settings...';
                // FIX: Use the advanced initial state loader
                await this._loadInitialState();
                
                if (this.isOnline) {
                    this.progressMessage = 'Performing initial sync...';
                    // These now correctly call the modular, fixed sync engine
                    await pullUserState();
                    await performFeedSync(this);
                }
                
                this.progressMessage = 'Loading all data...';
                // This function now correctly loads from the granular stores
                await this._loadAndManageAllData();

                this.progressMessage = 'Applying user preferences...';
                initTheme(this);
                // ... all other UI initializers from app.js ...

                this.progressMessage = 'Setting up app watchers...';
                this._setupWatchers(); // Restore advanced watchers
                this._setupEventListeners(); // Restore advanced event listeners

                this.progressMessage = '';
                this.loading = false; // This line will now be reached
                
            } catch (error) {
                console.error("Initialization failed:", error);
                this.errorMessage = `Could not load app: ${error.message}`;
                this.progressMessage = `Error: ${error.message}`;
                // Keep loading screen on critical error
            }
        },
        
        // --- Getters (from the advanced app.js) ---
        get filteredEntries() {
            let filtered = [];
            const hiddenSet = new Set(this.hidden.map(h => h.guid));
            const starredSet = new Set(this.starred.map(s => s.guid));

            switch (this.filterMode) {
                case "unread":
                    const deckItemObjects = this.currentDeckGuids
                        .map(guid => this.feedItems[guid])
                        .filter(Boolean); // Ensure item exists
                    filtered = deckItemObjects.filter(item => !hiddenSet.has(item.guid));
                    break;
                case "starred":
                    filtered = Object.values(this.feedItems).filter(item => starredSet.has(item.guid));
                    break;
                case "hidden":
                    filtered = Object.values(this.feedItems).filter(item => hiddenSet.has(item.guid));
                    break;
                case "all":
                    filtered = Object.values(this.feedItems);
                    break;
            }
            
            // Map to final display format AFTER filtering
            return mapRawItems(filtered, formatDate).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
        },

        // --- Action Methods ---
        isStarred(guid) {
            return this.starred.some(e => e.guid === guid);
        },
        isHidden(guid) {
            return this.hidden.some(e => e.guid === guid);
        },
        async toggleStar(guid) {
            // FIX: Use the advanced toggle function that handles UI, DB, and Sync Queue
            await toggleItemStateAndSync(this, guid, 'starred');
            await this._loadAndManageAllData(); // Reload data to reflect change
        },
        async toggleHidden(guid) {
            await toggleItemStateAndSync(this, guid, 'hidden');
            await this._loadAndManageAllData();
        },

        // --- Private Helper Methods (from the advanced app.js) ---
        async _loadInitialState() {
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
        },
        
        async _loadAndManageAllData() {
            // This function now correctly uses the modular data functions against the correct DB schema
            const [rawItemsFromDb, starredState, hiddenState, deckGuids, shuffleState] = await Promise.all([
                getAllFeedItems(),
                loadArrayState('starred'),
                loadAndPruneHiddenItems(), // Use the pruning version
                loadCurrentDeck(),
                loadShuffleState()
            ]);

            this.feedItems = rawItemsFromDb.reduce((acc, item) => {
                if (item && item.guid) acc[item.guid] = item;
                return acc;
            }, {});
            
            this.starred = starredState.value || [];
            this.hidden = hiddenState || [];
            this.currentDeckGuids = deckGuids || [];
            this.shuffleCount = shuffleState.shuffleCount;
            this.lastShuffleResetDate = shuffleState.lastShuffleResetDate;

            await manageDailyDeck(this);
        },

        _setupWatchers() {
            // Restores the efficient watchers from the advanced app.js
            this.$watch("openSettings", async (isOpen) => {
                if (isOpen) {
                    const [rssFeeds, keywords] = await Promise.all([
                        loadSimpleState('rssFeeds'),
                        loadSimpleState('keywordBlacklist')
                    ]);
                    this.rssFeedsInput = rssFeeds.value || '';
                    this.keywordBlacklistInput = Array.isArray(keywords.value) ? keywords.value.join('\n') : '';
                }
            });
            this.$watch('filterMode', async (newMode) => {
                await setFilterMode(newMode);
            });
        },

        _setupEventListeners() {
            // Restores the online/offline listeners
            const syncOnline = async () => {
                if (!this.syncEnabled) return;
                await processPendingOperations();
                await pullUserState();
                await performFeedSync(this);
                await this._loadAndManageAllData();
            };
            window.addEventListener('online', () => { this.isOnline = true; syncOnline(); });
            window.addEventListener('offline', () => { this.isOnline = false; });
        },
        
        // --- Stubs for other methods from simple main.js ---
        // (These can be fleshed out with the logic from app.js as needed)
        applyTheme() { initTheme(this); },
        toggleTheme() { 
            this.theme = this.theme === 'light' ? 'dark' : 'light';
            saveSimpleState('theme', this.theme);
            this.applyTheme();
        },
        async processShuffle() { 
            await processShuffle(this); 
            await this._loadAndManageAllData();
        },
        scrollToTop() { scrollToTop(); }
    }));
});

// These lines are required for the module-based setup
window.Alpine = Alpine;
Alpine.start();