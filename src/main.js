--- START OF FILE src/main.js ---
import Alpine from 'alpinejs';
import './css/variables.css';
import './css/buttons.css';
import './css/forms.css';
import './css/layout.css';
import './css/content.css';
import './css/modal.css';
import './css/status.css'; // Import the new CSS file

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 24; // Incremented version to ensure schema updates
const STORES = {
    userState: 'userState', // Key-value store for user preferences
    feedItems: 'feedItems', // Store for individual feed articles
    pendingOperations: 'pendingOperations' // Queue for sync operations
};

// --- Helper Functions ---
const log = (level, ...args) => {
    const prefix = {
        app: '[App]',
        db: '[DB]',
        sync: '[Sync]',
        deck: '[Deck]'
    }[level] || `[${level}]`;
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
            // Clear old stores if they exist
            const existingStores = Array.from(db.objectStoreNames);
            existingStores.forEach(storeName => {
                if (!Object.values(STORES).includes(storeName)) {
                    db.deleteObjectStore(storeName);
                    log('db', `Removed old store: ${storeName}`);
                }
            });

            // Create new stores
            if (!db.objectStoreNames.contains(STORES.userState)) {
                db.createObjectStore(STORES.userState, { keyPath: 'key' });
                log('db', `Created store: ${STORES.userState}`);
            }
            if (!db.objectStoreNames.contains(STORES.feedItems)) {
                db.createObjectStore(STORES.feedItems, { keyPath: 'guid' });
                log('db', `Created store: ${STORES.feedItems}`);
            }
            if (!db.objectStoreNames.contains(STORES.pendingOperations)) {
                db.createObjectStore(STORES.pendingOperations, { keyPath: 'id', autoIncrement: true });
                log('db', `Created store: ${STORES.pendingOperations}`);
            }
        };
    });
}

// --- Generic DB Get/Set ---
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
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put({ key, value });
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
function showStatusMessage(message, duration = 3000) {
    const container = document.getElementById('sync-status-message');
    if (!container) {
        console.error("Message container not found. Cannot display status bar message.");
        return;
    }
    container.textContent = message;
    container.classList.add('visible');
    setTimeout(() => {
        container.classList.remove('visible');
    }, duration);
}


