// main.js - FINAL CORRECTED VERSION

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

async function dbGet(storeName, key) { /* ... unchanged ... */ }
async function dbSet(storeName, key, value) { /* ... unchanged ... */ }
async function dbGetAll(storeName) { /* ... unchanged ... */ }
function showStatusMessage(message, duration = 3000) { /* ... unchanged ... */ }

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
        starred: [],
        hidden: [],
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
        
        // ======================= START OF FIX =======================
        // These properties were missing, causing the ReferenceError.
        // Adding them back with a default empty string value fixes the error.
        rssSaveMessage: '',
        keywordSaveMessage: '',
        // ======================== END OF FIX ========================

        // --- Computed Properties ---
        get filteredEntries() {
            const starredGuids = this.starred.map(item => item.guid);
            const hiddenGuids = this.hidden.map(item => item.guid);

            switch (this.filterMode) {
                case 'starred':
                    return starredGuids.map(guid => this.allItems[guid]).filter(Boolean).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
                case 'hidden':
                     return hiddenGuids.map(guid => this.allItems[guid]).filter(Boolean).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
                case 'all':
                     return this.currentDeckGuids.map(guid => this.allItems[guid]).filter(Boolean);
                case 'unread':
                default:
                    return this.currentDeckGuids.filter(guid => !hiddenGuids.includes(guid)).map(guid => this.allItems[guid]).filter(Boolean);
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

        // All other methods are unchanged
        async loadAllUserState() { /* ... unchanged ... */ },
        applyTheme() { /* ... unchanged ... */ },
        async toggleTheme() { /* ... unchanged ... */ },
        async toggleStar(guid) { /* ... unchanged ... */ },
        async toggleHidden(guid) { /* ... unchanged ... */ },
        isStarred(guid) { /* ... unchanged ... */ },
        isHidden(guid) { /* ... unchanged ... */ },
        async manageDeck() { /* ... unchanged ... */ },
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

window.Alpine = Alpine;
Alpine.start();