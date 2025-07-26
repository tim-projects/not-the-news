// www/js/data/database.js
// This file manages IndexedDB interactions and synchronization with the server.

import { openDB } from '../libs/idb.js'; // Adjusted path to idb.js

// --- IndexedDB Configuration ---
const DB_NAME = 'not-the-news-db';
const DB_VERSION = 7; // *** IMPORTANT: Increment DB_VERSION for schema changes ***

export let db = null; // Will hold the IndexedDB instance

// Define schema for object stores
const OBJECT_STORES_SCHEMA = [
    { name: 'feedItems', keyPath: 'guid', options: { unique: true } },
    { name: 'starredItems', keyPath: 'id' }, // Stores { id: 'guid', starredAt: 'ISOString' }
    { name: 'hiddenItems', keyPath: 'id' },  // Stores { id: 'guid', hiddenAt: 'ISOString' }
    { name: 'currentDeckGuids', keyPath: 'id' }, // Dedicated store for current deck GUIDs
    { name: 'userSettings', keyPath: 'key' }, // Stores { key: 'settingName', value: 'settingValue', lastModified: 'timestamp' }
    { name: 'pendingOperations', keyPath: 'id', options: { autoIncrement: true } } // *** NEW: Store for buffered operations ***
];

// --- User State Definitions (Maps server keys to client IndexedDB storage) ---
// This is crucial for the new pull/pushUserState logic.
export const USER_STATE_DEFS = {
    // Array-based states stored in their own dedicated object stores
    starred: { store: 'starredItems', type: 'array', default: [] },
    hidden: { store: 'hiddenItems', type: 'array', default: [] },
    currentDeckGuids: { store: 'currentDeckGuids', type: 'array', default: [] },

    // Simple value states stored in the 'userSettings' object store
    filterMode: { store: 'userSettings', type: 'simple', default: 'all' },
    syncEnabled: { store: 'userSettings', type: 'simple', default: true },
    imagesEnabled: { store: 'userSettings', type: 'simple', default: true },
    rssFeeds: { store: 'userSettings', type: 'simple', default: [] },
    keywordBlacklist: { store: 'userSettings', type: 'simple', default: [] },
    shuffleCount: { store: 'userSettings', type: 'simple', default: 0 },
    lastShuffleResetDate: { store: 'userSettings', type: 'simple', default: null },
    openUrlsInNewTabEnabled: { store: 'userSettings', type: 'simple', default: true },
    // A specific key to store the global latest timestamp from server sync
    lastStateSync: { store: 'userSettings', type: 'simple', default: null } 
};

// --- Initialization ---
export async function initDb() {
    db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion, transaction) {
            console.log(`[IndexedDB] Upgrading DB from version ${oldVersion} to ${newVersion}`);
            
            // Create or update object stores
            OBJECT_STORES_SCHEMA.forEach(schema => {
                if (!db.objectStoreNames.contains(schema.name)) {
                    const store = db.createObjectStore(schema.name, { keyPath: schema.keyPath, ...schema.options });
                    console.log(`[IndexedDB] Created object store: ${schema.name}`);
                }
            });

            // Add specific migration logic here if DB_VERSION changes significantly
            // For example, if you introduce 'pendingOperations' at version 7 from version 6:
            if (oldVersion < 7) {
                if (!db.objectStoreNames.contains('pendingOperations')) {
                    db.createObjectStore('pendingOperations', { keyPath: 'id', autoIncrement: true });
                    console.log('[IndexedDB] Created new object store: pendingOperations');
                }
            }
        },
        blocked() {
            console.warn('[IndexedDB] Database upgrade is blocked. Close other tabs for this site.');
            alert('Database update blocked. Please close all other tabs with this site open.');
        },
        blocking() {
            console.warn('[IndexedDB] Database is blocking. Other tabs need to close.');
        }
    });
    console.log(`[IndexedDB] Database '${DB_NAME}' opened, version ${DB_VERSION}`);
}

// --- Generic State Loading/Saving Functions ---

