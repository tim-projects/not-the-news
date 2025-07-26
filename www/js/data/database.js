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
    // Array-based states stored in their own dedicated object stores.
    // Their *timestamps* will be stored as simple key-value pairs in 'userSettings'
    // using their key name (e.g., 'starred' will have a timestamp in 'userSettings').
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
 * Loads a simple state (key-value pair) from the 'userSettings' IndexedDB store.
 * This is used for all settings in 'userSettings', including actual simple values
 * and the timestamps for array types (which are stored as simple entries under their key name).
 * @param {IDBDatabase} db The IndexedDB instance.
 * @param {string} key The key of the state to load (e.g., 'filterMode' or 'starred' for its timestamp).
 * @param {IDBTransaction} [tx=null] Optional transaction to use.
 * @returns {Promise<{value: any, lastModified: string|null}>} The value and last modification timestamp, or default.
 */
export async function loadSimpleState(db, key, tx = null) {
    const def = USER_STATE_DEFS[key];
    // This function specifically loads from the 'userSettings' store.
    // It's used for actual simple settings AND for loading timestamps of array types.
    // The key must be defined in USER_STATE_DEFS as something whose timestamp or value resides in userSettings.
    if (!def) {
        console.error(`[loadSimpleState] Invalid or undefined state key: ${key}.`);
        return { value: null, lastModified: null }; // Cannot determine default without def
    }
    
    // Determine the store name. For array types, their *data* is in their own store,
    // but their *timestamp* is stored in 'userSettings' under the same key.
    // So, for 'starred', 'hidden', 'currentDeckGuids', we want to read from 'userSettings' to get their timestamp.
    // For 'filterMode', 'syncEnabled', etc., we read their value and timestamp from 'userSettings'.
    const storeName = 'userSettings'; // Always read from userSettings for simple states / timestamps

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
    // Return default value from definition if not found or error, timestamp null
    return { value: def.default, lastModified: null };
}

/**
 * Saves a single simple state (key-value pair) to the 'userSettings' IndexedDB store.
 * This is used for simple value settings and for storing the lastModified timestamps of array types.
 * @param {IDBDatabase} db The IndexedDB instance.
 * @param {string} key The key of the state to save (e.g., 'filterMode' or 'starred' for its timestamp).
 * @param {any} value The value to save. For array timestamps, this can be a placeholder (e.g., true or null).
 * @param {string} [serverTimestamp=null] Optional timestamp from the server.
 * @param {IDBTransaction} [tx=null] Optional transaction to use.
 * @returns {Promise<void>}
 */
export async function saveSimpleState(db, key, value, serverTimestamp = null, tx = null) {
    const def = USER_STATE_DEFS[key];
    // This function strictly saves to 'userSettings'.
    // It's used for actual simple settings AND for saving timestamps of array types.
    if (!def) {
        console.error(`[saveSimpleState] Invalid or undefined state key: ${key}.`);
        throw new Error(`Invalid or undefined state key: ${key}`);
    }
    
    const storeName = 'userSettings'; // Always write to userSettings for simple states / timestamps

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
 * It also retrieves the lastModified timestamp for this array from 'userSettings'.
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
    const arrayStoreName = def.store; // The store for the array's items (e.g., 'starredItems')

    let transaction;
    try {
        // Need transaction for both stores: the array's data store and 'userSettings' for its timestamp
        transaction = tx || db.transaction([arrayStoreName, 'userSettings'], 'readonly'); 
        const arrayStore = transaction.objectStore(arrayStoreName);
        const allItems = await arrayStore.getAll(); // Get all items from the array store
        
        // Retrieve the lastModified timestamp for this array from 'userSettings'
        // We pass the key, which is e.g. 'starred', and it will load from 'userSettings'
        const { lastModified: arrayTimestamp } = await loadSimpleState(db, key, transaction); 

        return { value: allItems, lastModified: arrayTimestamp }; 
    } catch (e) {
        console.error(`[loadArrayState] Error loading ${key} from store ${arrayStoreName}:`, e);
    } finally {
        if (!tx && transaction) await transaction.done;
    }
    return { value: def.default, lastModified: null };
}


