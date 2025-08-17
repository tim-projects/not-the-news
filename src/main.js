// main.js - CORRECTED VERSION

// REMOVED: CSS imports do not work here without a build tool.
// They will be moved to index.html.

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 25;
const STORES = {
    userState: 'userState',
    feedItems: 'feedItems',
    pendingOperations: 'pendingOperations'
};

// --- Helper Functions ---
const log = (level, ...args) => {
    const prefix = { app: '[App]', db: '[DB]', sync: '[Sync]', deck: '[Deck]' }[level] || `[${level}]`;
    console.log(prefix, ...args);
};

// --- Database Operations ---
let db;
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = event => {
            log('db', 'Database error:', event.target.error);
            reject(event.target.error);
        };
        request.onsuccess = event => {
            db = event.target.result;
            log('db', `Database opened successfully (version ${db.version}).`);
            resolve(db);
        };
        request.onupgradeneeded = event => {
            log('db', 'Database upgrade needed.');
            db = event.target.result;
            if (!db.objectStoreNames.contains(STORES.userState)) {
                db.createObjectStore(STORES.userState, { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains(STORES.feedItems)) {
                db.createObjectStore(STORES.feedItems, { keyPath: 'guid' });
            }
            if (!db.objectStoreNames.contains(STORES.pendingOperations)) {
                db.createObjectStore(STORES.pendingOperations, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

async function dbGet(storeName, key) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ? request.result.value : undefined);
        request.onerror = () => reject(request.error);
    });
}

async function dbSet(storeName, key, value) {
    if (!db) await initDB();
    const storableValue = JSON.parse(JSON.stringify(value));
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put({ key, value: storableValue });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function dbGetAll(storeName) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// --- UI Status Message ---
let statusTimeoutId = null;
function showStatusMessage(message, duration = 3000) {
    const container = document.getElementById('status-message-container');
    if (!container) return;
    container.textContent = message;
    container.classList.add('visible');
    if (statusTimeoutId) clearTimeout(statusTimeoutId);
    statusTimeoutId = setTimeout(() => {
        container.classList.remove('visible');
    }, duration);
}

// --- Main Alpine.js Application ---
document.addEventListener('alpine:init', () => {
    Alpine.data('rssApp', () => ({
        // --- Core State ---
        loading: true,
        progressMessage: 'Initializing...',
        allItems: {},
        currentDeckGuids: [],
        openSettings: false,
        modalView: 'main',

        // --- User State (Initialized with safe defaults) ---
        starred: [], // Will hold OBJECTS: { guid, starredAt }
        hidden: [],  // Will hold OBJECTS: { guid, hiddenAt }
        shuffleCount: 2,
        lastShuffleResetDate: null,
        shuffledOutGuids: [],
        filterMode: 'unread',
        syncEnabled: true,
        imagesEnabled: true,
        openUrlsInNewTabEnabled: true,
        theme: 'dark',
        rssFeedsInput: '',
        keywordBlacklistInput: '',

        // --- Computed Properties ---
        get filteredEntries() {
            // CHANGED: Logic now correctly maps over arrays of objects
            const starredGuids = this.starred.map(item => item.guid);
            const hiddenGuids = this.hidden.map(item => item.guid);

            switch (this.filterMode) {
                case 'starred':
                    return starredGuids
                        .map(guid => this.allItems[guid])
                        .filter(Boolean)
                        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
                case 'hidden':
                     return hiddenGuids
                        .map(guid => this.allItems[guid])
                        .filter(Boolean)
                        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
                case 'all':
                     return this.currentDeckGuids
                        .map(guid => this.allItems[guid])
                        .filter(Boolean);
                case 'unread':
                default:
                    return this.currentDeckGuids
                        .filter(guid => !hiddenGuids.includes(guid))
                        .map(guid => this.allItems[guid])
                        .filter(Boolean);
            }
        },

        // --- Methods ---
        async initApp() {
            log('app', 'Initialization started.');
            this.progressMessage = 'Opening local database...';
            await initDB();
            this.progressMessage = 'Loading user settings...';
            await this.loadAllUserState();
            this.progressMessage = 'Applying theme...';
            this.applyTheme();
            this.progressMessage = 'Synchronizing with server...';
            await this.syncFeed();
            this.progressMessage = 'Building your deck...';
            await this.manageDeck();
            this.loading = false;
            log('app', 'Initialization complete.');
            setInterval(() => this.backgroundSync(), 5 * 60 * 1000);
        },

        async loadAllUserState() {
            log('db', 'Loading all user state from IndexedDB.');
            const allState = await dbGetAll(STORES.userState);
            const stateMap = allState.reduce((acc, { key, value }) => { acc[key] = value; return acc; }, {});

            this.starred = Array.isArray(stateMap.starred) ? stateMap.starred : [];
            this.hidden = Array.isArray(stateMap.hidden) ? stateMap.hidden : [];
            this.currentDeckGuids = Array.isArray(stateMap.currentDeckGuids) ? stateMap.currentDeckGuids : [];
            this.shuffledOutGuids = Array.isArray(stateMap.shuffledOutGuids) ? stateMap.shuffledOutGuids : [];
            this.shuffleCount = typeof stateMap.shuffleCount === 'number' ? stateMap.shuffleCount : 2;
            this.lastShuffleResetDate = stateMap.lastShuffleResetDate || null;
            this.filterMode = stateMap.filterMode || 'unread';
            this.syncEnabled = typeof stateMap.syncEnabled === 'boolean' ? stateMap.syncEnabled : true;
            this.imagesEnabled = typeof stateMap.imagesEnabled === 'boolean' ? stateMap.imagesEnabled : true;
            this.openUrlsInNewTabEnabled = typeof stateMap.openUrlsInNewTabEnabled === 'boolean' ? stateMap.openUrlsInNewTabEnabled : true;
            this.theme = stateMap.theme || 'dark';
            
            log('app', `Loaded ${this.starred.length} starred, ${this.hidden.length} hidden items.`);
        },

        applyTheme() {
            localStorage.setItem('theme', this.theme);
            document.documentElement.classList.remove('light', 'dark');
            document.documentElement.classList.add(this.theme);
        },

        async toggleTheme() {
            this.theme = this.theme === 'light' ? 'dark' : 'light';
            this.applyTheme();
            await dbSet(STORES.userState, 'theme', this.theme);
        },

        // --- Star/Hide Actions ---
        async toggleStar(guid) {
            // CHANGED: Logic now correctly finds and manages objects, not strings.
            const index = this.starred.findIndex(item => item.guid === guid);
            if (index > -1) {
                this.starred.splice(index, 1);
                this.queueSync('starDelta', { itemGuid: guid, action: 'remove' });
                showStatusMessage('Item Unstarred', 2000);
            } else {
                this.starred.push({ guid, starredAt: new Date().toISOString() });
                this.queueSync('starDelta', { itemGuid: guid, action: 'add' });
                showStatusMessage('Item Starred', 2000);
            }
            await dbSet(STORES.userState, 'starred', this.starred);
        },

        async toggleHidden(guid) {
            // CHANGED: Logic now correctly finds and manages objects, not strings.
            const index = this.hidden.findIndex(item => item.guid === guid);
            if (index > -1) {
                this.hidden.splice(index, 1);
                this.queueSync('hiddenDelta', { itemGuid: guid, action: 'remove' });
            } else {
                this.hidden.push({ guid, hiddenAt: new Date().toISOString() });
                this.queueSync('hiddenDelta', { itemGuid: guid, action: 'add' });
            }
            await dbSet(STORES.userState, 'hidden', this.hidden);

            const deckIndex = this.currentDeckGuids.indexOf(guid);
            if (deckIndex > -1) {
                this.currentDeckGuids.splice(deckIndex, 1);
                await dbSet(STORES.userState, 'currentDeckGuids', this.currentDeckGuids);
            }
        },

        isStarred(guid) {
            // CHANGED: Use .some() to check for an object with a matching guid.
            return this.starred.some(item => item.guid === guid);
        },

        isHidden(guid) {
            // CHANGED: Use .some() to check for an object with a matching guid.
            return this.hidden.some(item => item.guid === guid);
        },

        // --- Deck Management & Other methods are unchanged ---
        async manageDeck() {
            log('deck', 'Managing deck...');
            const allFeedItems = await dbGetAll(STORES.feedItems);
            this.allItems = allFeedItems.reduce((acc, item) => { acc[item.guid] = item; return acc; }, {});

            const hiddenGuids = this.hidden.map(item => item.guid);
            const availableGuids = Object.keys(this.allItems)
                .filter(guid => !hiddenGuids.includes(guid) && !this.shuffledOutGuids.includes(guid));

            const validDeckItems = this.currentDeckGuids.filter(guid => !hiddenGuids.includes(guid));

            if (validDeckItems.length < 10 && availableGuids.length > 0) {
                log('deck', 'Current deck is small, creating a new one.');
                this.currentDeckGuids = this.getRandomGuids(availableGuids, 10);
            } else {
                log('deck', `Retaining existing deck of ${validDeckItems.length} items.`);
                this.currentDeckGuids = validDeckItems;
            }
             await dbSet(STORES.userState, 'currentDeckGuids', this.currentDeckGuids);
        },
        async nextDeck() { /* ... unchanged ... */ },
        async processShuffle() { /* ... unchanged ... */ },
        getRandomGuids(guidArray, count) { /* ... unchanged ... */ },
        async backgroundSync() { /* ... unchanged ... */ },
        async syncFeed() { /* ... unchanged ... */ },
        async queueSync(type, data) { /* ... unchanged ... */ },
        async syncUserState() { /* ... unchanged ... */ },
        handleEntryLinks(element) { /* ... unchanged ... */ },
        scrollToTop() { /* ... unchanged ... */ }
    }));
});

// These are not needed with a CDN script tag, but don't hurt.
window.Alpine = Alpine;
Alpine.start();