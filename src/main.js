import Alpine from 'alpinejs';
import './css/variables.css';
import './css/buttons.css';
import './css/forms.css';
import './css/layout.css';
import './css/content.css';
import './css/modal.css';
import './css/status.css';

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 25;
const STORES = {
    userState: 'userState',
    feedItems: 'feedItems',
    pendingOperations: 'pendingOperations'
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
            const existingStores = Array.from(db.objectStoreNames);
            existingStores.forEach(storeName => {
                if (!Object.values(STORES).includes(storeName)) {
                    db.deleteObjectStore(storeName);
                    log('db', `Removed old/orphaned store: ${storeName}`);
                }
            });
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
function showAppStatusMessage(message, duration = 3000) {
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
        openSettings: false,
        modalView: 'main',

        // --- User State (Reactive) ---
        starred: [],
        hidden: [],
        currentDeckGuids: [],
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
        rssSaveMessage: '',
        keywordSaveMessage: '',

        // --- Computed Properties ---
        get filteredEntries() {
            // Helper to get full item objects from an array of GUIDs
            const getItemsFromGuids = (guids) => {
                return guids
                    .map(guid => this.allItems[guid])
                    .filter(Boolean) // Remove any items that might not be in allItems
                    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
            };

            switch (this.filterMode) {
                case 'starred':
                    // Map the 'starred' array of objects to an array of GUIDs
                    return getItemsFromGuids(this.starred.map(item => item.guid));
                case 'hidden':
                    // Map the 'hidden' array of objects to an array of GUIDs
                    return getItemsFromGuids(this.hidden.map(item => item.guid));
                case 'all':
                     return getItemsFromGuids(Object.keys(this.allItems));
                case 'unread':
                default:
                    const hiddenGuids = new Set(this.hidden.map(item => item.guid));
                    const unreadDeckGuids = this.currentDeckGuids.filter(guid => !hiddenGuids.has(guid));
                    return getItemsFromGuids(unreadDeckGuids);
            }
        },

        // --- Methods ---
        async initApp() {
            log('app', 'Initialization started.');
            try {
                this.progressMessage = 'Opening local database...';
                await initDB();

                this.progressMessage = 'Loading user settings...';
                await this.loadAllUserState(); // Step 1: Load local state from DB.

                this.progressMessage = 'Applying theme...';
                this.applyTheme();

                this.progressMessage = 'Synchronizing feed...';
                await this.syncFeed(); // Step 2: Get all articles.

                this.progressMessage = 'Synchronizing your data...';
                await this.fetchAndApplyServerState(); // Step 3: Pull server state.

                this.progressMessage = 'Pushing local changes...';
                await this.syncUserState(); // Step 4: Push any offline changes.

                this.progressMessage = 'Building your deck...';
                await this.manageDeck(); // Step 5: Build UI with final data.

                this.loading = false;
                log('app', 'Initialization complete.');

                setInterval(() => this.backgroundSync(), 5 * 60 * 1000);
            } catch(error) {
                log('app', 'CRITICAL ERROR during initialization:', error);
                this.progressMessage = 'An error occurred. Please check the console.';
            }
        },

        // --- State Management ---
        async loadAllUserState() {
            log('db', 'Loading all user state from IndexedDB.');
            const allState = await dbGetAll(STORES.userState);
            const stateMap = allState.reduce((acc, { key, value }) => {
                acc[key] = value;
                return acc;
            }, {});

            this.starred = Array.isArray(stateMap.starred) ? stateMap.starred : this.starred;
            this.hidden = Array.isArray(stateMap.hidden) ? stateMap.hidden : this.hidden;
            this.currentDeckGuids = Array.isArray(stateMap.currentDeckGuids) ? stateMap.currentDeckGuids : this.currentDeckGuids;
            this.shuffledOutGuids = Array.isArray(stateMap.shuffledOutGuids) ? stateMap.shuffledOutGuids : this.shuffledOutGuids;
            
            this.shuffleCount = typeof stateMap.shuffleCount === 'number' ? stateMap.shuffleCount : this.shuffleCount;
            this.lastShuffleResetDate = stateMap.lastShuffleResetDate || this.lastShuffleResetDate;
            this.filterMode = stateMap.filterMode || this.filterMode;
            this.syncEnabled = typeof stateMap.syncEnabled === 'boolean' ? stateMap.syncEnabled : this.syncEnabled;
            this.imagesEnabled = typeof stateMap.imagesEnabled === 'boolean' ? stateMap.imagesEnabled : this.imagesEnabled;
            this.openUrlsInNewTabEnabled = typeof stateMap.openUrlsInNewTabEnabled === 'boolean' ? stateMap.openUrlsInNewTabEnabled : this.openUrlsInNewTabEnabled;
            this.theme = stateMap.theme || this.theme;

            log('app', `Loaded ${this.starred.length} starred, ${this.hidden.length} hidden items from local storage.`);
        },

        // --- Theme ---
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
            const existingIndex = this.starred.findIndex(item => item.guid === guid);
            const action = existingIndex > -1 ? 'remove' : 'add';

            if (action === 'add') {
                this.starred.push({ guid, starredAt: new Date().toISOString() });
            } else {
                this.starred.splice(existingIndex, 1);
            }
            await dbSet(STORES.userState, 'starred', this.starred);
            this.queueSync('starDelta', { itemGuid: guid, action });
            showAppStatusMessage(action === 'add' ? 'Item Starred' : 'Item Unstarred', 2000);
        },

        async toggleHidden(guid) {
            const existingIndex = this.hidden.findIndex(item => item.guid === guid);
            const action = existingIndex > -1 ? 'remove' : 'add';

            if (action === 'add') {
                this.hidden.push({ guid, hiddenAt: new Date().toISOString() });
            } else {
                this.hidden.splice(existingIndex, 1);
            }
            await dbSet(STORES.userState, 'hidden', this.hidden);
            this.queueSync('hiddenDelta', { itemGuid: guid, action });

            const deckIndex = this.currentDeckGuids.indexOf(guid);
            if (deckIndex > -1) {
                this.currentDeckGuids.splice(deckIndex, 1);
                await dbSet(STORES.userState, 'currentDeckGuids', this.currentDeckGuids);
            }

            if (this.filterMode === 'unread' && this.filteredEntries.length === 0) {
                showAppStatusMessage('Deck cleared! Loading next deck...', 3000);
                this.nextDeck();
            }
        },

        isStarred(guid) {
            return this.starred.some(item => item.guid === guid);
        },

        isHidden(guid) {
            return this.hidden.some(item => item.guid === guid);
        },

        // --- Deck Management ---
        async manageDeck() {
            log('deck', 'Managing deck...');
            const allFeedItems = await dbGetAll(STORES.feedItems);
            this.allItems = allFeedItems.reduce((acc, item) => {
                if (item && item.guid) acc[item.guid] = item;
                return acc;
            }, {});

            const hiddenGuids = new Set(this.hidden.map(item => item.guid));
            const availableGuids = Object.keys(this.allItems).filter(guid => !hiddenGuids.has(guid));
            const validDeckItems = this.currentDeckGuids.filter(guid => availableGuids.includes(guid));

            if (validDeckItems.length < 10 && availableGuids.length > 0) {
                log('deck', 'Current deck is small or invalid, creating a new one.');
                this.currentDeckGuids = this.getRandomGuids(availableGuids, 10);
                await dbSet(STORES.userState, 'currentDeckGuids', this.currentDeckGuids);
            } else if (availableGuids.length === 0 && validDeckItems.length === 0) {
                log('deck', 'No available items to create a deck.');
                this.currentDeckGuids = [];
                await dbSet(STORES.userState, 'currentDeckGuids', this.currentDeckGuids);
            } else {
                log('deck', `Retaining/updating existing deck to ${validDeckItems.length} items.`);
                this.currentDeckGuids = validDeckItems;
                await dbSet(STORES.userState, 'currentDeckGuids', this.currentDeckGuids);
            }
        },

        async nextDeck() {
            log('deck', 'Getting next deck.');
            this.shuffledOutGuids.push(...this.currentDeckGuids);
            this.currentDeckGuids = [];
            await dbSet(STORES.userState, 'shuffledOutGuids', this.shuffledOutGuids);
            await this.manageDeck();
        },

        async processShuffle() {
            if (this.shuffleCount > 0) {
                this.shuffleCount--;
                await dbSet(STORES.userState, 'shuffleCount', this.shuffleCount);
                await this.nextDeck();
                showAppStatusMessage('Deck shuffled!', 2000);
            } else {
                showAppStatusMessage('No shuffles remaining.', 2000);
            }
        },

        getRandomGuids(guidArray, count) {
            const shuffled = [...guidArray].sort(() => 0.5 - Math.random());
            return shuffled.slice(0, count);
        },

        // --- Sync Engine ---
        async backgroundSync() {
            if (!this.syncEnabled) return;
            log('sync', 'Performing periodic background sync...');
            await this.syncFeed();
            await this.syncUserState();
        },

        // FIX: Replaced old sync function with one that fetches keys individually.
        async fetchAndApplyServerState() {
            log('sync', 'Fetching user state from server...');
            const stateKeysToSync = ['starred', 'hidden']; // Add more keys here as needed

            for (const key of stateKeysToSync) {
                try {
                    const res = await fetch(`/api/user-state/${key}`, { credentials: 'same-origin' });

                    if (res.status === 404) {
                        log('sync', `No state for key '${key}' on server. Using local version.`);
                        continue; // It's not an error if the key doesn't exist yet
                    }
                    if (!res.ok) {
                        throw new Error(`Server responded with ${res.status} for key '${key}'`);
                    }

                    const serverState = await res.json();
                    
                    if (serverState && Array.isArray(serverState.value)) {
                        log('sync', `Applying server state for '${key}' (${serverState.value.length} items).`);
                        this[key] = serverState.value; // Update reactive Alpine property
                        await dbSet(STORES.userState, key, this[key]); // Save to IndexedDB
                    }
                } catch (error) {
                    log('sync', `Failed to fetch state for key '${key}':`, error);
                    // Continue with the next key even if one fails
                }
            }
            log('sync', 'Finished fetching all user states.');
        },
        
        async syncFeed() {
            log('sync', 'Fetching feed from server...');
            try {
                const response = await fetch('/api/feed-guids', { credentials: 'same-origin' });
                if (!response.ok) throw new Error('Failed to fetch feed GUIDs');
                const { guids: serverGuids } = await response.json();
                
                const allItems = await dbGetAll(STORES.feedItems);
                const localGuids = new Set(allItems.map(item => item.guid));
                const newGuids = serverGuids.filter(guid => !localGuids.has(guid));

                if (newGuids.length > 0) {
                    log('sync', `Found ${newGuids.length} new items. Fetching full data...`);
                    const itemsResponse = await fetch('/api/feed-items', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ guids: newGuids }),
                        credentials: 'same-origin'
                    });
                    if (!itemsResponse.ok) throw new Error('Failed to fetch new items');
                    const newItems = await itemsResponse.json();

                    const tx = db.transaction(STORES.feedItems, 'readwrite');
                    const store = tx.objectStore(STORES.feedItems);
                    for (const item of newItems) {
                       if(item && item.guid) store.put(item);
                    }
                    await new Promise(resolve => tx.oncomplete = resolve);
                    log('sync', `Successfully stored ${newItems.length} new items.`);
                } else {
                    log('sync', 'No new feed items found.');
                }
                 await this.manageDeck();
            } catch (error) {
                log('sync', 'Feed sync failed:', error);
                showAppStatusMessage('Feed sync failed.', 3000);
            }
        },
        
        async queueSync(type, data) {
            if (!db) await initDB();
            const operation = { type, data, id: Date.now() + Math.random(), timestamp: new Date().toISOString() };
            const tx = db.transaction(STORES.pendingOperations, 'readwrite');
            tx.objectStore(STORES.pendingOperations).add(operation);
            await new Promise(resolve => tx.oncomplete = resolve);
            log('db', `Operation buffered: ${type}`);
            
            this.syncUserState();
        },

        async syncUserState() {
             if (!navigator.onLine || !this.syncEnabled) {
                return;
            }
            log('sync', 'Syncing pending operations with server...');
            const ops = await dbGetAll(STORES.pendingOperations);
            if (ops.length === 0) {
                return;
            }

            try {
                const response = await fetch('/api/user-state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ops),
                    credentials: 'same-origin'
                });
                if (!response.ok) throw new Error(`Server responded with ${response.status}`);
                
                const responseData = await response.json();
                if (responseData.status === 'ok') {
                    const tx = db.transaction(STORES.pendingOperations, 'readwrite');
                    tx.objectStore(STORES.pendingOperations).clear();
                    await new Promise(resolve => tx.oncomplete = resolve);
                    log('sync', `Successfully synced ${ops.length} operations.`);
                    showAppStatusMessage('Changes synced.', 2000);
                }
            } catch (error) {
                log('sync', 'User state sync failed:', error);
                showAppStatusMessage('Sync failed. Retrying later.', 3000);
            }
        },

        // --- Settings Management ---
        async saveRssFeeds() { /* Placeholder */ },
        async saveKeywordBlacklist() { /* Placeholder */ },

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