// --- Main Alpine.js Application ---
document.addEventListener('alpine:init', () => {
    Alpine.data('rssApp', () => ({
        // --- Core State ---
        loading: true,
        progressMessage: 'Initializing...',
        allItems: {}, // All feed items, keyed by guid
        currentDeckGuids: [],
        openSettings: false,
        modalView: 'main',

        // --- User State (Reactive) ---
        starred: [], // Array of guid strings
        hidden: [], // Array of guid strings
        shuffleCount: 2,
        lastShuffleResetDate: null,
        shuffledOutGuids: [],
        filterMode: 'unread',
        syncEnabled: true,
        imagesEnabled: true,
        openUrlsInNewTabEnabled: true,
        theme: 'dark',

        // --- Settings Input Models ---
        rssFeedsInput: '',
        keywordBlacklistInput: '',

        // --- Computed Properties ---
        get filteredEntries() {
            let guidsToShow = this.currentDeckGuids;

            // Apply filter based on mode
            switch (this.filterMode) {
                case 'starred':
                    return this.starred
                        .map(guid => this.allItems[guid])
                        .filter(Boolean) // Filter out items not in allItems
                        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
                case 'hidden':
                     return this.hidden
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
                        .filter(guid => !this.hidden.includes(guid))
                        .map(guid => this.allItems[guid])
                        .filter(Boolean);
            }
        },

        // --- Methods ---
        async initApp() {
            log('app', 'Initialization started.');
            this.progressMessage = 'Opening local database...';
            await initDB();

            // Load theme first for immediate visual feedback
            this.progressMessage = 'Applying theme...';
            await this.loadTheme();

            this.progressMessage = 'Loading user settings...';
            await this.loadAllUserState();

            this.progressMessage = 'Synchronizing with server...';
            await this.syncFeed(); // Full sync on startup

            this.progressMessage = 'Building your deck...';
            await this.manageDeck();

            this.loading = false;
            log('app', 'Initialization complete.');

            // Setup periodic sync
            setInterval(() => this.backgroundSync(), 5 * 60 * 1000); // Sync every 5 minutes
        },

        // --- State Management ---
        async loadAllUserState() {
            log('db', 'Loading all user state from IndexedDB.');
            const allState = await dbGetAll(STORES.userState);
            const stateMap = allState.reduce((acc, { key, value }) => {
                acc[key] = value;
                return acc;
            }, {});

            this.starred = stateMap.starred || [];
            this.hidden = stateMap.hidden || [];
            this.shuffleCount = stateMap.shuffleCount !== undefined ? stateMap.shuffleCount : 2;
            this.lastShuffleResetDate = stateMap.lastShuffleResetDate || null;
            this.shuffledOutGuids = stateMap.shuffledOutGuids || [];
            this.filterMode = stateMap.filterMode || 'unread';
            this.syncEnabled = stateMap.syncEnabled !== undefined ? stateMap.syncEnabled : true;
            this.imagesEnabled = stateMap.imagesEnabled !== undefined ? stateMap.imagesEnabled : true;
            this.openUrlsInNewTabEnabled = stateMap.openUrlsInNewTabEnabled !== undefined ? stateMap.openUrlsInNewTabEnabled : true;
            this.currentDeckGuids = stateMap.currentDeckGuids || [];

            log('app', `Loaded ${this.starred.length} starred, ${this.hidden.length} hidden items.`);
        },

        // --- Theme ---
        async loadTheme() {
            const storedTheme = await dbGet(STORES.userState, 'theme') || 'dark';
            this.theme = storedTheme;
            this.applyTheme();

            // Listener for settings toggle
            const themeToggle = document.getElementById('theme-toggle');
            if (themeToggle) {
                themeToggle.addEventListener('change', () => {
                    this.theme = this.theme === 'light' ? 'dark' : 'light';
                    this.applyTheme();
                    dbSet(STORES.userState, 'theme', this.theme);
                });
            }
        },

        applyTheme() {
            if (this.theme === 'dark') {
                document.documentElement.classList.add('dark');
                document.documentElement.classList.remove('light');
            } else {
                document.documentElement.classList.add('light');
                document.documentElement.classList.remove('dark');
            }
            document.getElementById('theme-toggle').checked = (this.theme === 'dark');
        },


        // --- Star/Hide Actions ---
        async toggleStar(guid) {
            const index = this.starred.indexOf(guid);
            const action = index > -1 ? 'remove' : 'add';

            if (action === 'add') {
                this.starred.push(guid);
            } else {
                this.starred.splice(index, 1);
            }
            await dbSet(STORES.userState, 'starred', this.starred);
            this.queueSync('starDelta', { itemGuid: guid, action });
            showStatusMessage(action === 'add' ? 'Item Starred' : 'Item Unstarred', 2000);
        },

        async toggleHidden(guid) {
            const index = this.hidden.indexOf(guid);
            const action = index > -1 ? 'remove' : 'add';

            if (action === 'add') {
                this.hidden.push(guid);
            } else {
                this.hidden.splice(index, 1);
            }
            await dbSet(STORES.userState, 'hidden', this.hidden);
            this.queueSync('hiddenDelta', { itemGuid: guid, action });

             // Check if the deck is now empty and load the next one
            if (this.filterMode === 'unread' && this.filteredEntries.length === 0) {
                showStatusMessage('Deck cleared! Loading next deck...', 3000);
                this.nextDeck();
            }
        },

        isStarred(guid) {
            return this.starred.includes(guid);
        },

        isHidden(guid) {
            return this.hidden.includes(guid);
        },

        // --- Deck Management ---
        async manageDeck() {
            log('deck', 'Managing deck...');
            const allFeedItems = await dbGetAll(STORES.feedItems);
            this.allItems = allFeedItems.reduce((acc, item) => {
                acc[item.guid] = item;
                return acc;
            }, {});

            const availableGuids = Object.keys(this.allItems)
                .filter(guid => !this.hidden.includes(guid) && !this.shuffledOutGuids.includes(guid));

            if (this.currentDeckGuids.length < 10 && availableGuids.length > 0) {
                log('deck', 'Current deck is small, creating a new one.');
                this.currentDeckGuids = this.getRandomGuids(availableGuids, 10);
                await dbSet(STORES.userState, 'currentDeckGuids', this.currentDeckGuids);
            } else if (availableGuids.length === 0) {
                log('deck', 'No available items to create a deck.');
                this.currentDeckGuids = [];
                 await dbSet(STORES.userState, 'currentDeckGuids', this.currentDeckGuids);
            } else {
                log('deck', `Retaining existing deck of ${this.currentDeckGuids.length} items.`);
            }
        },

        nextDeck() {
            log('deck', 'Getting next deck.');
            this.shuffledOutGuids.push(...this.currentDeckGuids);
            this.currentDeckGuids = [];
            dbSet(STORES.userState, 'shuffledOutGuids', this.shuffledOutGuids);
            this.manageDeck();
        },

        processShuffle() {
            if (this.shuffleCount > 0) {
                this.shuffleCount--;
                dbSet(STORES.userState, 'shuffleCount', this.shuffleCount);
                this.shuffledOutGuids.push(...this.currentDeckGuids);
                this.currentDeckGuids = [];
                dbSet(STORES.userState, 'shuffledOutGuids', this.shuffledOutGuids);
                this.manageDeck();
                showStatusMessage('Deck shuffled!', 2000);
            } else {
                showStatusMessage('No shuffles remaining.', 2000);
            }
        },

        getRandomGuids(guidArray, count) {
            const shuffled = [...guidArray].sort(() => 0.5 - Math.random());
            return shuffled.slice(0, count);
        },

        // --- Sync Engine ---
        async backgroundSync() {
            log('sync', 'Performing periodic background sync...');
            await this.syncFeed();
            await this.syncUserState();
        },

        async syncFeed() {
            log('sync', 'Fetching feed from server...');
            try {
                const response = await fetch('/api/feed-guids');
                if (!response.ok) throw new Error('Failed to fetch feed GUIDs');
                const { guids: serverGuids } = await response.json();

                const localGuids = (await dbGetAll(STORES.feedItems)).map(item => item.guid);
                const newGuids = serverGuids.filter(guid => !localGuids.includes(guid));

                if (newGuids.length > 0) {
                    log('sync', `Found ${newGuids.length} new items. Fetching full data...`);
                    const itemsResponse = await fetch('/api/feed-items', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ guids: newGuids }),
                    });
                    if (!itemsResponse.ok) throw new Error('Failed to fetch new items');
                    const newItems = await itemsResponse.json();

                    const tx = db.transaction(STORES.feedItems, 'readwrite');
                    for (const item of newItems) {
                        tx.objectStore(STORES.feedItems).put(item);
                    }
                    await new Promise(resolve => tx.oncomplete = resolve);
                    log('sync', `Successfully stored ${newItems.length} new items.`);
                } else {
                    log('sync', 'No new feed items found.');
                }
                 await this.manageDeck();
            } catch (error) {
                log('sync', 'Feed sync failed:', error);
                showStatusMessage('Feed sync failed.', 3000);
            }
        },
        
        async queueSync(type, data) {
            if (!db) await initDB();
            const operation = { type, data, timestamp: new Date().toISOString() };
            const tx = db.transaction(STORES.pendingOperations, 'readwrite');
            tx.objectStore(STORES.pendingOperations).add(operation);
            await new Promise(resolve => tx.oncomplete = resolve);
            log('db', `Operation buffered with type: ${type}`);
            
            // Attempt to sync immediately
            this.syncUserState();
        },

        async syncUserState() {
             if (!navigator.onLine) {
                showStatusMessage('Offline. Changes saved locally.', 3000);
                return;
            }
            log('sync', 'Syncing user state with server...');
            const ops = await dbGetAll(STORES.pendingOperations);
            if (ops.length === 0) {
                log('sync', 'No pending operations to sync.');
                return;
            }

            try {
                const response = await fetch('/api/user-state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ops),
                });
                if (!response.ok) throw new Error(`Server responded with ${response.status}`);
                
                // Clear pending operations on successful sync
                const tx = db.transaction(STORES.pendingOperations, 'readwrite');
                tx.objectStore(STORES.pendingOperations).clear();
                await new Promise(resolve => tx.oncomplete = resolve);

                log('sync', `Successfully synced ${ops.length} operations.`);
                showStatusMessage('Changes synced.', 2000);

            } catch (error) {
                log('sync', 'User state sync failed:', error);
                showStatusMessage('Sync failed. Retrying later.', 3000);
            }
        },

        // --- Link Handling ---
        handleEntryLinks(element) {
            element.querySelectorAll('a').forEach(link => {
                if (this.openUrlsInNewTabEnabled) {
                    link.setAttribute('target', '_blank');
                    link.setAttribute('rel', 'noopener noreferrer');
                } else {
                    link.removeAttribute('target');
                    link.removeAttribute('rel');
                }
            });
        },
        
        // --- UI Helpers ---
        scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }));
});

window.Alpine = Alpine;
Alpine.start();
--- END OF FILE src/main.js ---