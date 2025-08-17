/**
 * @filepath: src/main.js
 * --- DEBUGGING VERSION ---
 * This version includes console.log checkpoints to identify where the app is hanging.
 */

// --- Simple IndexedDB Promised-based Wrapper ---
function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('NotTheNewsDB', 25);
        request.onerror = (event) => {
            console.error("[DB] IndexedDB error:", event.target.error);
            reject("Error opening DB");
        };
        request.onsuccess = (event) => {
            // --- DEBUG --- CHECKPOINT 5 ---
            console.log('[DB] Database opened successfully.');
            resolve(event.target.result);
        };
        request.onupgradeneeded = event => {
            // --- DEBUG --- CHECKPOINT 4 ---
            console.log('[DB] onupgradeneeded event triggered. Creating object stores...');
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
    // --- DEBUG --- CHECKPOINT 3 ---
    console.log(`[DB] Attempting to get all from store: ${storeName}`);
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => {
             // --- DEBUG --- CHECKPOINT 6 ---
            console.log(`[DB] Successfully got all data from ${storeName}.`);
            resolve(request.result);
        };
        request.onerror = (event) => {
            console.error(`[DB] Error getting all from ${storeName}:`, event.target.error);
            reject("Error getting all data from DB");
        };
    });
}

async function saveToDb(storeName, data) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(data);
        request.onsuccess = () => resolve();
        request.onerror = (event) => {
             console.error(`[DB] Error saving to ${storeName}:`, event.target.error);
            reject("Error saving data to DB");
        };
    });
}


// --- Main Alpine.js Application Component ---
document.addEventListener('alpine:init', () => {
    // --- DEBUG --- CHECKPOINT 1 ---
    console.log('[App] Alpine is initialized. Defining rssApp component.');

    Alpine.data('rssApp', () => ({
        loading: true,
        progressMessage: 'Initializing...',
        openSettings: false,
        modalView: 'main',
        allEntries: [],
        currentDeckGuids: [],
        shuffledOutGuids: [],
        starred: [],
        hidden: [],
        rssFeeds: [],
        keywordBlacklist: [],
        shuffleCount: 2,
        openUrlsInNewTabEnabled: true,
        filterMode: 'unread',
        syncEnabled: true,
        imagesEnabled: true,
        theme: 'dark',
        rssFeedsInput: '',
        keywordBlacklistInput: '',
        rssSaveMessage: '',
        keywordSaveMessage: '',

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
                    return this.allEntries.filter(entry => 
                        !starredGuids.includes(entry.guid) && !hiddenGuids.includes(entry.guid)
                    );
            }
        },

        async initApp() {
            // --- DEBUG --- CHECKPOINT 2 ---
            console.log('[App] initApp() has been called.');

            try {
                await this.loadStateFromDb();
                
                // --- DEBUG --- CHECKPOINT 7 ---
                console.log('[App] State loaded from DB. Applying theme and fetching feed.');
                this.applyTheme();
                
                await this.fetchFeedItems();
                
                // --- DEBUG --- CHECKPOINT 9 ---
                console.log('[App] Feed items fetched. Finalizing initialization.');
                
                this.loading = false;
                console.log('[App] Initialization complete. Loading screen should disappear now.');
            } catch (error) {
                console.error("[App] A critical error occurred during initialization:", error);
                this.progressMessage = 'A fatal error occurred. Check the console.';
                // We keep `loading` true here to prevent showing a broken UI.
            }
        },

        async loadStateFromDb() {
            console.log('[DB] Starting loadStateFromDb().');
            const userState = await getAllFromDb('userState');
            const stateMap = userState.reduce((acc, item) => {
                acc[item.key] = item.value;
                return acc;
            }, {});

            this.currentDeckGuids = Array.isArray(stateMap.currentDeckGuids) ? stateMap.currentDeckGuids : [];
            this.shuffledOutGuids = Array.isArray(stateMap.shuffledOutGuids) ? stateMap.shuffledOutGuids : [];
            this.starred = Array.isArray(stateMap.starred) ? stateMap.starred : [];
            this.hidden = Array.isArray(stateMap.hidden) ? stateMap.hidden : [];
            this.rssFeeds = Array.isArray(stateMap.rssFeeds) ? stateMap.rssFeeds : [];
            this.keywordBlacklist = Array.isArray(stateMap.keywordBlacklist) ? stateMap.keywordBlacklist : [];
            this.shuffleCount = typeof stateMap.shuffleCount === 'number' ? stateMap.shuffleCount : 2;
            this.openUrlsInNewTabEnabled = typeof stateMap.openUrlsInNewTabEnabled === 'boolean' ? stateMap.openUrlsInNewTabEnabled : true;
            this.filterMode = typeof stateMap.filterMode === 'string' ? stateMap.filterMode : 'unread';
            this.syncEnabled = typeof stateMap.syncEnabled === 'boolean' ? stateMap.syncEnabled : true;
            this.imagesEnabled = typeof stateMap.imagesEnabled === 'boolean' ? stateMap.imagesEnabled : true;
            this.theme = stateMap.theme === 'light' || stateMap.theme === 'dark' ? stateMap.theme : 'dark';
            
            console.log(`[App] Loaded ${this.starred.length} starred, ${this.hidden.length} hidden items.`);
        },

        async fetchFeedItems() {
            // --- DEBUG --- CHECKPOINT 8 ---
            console.log('[API] Starting fetchFeedItems(). Fetching from /api/feed-items');
            this.progressMessage = 'Fetching latest feed...';
            
            const response = await fetch('/api/feed-items');
            if (!response.ok) {
                console.error(`[API] Fetch failed with status: ${response.status}`);
                throw new Error(`Failed to fetch feed: ${response.statusText}`);
            }
            this.allEntries = await response.json();
            this.progressMessage = 'Feed loaded.';
            console.log(`[API] Successfully fetched ${this.allEntries.length} feed items.`);
        },
        
        toggleHidden(guid) { /* ... no changes ... */ },
        isHidden(guid) { /* ... no changes ... */ },
        toggleStar(guid) { /* ... no changes ... */ },
        isStarred(guid) { /* ... no changes ... */ },
        toggleTheme() { /* ... no changes ... */ },

        applyTheme() {
            localStorage.setItem('theme', this.theme);
            document.documentElement.classList.remove('light', 'dark');
            document.documentElement.classList.add(this.theme);
            console.log(`[Theme] Theme applied: ${this.theme}`);
        },

        handleEntryLinks(element) { /* ... no changes ... */ },
        saveRssFeeds() { /* ... no changes ... */ },
        saveKeywordBlacklist() { /* ... no changes ... */ },
        scrollToTop() { /* ... no changes ... */ }
    }));
});