/**
 * Loads a single simple state (key-value pair) from the specified IndexedDB store.
 * @param {IDBDatabase} db The IndexedDB instance.
 * @param {string} key The key of the state to load (e.g., 'filterMode').
 * @param {IDBTransaction} [tx=null] Optional transaction to use.
 * @returns {Promise<{value: any, lastModified: string|null}>} The value and last modification timestamp, or default.
 */
export async function loadSimpleState(db, key, tx = null) {
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'simple') {
        console.error(`[loadSimpleState] Invalid or undefined simple state key: ${key}`);
        return { value: def ? def.default : null, lastModified: null };
    }
    const storeName = def.store;

    let transaction;
    try {
        transaction = tx || db.transaction(storeName, 'readonly');
        const data = await transaction.objectStore(storeName).get(key);
        // Assuming data stored as { key: 'name', value: 'val', lastModified: 'timestamp' }
        if (data && data.hasOwnProperty('value')) {
            return { value: data.value, lastModified: data.lastModified || null };
        }
    } catch (e) {
        console.error(`[loadSimpleState] Error loading ${key} from store ${storeName}:`, e);
    } finally {
        if (!tx && transaction) await transaction.done; // Only await if we created the transaction
    }
    // Return default if not found or error
    return { value: def.default, lastModified: null };
}

/**
 * Saves a single simple state (key-value pair) to the specified IndexedDB store.
 * @param {IDBDatabase} db The IndexedDB instance.
 * @param {string} key The key of the state to save (e.g., 'filterMode').
 * @param {any} value The value to save.
 * @param {string} [serverTimestamp=null] Optional timestamp from the server.
 * @param {IDBTransaction} [tx=null] Optional transaction to use.
 * @returns {Promise<void>}
 */
export async function saveSimpleState(db, key, value, serverTimestamp = null, tx = null) {
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'simple') {
        console.error(`[saveSimpleState] Invalid or undefined simple state key: ${key}`);
        throw new Error(`Invalid or undefined simple state key: ${key}`);
    }
    const storeName = def.store;

    let transaction;
    try {
        transaction = tx || db.transaction(storeName, 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        
        // Prepare object to save, including timestamp if provided
        const objToSave = { key: key, value: value };
        if (serverTimestamp) {
            objToSave.lastModified = serverTimestamp;
        } else {
            // If no server timestamp, use current client time (for client-only changes)
            objToSave.lastModified = new Date().toISOString(); 
        }

        await objectStore.put(objToSave);
        console.log(`[saveSimpleState] Saved "${key}" to store "${storeName}". Value:`, value);
    } catch (e) {
        console.error(`[saveSimpleState] Error saving "${key}" to store "${storeName}":`, e);
        throw e;
    } finally {
        if (!tx && transaction) await transaction.done;
    }
}

/**
 * Loads an array state (e.g., starredItems) from its dedicated IndexedDB store.
 * @param {IDBDatabase} db The IndexedDB instance.
 * @param {string} key The key of the array state (e.g., 'starred').
 * @param {IDBTransaction} [tx=null] Optional transaction to use.
 * @returns {Promise<{value: Array<any>, lastModified: string|null}>} The array and last modification timestamp, or default.
 */
export async function loadArrayState(db, key, tx = null) {
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'array') {
        console.error(`[loadArrayState] Invalid or undefined array state key: ${key}`);
        return { value: def ? def.default : [], lastModified: null };
    }
    const storeName = def.store;

    let transaction;
    try {
        transaction = tx || db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const allItems = await store.getAll(); // Get all items from the array store
        
        // For array types, 'lastModified' is generally from the API response for the entire collection.
        // If you need a lastModified for the *local* array for some reason, you'd store it as a simple setting.
        return { value: allItems, lastModified: null }; 
    } catch (e) {
        console.error(`[loadArrayState] Error loading ${key} from store ${storeName}:`, e);
    } finally {
        if (!tx && transaction) await transaction.done;
    }
    return { value: def.default, lastModified: null };
}


