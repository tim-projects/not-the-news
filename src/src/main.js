// main.js

import Alpine from 'alpinejs';

// --- Database Module ---
const db = {
    _db: null,
    DB_NAME: 'not-the-news-db',
    DB_VERSION: 25, // Increment version on schema changes

    async open() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onupgradeneeded = (event) => {
                console.log('[DB] Database upgrade needed.');
                const db = event.target.result;
                if (!db.objectStoreNames.contains('userState')) {
                    db.createObjectStore('userState', { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains('feedItems')) {
                    db.createObjectStore('feedItems', { keyPath: 'guid' });
                }
                if (!db.objectStoreNames.contains('pendingOperations')) {
                   db.createObjectStore('pendingOperations', { keyPath: 'id', autoIncrement: true });
                }
            };

            request.onsuccess = (event) => {
                this._db = event.target.result;
                console.log(`[DB] Database opened successfully (version ${this.DB_VERSION}).`);
                resolve(this._db);
            };

            request.onerror = (event) => {
                console.error('[DB] Database error:', event.target.error);
                reject(event.target.error);
            };
        });
    },

    async get(storeName, key) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : undefined);
            request.onerror = (event) => reject(event.target.error);
        });
    },

    async getAll(storeName) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    },
    
    // FIX: Implemented cloning to prevent DataCloneError with Alpine proxies
    async put(storeName, value, key = null) {
        const db = await this.open();
        // Deep clone the object to remove proxy wrappers before storing
        const storableValue = JSON.parse(JSON.stringify(value));
        const data = key ? { key, value: storableValue } : storableValue;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => {
                console.error(`[DB] Error putting data into ${storeName}:`, event.target.error);
                reject(event.target.error);
            };
        });
    }
};

// --- UI Feedback Module ---
const ui = {
    _timeoutId: null,
    showStatus(message, duration = 3000) {
        const container = document.getElementById('status-message-container');
        if (!container) return;
        
        container.textContent = message;
        container.classList.add('visible');

        if (this._timeoutId) {
            clearTimeout(this._timeoutId);
        }

        this._timeoutId = setTimeout(() => {
            container.classList.remove('visible');
        }, duration);
    }
};

