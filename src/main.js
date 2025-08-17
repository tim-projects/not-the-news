// main.js - FINAL BUNDLER-FRIENDLY VERSION

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

 