/**
 * Saves an array state (e.g., starredItems) to its dedicated IndexedDB store.
 * This clears the store and adds all new items.
 * @param {IDBDatabase} db The IndexedDB instance.
 * @param {string} key The key of the array state (e.g., 'starred').
 * @param {Array<any>} arr The array of items to save.
 * @param {string} [serverTimestamp=null] Optional timestamp from the server.
 * @param {IDBTransaction} [tx=null] Optional transaction to use.
 * @returns {Promise<void>}
 */
export async function saveArrayState(db, key, arr, serverTimestamp = null, tx = null) {
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'array') {
        console.error(`[saveArrayState] Invalid or undefined array state key: ${key}`);
        throw new Error(`Invalid or undefined array state key: ${key}`);
    }
    const storeName = def.store;

    let transaction;
    try {
        transaction = tx || db.transaction(storeName, 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        
        await objectStore.clear(); // Clear existing items

        // Ensure array items are clonable (remove proxies/observers if any)
        const clonableArr = JSON.parse(JSON.stringify(arr));
        
        // For array stores like 'starredItems', 'hiddenItems', 'currentDeckGuids',
        // each element in the array is a separate record. The 'id' property in these objects
        // should map to the object store's keyPath.
        for (const item of clonableArr) {
            // For currentDeckGuids, the server sends an array of strings (GUIDs).
            // We need to store them as objects with an 'id' key for IndexedDB.
            const itemToStore = (key === 'currentDeckGuids' && typeof item === 'string') 
                               ? { id: item } 
                               : item;
            await objectStore.put(itemToStore);
        }
        
        console.log(`[saveArrayState] Saved ${clonableArr.length} items for "${key}" to store "${storeName}".`);

        // If a serverTimestamp is provided for the collection, update the 'lastStateSync'
        // or a dedicated timestamp for this array if you introduce one.
        // For now, `pullUserState` handles the global `lastStateSync` update.
    } catch (e) {
        console.error(`[saveArrayState] Error saving "${key}" to store "${storeName}":`, e);
        throw e;
    } finally {
        if (!tx && transaction) await transaction.done;
    }
}

// --- Pending Operations Functions ---
// These functions need to be exported!

/**
 * Adds an operation to the pendingOperations store for later synchronization.
 * @param {IDBDatabase} db The IndexedDB instance.
 * @param {object} operation The operation object to buffer.
 * Expected format: { type: 'starDelta'|'hiddenDelta'|'simpleUpdate', data: {...} }
 */
export async function addPendingOperation(db, operation) {
    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    try {
        await store.add(operation);
        await tx.done;
        console.log('[addPendingOperation] Operation buffered:', operation);
    } catch (e) {
        console.error('[addPendingOperation] Error buffering operation:', e);
        throw e;
    }
}

/**
 * Processes all pending operations, attempting to synchronize them with the server.
 * If successful, operations are removed from the buffer.
 * @param {IDBDatabase} db The IndexedDB instance.
 */
