/**
 * @filepath: src/main.js
 * This file contains the core client-side logic for the Not The News app.
 * It defines the main Alpine.js component, handles state management with IndexedDB,
 * and includes the fixes to prevent crashes on initialization.
 */

// --- Simple IndexedDB Promised-based Wrapper ---
// A helper utility to make working with IndexedDB easier and cleaner.
function openDb() {
    return new Promise((resolve, reject) => {
        // Version 25 is taken from the original error log.
        const request = indexedDB.open('NotTheNewsDB', 25);
        request.onerror = () => reject("Error opening DB");
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('userState')) {
                db.createObjectStore('userState', { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains('feedItems')) {
                db.createObjectStore('feedItems', { keyPath: 'guid' });
            }
        };
    });
}

async function getAllFromDb(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject("Error getting all data from DB");
    });
}

async function saveToDb(storeName, data) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        // Using .put() will insert or update the record based on the key.
        const request = store.put(data);
        request.onsuccess = () => resolve();
        request.onerror = () => reject("Error saving data to DB");
    });
}


// --- Main Alpine.js Application Component ---
document.addEventListener('alpine:init', () => {
    Alpine.data('rssApp', () => ({
        // --- UI State Properties ---
        loading: true,
        progressMessage: 'Initializing...',
        openSettings: false,
        modalView: 'main', // Controls which view is visible in the settings modal

        // Holds all feed items fetched from the server/db
        allEntries: [],

        // ====================================================================
        // --- FIX #1: Initialize all state properties with correct types ---
        // By initializing array-based state as an empty array `[]`, we prevent
        // "is not a function" errors. The component is now always in a stable
        // state, even before data is loaded from IndexedDB.
        // This list is based on the `USER_STATE_SERVER_DEFAULTS` in `src/api.py`.
        // ====================================================================
        currentDeckGuids: [],
        shuffledOutGuids: [],
        starred: [], // Will hold objects like { guid, starredAt }
        hidden: [],  // Will hold objects like { guid, hiddenAt }
        rssFeeds: [],
        keywordBlacklist: [],
        
        // Initializing non-array types with safe defaults
        shuffleCount: 2,
        openUrlsInNewTabEnabled: true,
        filterMode: 'unread',
        syncEnabled: true,
        imagesEnabled: true,
        theme: 'dark',

        // --- Temporary state for settings modal inputs ---
        rssFeedsInput: '',
        keywordBlacklistInput: '',
        rssSaveMessage: '',
        keywordSaveMessage: '',

        // --- Getters (Computed Properties) ---
        
        /**
         * Dynamically filters the feed entries based on the current filterMode.
         * This getter is now completely safe because `this.starred` and `this.hidden`
         * are guaranteed to be arrays due to Fix #1.
         */
        get filteredEntries() {
            const starredGuids = this.starred.map(s => s.guid);
            const hiddenGuids = this.hidden.map(h => h.guid);

            switch (this.filterMode) {
                case 'starred':
                    return this.allEntries.filter(entry => starredGuids.includes(entry.guid));
                case 'hidden':
                    return this.allEntries.filter(entry => hiddenGuids.includes(entry.guid));
                case 'all':
                    return this.allEntries;
                case 'unread':
                default:
                    // 'Unread' is defined as items that are neither starred nor hidden.
                    return this.allEntries.filter(entry => 
                        !starredGuids.includes(entry.guid) && !hiddenGuids.includes(entry.guid)
                    );
            }
        },

        // --- Core Methods ---

        /**
         * The main entry point for the application, called by x-init.
         */
        async initApp() {
            console.log('[App] Initialization started.');
            await this.loadStateFromDb();
            this.applyTheme();
            await this.fetchFeedItems(); // Fetch feed items from the backend
            this.loading = false;
            console.log('[App] Initialization complete.');
        },

        /**
         * Loads all user settings from IndexedDB.
         */
        async loadStateFromDb() {
            console.log('[DB] Loading all user state from IndexedDB.');
            const userState = await getAllFromDb('userState');
            // Convert the array of {key, value} objects into a simple map for easier access.
            const stateMap = userState.reduce((acc, item) => {
                acc[item.key] = item.value;
                return acc;
            }, {});

            // =================================================================
            // --- FIX #2: Safeguard the data loading process ---
            // After fetching data from IndexedDB, we explicitly check if it's the
            // correct type. If not (e.g., an expected array is `null` or `undefined`),
            // we fall back to the safe default value we set earlier. This makes
            // the application resilient to corrupted or missing data.
            // =================================================================
            
            // Validate and assign array types
            this.currentDeckGuids = Array.isArray(stateMap.currentDeckGuids) ? stateMap.currentDeckGuids : [];
            this.shuffledOutGuids = Array.isArray(stateMap.shuffledOutGuids) ? stateMap.shuffledOutGuids : [];
            this.starred = Array.isArray(stateMap.starred) ? stateMap.starred : [];
            this.hidden = Array.isArray(stateMap.hidden) ? stateMap.hidden : [];
            this.rssFeeds = Array.isArray(stateMap.rssFeeds) ? stateMap.rssFeeds : [];
            this.keywordBlacklist = Array.isArray(stateMap.keywordBlacklist) ? stateMap.keywordBlacklist : [];

            // Validate and assign simple types, falling back to defaults if invalid
            this.shuffleCount = typeof stateMap.shuffleCount === 'number' ? stateMap.shuffleCount : 2;
            this.openUrlsInNewTabEnabled = typeof stateMap.openUrlsInNewTabEnabled === 'boolean' ? stateMap.openUrlsInNewTabEnabled : true;
            this.filterMode = typeof stateMap.filterMode === 'string' ? stateMap.filterMode : 'unread';
            this.syncEnabled = typeof stateMap.syncEnabled === 'boolean' ? stateMap.syncEnabled : true;
            this.imagesEnabled = typeof stateMap.imagesEnabled === 'boolean' ? stateMap.imagesEnabled : true;
            this.theme = stateMap.theme === 'light' || stateMap.theme === 'dark' ? stateMap.theme : 'dark';
            
            console.log(`[App] Loaded ${this.starred.length} starred, ${this.hidden.length} hidden items.`);
        },

        /**
         * Fetches feed items from the backend API.
         */
        async fetchFeedItems() {
            this.progressMessage = 'Fetching latest feed...';
            try {
                const response = await fetch('/api/feed-items');
                if (!response.ok) throw new Error('Failed to fetch feed');
                this.allEntries = await response.json();
                this.progressMessage = 'Feed loaded.';
            } catch (error) {
                console.error("Error fetching feed items:", error);
                this.progressMessage = 'Could not load feed.';
            }
        },
        
        // --- UI Interaction Methods (from index.html) ---

        processShuffle() {
            alert("Shuffle functionality not yet implemented.");
        },
        
        toggleHidden(guid) {
            const index = this.hidden.findIndex(item => item.guid === guid);
            if (index > -1) {
                this.hidden.splice(index, 1); // Un-hide
            } else {
                this.hidden.push({ guid: guid, hiddenAt: new Date().toISOString() }); // Hide
            }
            saveToDb('userState', { key: 'hidden', value: this.hidden });
        },

        isHidden(guid) {
            return this.hidden.some(item => item.guid === guid);
        },

        toggleStar(guid) {
            const index = this.starred.findIndex(item => item.guid === guid);
            if (index > -1) {
                this.starred.splice(index, 1); // Un-star
            } else {
                this.starred.push({ guid: guid, starredAt: new Date().toISOString() }); // Star
            }
            saveToDb('userState', { key: 'starred', value: this.starred });
        },

        isStarred(guid) {
            return this.starred.some(item => item.guid === guid);
        },

        toggleTheme() {
            this.theme = this.theme === 'dark' ? 'light' : 'dark';
            this.applyTheme();
            saveToDb('userState', { key: 'theme', value: this.theme });
        },

        applyTheme() {
            localStorage.setItem('theme', this.theme);
            document.documentElement.classList.remove('light', 'dark');
            document.documentElement.classList.add(this.theme);
        },

        handleEntryLinks(element) {
            if (this.openUrlsInNewTabEnabled) {
                element.querySelectorAll('a').forEach(a => a.target = '_blank');
            }
        },
        
        saveRssFeeds() {
            // In a real app, this would POST to the backend API
            this.rssSaveMessage = "Feeds saved!";
            setTimeout(() => this.rssSaveMessage = '', 3000);
        },

        saveKeywordBlacklist() {
            // In a real app, this would POST to the backend API
            this.keywordSaveMessage = "Keywords saved!";
            setTimeout(() => this.keywordSaveMessage = '', 3000);
        },

        scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }));
});