/**
 * Saves an array state (e.g., starredItems) to its dedicated IndexedDB store.
 * This clears the store and adds all new items. It also updates the lastModified timestamp
 * for this array key in the 'userSettings' store.
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
    const arrayStoreName = def.store;

    let transaction;
    try {
        // Need transaction for both stores: the array's data store and 'userSettings' for its timestamp
        transaction = tx || db.transaction([arrayStoreName, 'userSettings'], 'readwrite'); 
        const arrayObjectStore = transaction.objectStore(arrayStoreName);
        
        await arrayObjectStore.clear(); // Clear existing items

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
            await arrayObjectStore.put(itemToStore);
        }
        
        console.log(`[saveArrayState] Saved ${clonableArr.length} items for "${key}" to store "${arrayStoreName}".`);

        // Update the lastModified timestamp for this array key in the 'userSettings' store.
        // The actual 'value' for this simple setting in userSettings can be a placeholder (e.g., `true` or `null`),
        // as we only care about its `lastModified` property for ETag checks.
        // We pass 'null' as value since it's just a timestamp placeholder in userSettings for arrays.
        await saveSimpleState(db, key, null, serverTimestamp, transaction); 

    } catch (e) {
        console.error(`[saveArrayState] Error saving "${key}" to store "${arrayStoreName}":`, e);
        throw e;
    } finally {
        if (!tx && transaction) await transaction.done;
    }
}

// --- Pending Operations Functions ---

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
                const endpoint = op.type === 'starDelta' ? 'starred/delta' : 'hidden/delta'; // Corrected endpoint for consistency
                const response = await fetch(`${API_BASE_URL}/user-state/${endpoint}`, { // Use /user-state/ prefix
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
                // For simple updates, use the pushUserState function
                success = await pushUserState(db, op.key, op.value); 
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

/**
 * Returns the count of pending operations.
 * This function needs to be exported for other modules to use.
 * @returns {Promise<number>} The number of buffered changes.
 */
export async function getBufferedChangesCount() {
    if (!db) {
        await initDb(); // Ensure db is open before attempting to read.
    }
    try {
        const tx = db.transaction('pendingOperations', 'readonly');
        const store = tx.objectStore('pendingOperations');
        const count = await store.count();
        await tx.done;
        return count;
    } catch (e) {
        console.error('[getBufferedChangesCount] Error getting pending operations count:', e);
        return 0; // Return 0 in case of error
    }
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
let _isPullingUserState = false; // Prevent multiple concurrent pulls
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500; // Minimum time between pull attempts

export async function pullUserState(db) {
    if (_isPullingUserState) {
        console.log('[pullUserState] Already pulling user state. Skipping new request.');
        return;
    }
    const now = Date.now();
    if (now - _lastPullAttemptTime < PULL_DEBOUNCE_MS) {
        console.log('[pullUserState] Debouncing pull request.');
        return;
    }
    _lastPullAttemptTime = now;
    _isPullingUserState = true;
    
    console.log('[pullUserState] Attempting to pull user state from server...');
    const API_BASE_URL = window.location.origin;

    // We no longer use a global lastStateSync as the primary ETag for individual items.
    // Each item's ETag is fetched individually.
    // The global 'lastStateSync' will simply be updated to the latest timestamp among all synced items.
    let newestOverallTimestamp = null; // Initialize to null

    const fetchPromises = Object.entries(USER_STATE_DEFS).map(async ([key, def]) => {
        // Skip 'lastStateSync' itself from being fetched as a user state key, as it's client-managed from other keys.
        if (key === 'lastStateSync') return { key, status: 'skipped' };

        const url = `${API_BASE_URL}/user-state/${key}`;
        let localTimestamp = '';
        
        // For all defined user state keys, load their *specific* lastModified timestamp from 'userSettings'.
        // This handles both 'simple' types and the timestamps for 'array' types.
        // loadSimpleState is now designed to always read from 'userSettings' for any key.
        const { lastModified } = await loadSimpleState(db, key);
        localTimestamp = lastModified || ''; // Use empty string if no local timestamp found
        
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (localTimestamp) {
                headers['If-None-Match'] = localTimestamp;
                console.log(`[pullUserState] Fetching ${key} with If-None-Match: ${localTimestamp.substring(0,20)}...`);
            } else {
                console.log(`[pullUserState] Fetching ${key} (no specific local ETag)`);
            }

            const response = await fetch(url, { method: 'GET', headers: headers });

            if (response.status === 304) {
                console.log(`[pullUserState] User state for key ${key}: No changes (304 Not Modified).`);
                
                // If 304, update the newestOverallTimestamp based on the ETag that caused 304,
                // as that's the latest confirmed sync time for this item.
                if (localTimestamp && (!newestOverallTimestamp || localTimestamp > newestOverallTimestamp)) {
                    newestOverallTimestamp = localTimestamp;
                }
                return { key, status: 304 };
            }

            if (!response.ok) {
                if (response.status === 404) {
                    console.warn(`[pullUserState] User state key ${key} not found on server (404). Using client default.`);
                    // If server 404s, it implies the file might not exist or was deleted.
                    // We can optionally clear the local state for this key and its timestamp
                    // so it gets re-initialized next time, or just rely on local default.
                    // For now, let's just log and continue, client's default will be used.
                    // (Consider adding a clearLocalState(db, key) function if needed)
                    return { key, status: 404 };
                }
                throw new Error(`HTTP error! status: ${response.status} for ${key}`);
            }

            const data = await response.json(); // Data will be { "value": ..., "lastModified": "..." }
            console.log(`[pullUserState] Received new data for key ${key}:`, data);

            // Determine which stores are involved in the transaction for this key
            const transactionStores = [def.store]; // Always include the primary store for data
            if (def.store !== 'userSettings') { 
                // If the data is NOT in 'userSettings' (i.e., it's an array type like starredItems),
                // then we *also* need to include 'userSettings' in the transaction to save its timestamp.
                transactionStores.push('userSettings'); 
            }
            const tx = db.transaction(transactionStores, 'readwrite');

            // Store the value based on its type definition and update its timestamp in userSettings
            if (def.type === 'array') {
                // saveArrayState will handle saving the array data AND its timestamp in 'userSettings'
                await saveArrayState(db, key, data.value || def.default, data.lastModified, tx);
            } else { // simple type (def.store is 'userSettings')
                // saveSimpleState already handles saving the simple value and its timestamp in 'userSettings'
                await saveSimpleState(db, key, data.value, data.lastModified, tx);
            }
            
            await tx.done; // Commit transaction for this key

            // Update the newest overall timestamp for 'lastStateSync'
            if (data.lastModified && (!newestOverallTimestamp || data.lastModified > newestOverallTimestamp)) {
                newestOverallTimestamp = data.lastModified;
            }

            return { key, data, status: 200 };

        } catch (error) {
            console.error(`[pullUserState] Failed to pull user state for key ${key}:`, error);
            return { key, data: null, status: 'error', error };
        }
    });

    await Promise.all(fetchPromises); // Wait for all individual fetches to complete

    // After all individual fetches, save the newest overall timestamp for global sync tracking
    // Only update if there was at least one successful pull that provided a timestamp
    if (newestOverallTimestamp) {
        await saveSimpleState(db, 'lastStateSync', newestOverallTimestamp);
        console.log(`[pullUserState] Updated global lastStateSync to: ${newestOverallTimestamp}`);
    } else {
        console.log('[pullUserState] No new overall timestamp found from server pull to update global lastStateSync.');
    }

    _isPullingUserState = false;
    console.log('[pullUserState] All user state pull operations completed.');
}