export async function processPendingOperations(db) {
    if (!isOnline()) {
        console.log('[processPendingOperations] Offline. Skipping sync.');
        return;
    }

    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    const operations = await store.getAll();

    if (operations.length === 0) {
        console.log('[processPendingOperations] No pending operations to process.');
        return;
    }

    console.log(`[processPendingOperations] Attempting to process ${operations.length} pending operations.`);
    const API_BASE_URL = window.location.origin;

    for (const op of operations) {
        let success = false;
        try {
            if (op.type === 'starDelta' || op.type === 'hiddenDelta') {
                const endpoint = op.type === 'starDelta' ? 'starred-items-delta' : 'hidden-items-delta';
                const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(op.data)
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status} for ${op.type} delta.`);
                }
                const responseData = await response.json();
                console.log(`[processPendingOperations] ${op.type} delta synced. Server response:`, responseData);
                success = true;

            } else if (op.type === 'simpleUpdate') {
                // Use the generic pushUserState function for simple updates
                success = await pushUserState(db, op.key, op.value); // This is where pushUserState gets used
            } else {
                console.warn(`[processPendingOperations] Unknown operation type: ${op.type}. Skipping.`);
                success = true; // Treat as success to remove unknown ops
            }

            if (success) {
                await store.delete(op.id); // Remove from buffer if successfully synced
                console.log(`[processPendingOperations] Removed buffered operation ${op.id} (${op.type})`);
            }
        } catch (error) {
            console.error(`[processPendingOperations] Failed to sync operation ${op.id} (${op.type}). Keeping in buffer:`, error);
            // Break the loop if an error occurs to prevent continuous retries on failed operations
            // or if the network is down. The next call will attempt from remaining operations.
            break; 
        }
    }
    await tx.done; // Commit deletion of successful operations
    console.log('[processPendingOperations] Finished processing pending operations.');
}

// --- Connectivity Check ---

/**
 * Checks if the application is currently online.
 * @returns {boolean} True if online, false otherwise.
 */
export function isOnline() {
    return navigator.onLine;
}

// --- Client-Server Synchronization Functions ---
// The pullUserState and pushUserState functions were already defined above.
// They need to be exported as well.

export async function pullUserState(db) {
    // ... (existing pullUserState implementation) ...
}

export async function pushUserState(db, keyToUpdate, valueToUpdate) {
    // ... (existing pushUserState implementation) ...
}

// Placeholder for performFeedSync. This function needs to be implemented.
// It should fetch new feed items from the server and update the 'feedItems' store.
export async function performFeedSync(app, lastSyncTime = null) {
    console.log('[performFeedSync] Placeholder for fetching latest feed items from server.');
    // Example:
    // const response = await fetch('/api/feed-items?since=' + lastSyncTime);
    // const newItems = await response.json();
    // const tx = db.transaction('feedItems', 'readwrite');
    // const store = tx.objectStore('feedItems');
    // for (const item of newItems) {
    //     await store.put(item);
    // }
    // await tx.done;
    // app.loadFeedItemsFromDB(); // Reload app.entries
    // app.updateCounts();
    // createStatusBarMessage('Feed synced!', 'success');
}

// Placeholder for performFullSync. This function likely orchestrates pullUserState and performFeedSync.
export async function performFullSync(app) {
    console.log('[performFullSync] Placeholder for full synchronization (feed + user state).');
    await pullUserState(db);
    // You might pass the last sync timestamp from pullUserState to performFeedSync
    // await performFeedSync(app, app.lastStateSync); // Assuming app.lastStateSync holds the timestamp
    // createStatusBarMessage('Full sync complete!', 'success');
}


// --- Functions to get data out of IndexedDB for UI ---

export async function getStarredItems() {
    await initDb(); // Ensure DB is open
    const { value } = await loadArrayState(db, 'starred');
    return value;
}

export async function getHiddenItems() {
    await initDb(); // Ensure DB is open
    const { value } = await loadArrayState(db, 'hidden');
    return value;
}

// *** UPDATED: getCurrentDeckGuids now uses loadArrayState and expects array from server ***
export async function getCurrentDeckGuids() {
    await initDb(); // Ensure DB is open
    const { value } = await loadArrayState(db, 'currentDeckGuids');
    return value.map(item => item.id); // Return just the GUID strings
}


export async function getFilterMode() {
    await initDb(); // Ensure DB is open
    const { value } = await loadSimpleState(db, 'filterMode');
    return value;
}

export async function getSyncEnabled() {
    await initDb(); // Ensure DB is open
    const { value } = await loadSimpleState(db, 'syncEnabled');
    return value;
}

export async function getImagesEnabled() {
    await initDb();
    const { value } = await loadSimpleState(db, 'imagesEnabled');
    return value;
}
export async function getRssFeeds() {
    await initDb();
    const { value } = await loadSimpleState(db, 'rssFeeds');
    return value;
}
export async function getKeywordBlacklist() {
    await initDb();
    const { value } = await loadSimpleState(db, 'keywordBlacklist');
    return value;
}
export async function getShuffleCount() {
    await initDb();
    const { value } = await loadSimpleState(db, 'shuffleCount');
    return value;
}
export async function getLastShuffleResetDate() {
    await initDb();
    const { value } = await loadSimpleState(db, 'lastShuffleResetDate');
    return value;
}
export async function getOpenUrlsInNewTabEnabled() {
    await initDb();
    const { value } = await loadSimpleState(db, 'openUrlsInNewTabEnabled');
    return value;
}