// --- Alpine.js Application ---
document.addEventListener('alpine:init', () => {
    Alpine.data('rssApp', () => ({
        // Core State
        loading: true,
        progressMessage: 'Initializing...',
        openSettings: false,
        modalView: 'main',
        allItems: {}, // All feed items, keyed by GUID
        
        // User-configurable State
        starred: [], // Array of { guid, starredAt }
        hidden: [], // Array of { guid, hiddenAt }
        currentDeckGuids: [],
        filterMode: 'unread',
        theme: 'dark',
        shuffleCount: 2,
        syncEnabled: true,
        imagesEnabled: true,
        openUrlsInNewTabEnabled: true,
        rssFeedsInput: '',
        keywordBlacklistInput: '',
        rssSaveMessage: '',
        keywordSaveMessage: '',
        
        // Computed State
        get starredGuids() {
            return this.starred.map(item => item.guid);
        },
        get hiddenGuids() {
            return this.hidden.map(item => item.guid);
        },
        get filteredEntries() {
            const deckItems = this.currentDeckGuids
                .map(guid => this.allItems[guid])
                .filter(Boolean); // Filter out any items not found
                
            switch (this.filterMode) {
                case 'starred':
                    return Object.values(this.allItems)
                                .filter(item => this.isStarred(item.guid))
                                .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
                case 'hidden':
                     return Object.values(this.allItems)
                                .filter(item => this.isHidden(item.guid))
                                .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
                case 'all':
                    return deckItems;
                case 'unread':
                default:
                    return deckItems.filter(item => !this.isHidden(item.guid));
            }
        },

        // Initialization
        async initApp() {
            console.log('[App] Initialization started.');
            await db.open();

            // CRITICAL FIX: Load all user state from DB first
            await this.loadStateFromDb();
            
            this.applyTheme();
            
            // Now sync with the server
            await this.syncFeed();

            // Finally, manage the deck with all data loaded
            this.manageDeck();

            this.loading = false;
            console.log('[App] Initialization complete.');
        },

        async loadStateFromDb() {
            console.log('[DB] Loading all user state from IndexedDB.');
            const storedStarred = await db.get('userState', 'starred') || [];
            const storedHidden = await db.get('userState', 'hidden') || [];
            
            this.starred = Array.isArray(storedStarred) ? storedStarred : [];
            this.hidden = Array.isArray(storedHidden) ? storedHidden : [];
            this.filterMode = await db.get('userState', 'filterMode') || 'unread';
            this.theme = await db.get('userState', 'theme') || 'dark';
            this.currentDeckGuids = await db.get('userState', 'currentDeckGuids') || [];
            // ... load other settings ...

            const allFeedItems = await db.getAll('feedItems');
            this.allItems = allFeedItems.reduce((acc, item) => {
                acc[item.guid] = item;
                return acc;
            }, {});

            console.log(`[App] Loaded ${this.starred.length} starred, ${this.hidden.length} hidden items.`);
        },

        // State Management & Actions
        isStarred(guid) {
            return this.starredGuids.includes(guid);
        },
        isHidden(guid) {
            return this.hiddenGuids.includes(guid);
        },

        async toggleStar(guid) {
            const index = this.starred.findIndex(item => item.guid === guid);
            if (index > -1) {
                this.starred.splice(index, 1);
                 ui.showStatus('Item unstarred.');
            } else {
                this.starred.push({ guid, starredAt: new Date().toISOString() });
                 ui.showStatus('Item starred!');
            }
            // CRITICAL FIX: Save the updated state to DB
            await db.put('userState', this.starred, 'starred');
        },

        async toggleHidden(guid) {
            const index = this.hidden.findIndex(item => item.guid === guid);
            if (index > -1) {
                this.hidden.splice(index, 1);
                ui.showStatus('Item un-hidden.');
            } else {
                this.hidden.push({ guid, hiddenAt: new Date().toISOString() });
                ui.showStatus('Item hidden.');
            }
             // CRITICAL FIX: Save the updated state to DB
            await db.put('userState', this.hidden, 'hidden');

            // If an item is hidden, it should be removed from the current deck
            const deckIndex = this.currentDeckGuids.indexOf(guid);
            if(deckIndex > -1) {
                this.currentDeckGuids.splice(deckIndex, 1);
                await db.put('userState', this.currentDeckGuids, 'currentDeckGuids');
            }
        },
        
        toggleTheme() {
            this.theme = this.theme === 'light' ? 'dark' : 'light';
            this.applyTheme();
            db.put('userState', this.theme, 'theme');
        },

        applyTheme() {
            document.documentElement.className = this.theme;
            localStorage.setItem('theme', this.theme);
        },

        // Deck & Feed Logic
        async syncFeed() {
            try {
                console.log('[Sync] Fetching feed from server...');
                const res = await fetch('/api/feed-guids');
                if (!res.ok) throw new Error(`Server responded with ${res.status}`);
                
                const { guids: serverGuids } = await res.json();
                const localGuids = new Set(Object.keys(this.allItems));
                
                const newGuids = serverGuids.filter(guid => !localGuids.has(guid));

                if (newGuids.length > 0) {
                    console.log(`[Sync] Fetching ${newGuids.length} new items.`);
                    const itemsRes = await fetch('/api/feed-items', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ guids: newGuids }),
                    });
                    const newItems = await itemsRes.json();
                    
                    for (const item of newItems) {
                        this.allItems[item.guid] = item;
                        await db.put('feedItems', item);
                    }
                } else {
                    console.log('[Sync] No new feed items found.');
                }
            } catch (error) {
                console.error('[Sync] Feed sync failed:', error);
                ui.showStatus('Could not sync feed.', 5000);
            }
        },

        manageDeck() {
            console.log('[Deck] Managing deck...');
            const unreadGuids = Object.keys(this.allItems)
                .filter(guid => !this.isHidden(guid));

            // If current deck is too small or empty, generate a new one
            const validDeckItems = this.currentDeckGuids.filter(guid => !this.isHidden(guid));

            if (validDeckItems.length < 5) {
                console.log('[Deck] Current deck is small, creating a new one.');
                const shuffled = unreadGuids.sort(() => 0.5 - Math.random());
                this.currentDeckGuids = shuffled.slice(0, 10);
                db.put('userState', this.currentDeckGuids, 'currentDeckGuids');
            } else {
                console.log(`[Deck] Retaining existing deck of ${validDeckItems.length} items.`);
                this.currentDeckGuids = validDeckItems;
            }
        },

        processShuffle() {
            // Placeholder for shuffle logic
            ui.showStatus('Shuffle logic not yet fully implemented.');
            this.manageDeck(); // For now, just create a new deck
        },
        
        // Other Methods
        scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        handleEntryLinks(element) {
            element.querySelectorAll('a').forEach(link => {
                if (this.openUrlsInNewTabEnabled) {
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                }
            });
        }
    }));
});

window.Alpine = Alpine;
Alpine.start();