export async function pushUserState(db, keyToUpdate, valueToUpdate) {
    console.log(`[pushUserState] Attempting to push user state for key: ${keyToUpdate}`);
    const API_BASE_URL = window.location.origin;

    const def = USER_STATE_DEFS[keyToUpdate];
    if (!def) {
        console.error(`[pushUserState] Attempted to push unknown key: ${keyToUpdate}`);
        return false;
    }

    let url;
    let method = 'POST';
    let body;

    // Determine the correct endpoint and body format based on key type
    if (keyToUpdate === 'starred' || keyToUpdate === 'hidden') {
        // These keys use delta endpoints, not the generic POST /user-state for full array replacement.
        // Your UI should call pushStarredItemDelta or pushHiddenItemDelta directly for these.
        console.warn(`[pushUserState] Cannot use generic push for delta-managed key: ${keyToUpdate}. Use specific delta functions.`);
        return false;
    } else {
        url = `${API_BASE_URL}/user-state`; // Generic POST endpoint for simple key-value updates or full array replacements for non-delta types
        body = JSON.stringify({ key: keyToUpdate, value: valueToUpdate });
    }
    
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: body
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for ${keyToUpdate}`);
        }

        const data = await response.json(); // Should return { serverTime: '...' }
        if (data.serverTime) {
            // Update the local key's timestamp and the global lastStateSync
            // saveSimpleState for the keyToUpdate will handle setting its new timestamp in 'userSettings'
            await saveSimpleState(db, keyToUpdate, valueToUpdate, data.serverTime); // Update specific key's value and timestamp
            
            // Only update global lastStateSync if the pushed item's serverTime is newer
            const { value: currentLastStateSync } = await loadSimpleState(db, 'lastStateSync');
            if (!currentLastStateSync || data.serverTime > currentLastStateSync) {
                await saveSimpleState(db, 'lastStateSync', data.serverTime); // Update global timestamp
            }
        }
        console.log(`[pushUserState] Successfully pushed ${keyToUpdate}. Server response:`, data);
        return true;
    } catch (error) {
        console.error(`[pushUserState] Failed to push user state for key ${keyToUpdate}:`, error);
        return false;
    }
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
    // const { value: lastStateSyncTime } = await loadSimpleState(db, 'lastStateSync');
    // await performFeedSync(app, lastStateSyncTime);
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