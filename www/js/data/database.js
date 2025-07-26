// database.js
// This file manages IndexedDB interactions and synchronization with the server.

import { openDB } from '../libs/idb.js';

// --- IndexedDB Configuration ---
const DB_NAME = 'not-the-news-db';
const DB_VERSION = 6; // *** IMPORTANT: Increment DB_VERSION for schema changes ***

export let db = null; // Will hold the IndexedDB instance

// Define schema for object stores
const OBJECT_STORES_SCHEMA = [
    { name: 'feedItems', keyPath: 'guid', options: { unique: true } },
    { name: 'starredItems', keyPath: 'id' }, // Stores { id: 'guid', starredAt: 'ISOString' }
    { name: 'hiddenItems', keyPath: 'id' },  // Stores { id: 'guid', hiddenAt: 'ISOString' }
    { name: 'currentDeckGuids', keyPath: 'id' }, // *** NEW: Dedicated store for current deck GUIDs ***
    { name: 'userSettings', keyPath: 'key' } // Stores { key: 'settingName', value: 'settingValue', lastModified: 'timestamp' }
];

// --- User State Definitions (Maps server keys to client IndexedDB storage) ---
// This is crucial for the new pull/pushUserState logic.
export const USER_STATE_DEFS = {
    // Array-based states stored in their own dedicated object stores
    starred: { store: 'starredItems', type: 'array', default: [] },
    hidden: { store: 'hiddenItems', type: 'array', default: [] },
    currentDeckGuids: { store: 'currentDeckGuids', type: 'array', default: [] }, // *** UPDATED: Now an array type ***

    // Simple value states stored in the 'userSettings' object store
    filterMode: { store: 'userSettings', type: 'simple', default: 'all' },
    syncEnabled: { store: 'userSettings', type: 'simple', default: true },
    imagesEnabled: { store: 'userSettings', type: 'simple', default: true },
    rssFeeds: { store: 'userSettings', type: 'simple', default: [] }, // Assuming this is an array of feed URLs
    keywordBlacklist: { store: 'userSettings', type: 'simple', default: [] }, // Assuming this is an array of strings
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

// --- Client-Server Synchronization Functions ---

let _isPullingUserState = false; // Prevent multiple concurrent pulls
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500; // Minimum time between pull attempts

/**
 * Pulls individual user state data from the server and updates IndexedDB.
 */
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

    // Get the global lastStateSync from IndexedDB to use for If-None-Match header
    const { value: currentLastStateSync } = await loadSimpleState(db, 'lastStateSync');
    let newestOverallTimestamp = currentLastStateSync;

    const fetchPromises = Object.entries(USER_STATE_DEFS).map(async ([key, def]) => {
        // Skip 'lastStateSync' itself from being fetched as a user state key, as it's client-managed from other keys.
        if (key === 'lastStateSync') return { key, status: 'skipped' };

        const url = `${API_BASE_URL}/user-state/${key}`;
        let localTimestamp = '';
        
        // For individual keys, we load their lastModified from the userSettings store (if it's a simple type)
        // or from the global lastStateSync if a specific key timestamp isn't tracked individually.
        // The most robust way is to store each key's `lastModified` as a separate simple setting.
        const keySpecificState = await loadSimpleState(db, key); // For simple types, this gets value and lastModified
        if (keySpecificState && keySpecificState.lastModified) {
            localTimestamp = keySpecificState.lastModified;
        } else if (def.type === 'array') { // For array types, we fetch the whole array and update based on server's timestamp
            // If arrays don't have individual lastModified saved in userSettings, use global lastStateSync
            localTimestamp = currentLastStateSync || ''; // Use global sync time as ETag for array if no specific one
        }

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
                return { key, status: 304 };
            }

            if (!response.ok) {
                if (response.status === 404) {
                    console.warn(`[pullUserState] User state key ${key} not found on server (404). Using client default.`);
                    // Optionally, if a 404 means the server has deleted it, you might clear local state.
                    // For now, we'll let existing local data persist unless explicitly synced empty.
                    return { key, status: 404 };
                }
                throw new Error(`HTTP error! status: ${response.status} for ${key}`);
            }

            const data = await response.json(); // Data will be { "value": ..., "lastModified": "..." }
            console.log(`[pullUserState] Received new data for key ${key}:`, data);

            const tx = db.transaction(def.store, 'readwrite');

            // Store the value based on its type definition
            if (def.type === 'array') {
                await saveArrayState(db, key, data.value || def.default, data.lastModified, tx);
            } else { // simple type
                await saveSimpleState(db, key, data.value, data.lastModified, tx);
            }
            
            // For simple types, also explicitly save the lastModified timestamp with the key itself
            // in the 'userSettings' store. This allows individual ETag lookups later.
            // For array types, their lastModified from server *is* the ETag for that resource.
            // If the array's lastModified is not used to update the key-specific timestamp,
            // then only the global lastStateSync will drive array updates, which is fine if desired.
            if (data.lastModified) {
                // If it's a simple setting, its lastModified is saved with its own entry.
                // If it's an array type, we save its lastModified under its key in userSettings for ETag.
                if (def.type === 'simple') {
                    await saveSimpleState(db, key, data.value, data.lastModified, tx);
                } else if (def.type === 'array') {
                    // For arrays, store their lastModified in userSettings under their key
                    // to support individual ETag checks. The 'value' here is just a placeholder.
                    await saveSimpleState(db, key, null, data.lastModified, tx); // Value null/placeholder, only timestamp matters for ETag
                }
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
    if (newestOverallTimestamp) {
        await saveSimpleState(db, 'lastStateSync', newestOverallTimestamp);
        console.log(`[pullUserState] Updated global lastStateSync to: ${newestOverallTimestamp}`);
    } else {
        console.log('[pullUserState] No new overall timestamp found from server pull.');
    }

    _isPullingUserState = false;
    console.log('[pullUserState] All user state pull operations completed.');
}


/**
 * Pushes a single user state key-value pair to the server.
 * @param {IDBDatabase} db The IndexedDB instance.
 * @param {string} keyToUpdate The key of the user state to update (e.g., 'filterMode', 'currentDeckGuids').
 * @param {any} valueToUpdate The new value for that state key.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
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
            await saveSimpleState(db, keyToUpdate, valueToUpdate, data.serverTime); // Update specific key's value and timestamp
            await saveSimpleState(db, 'lastStateSync', data.serverTime); // Update global timestamp
        }
        console.log(`[pushUserState] Successfully pushed ${keyToUpdate}. Server response:`, data);
        return true;
    } catch (error) {
        console.error(`[pushUserState] Failed to push user state for key ${keyToUpdate}:`, error);
        return false;
    }
}

// --- Specific API Calls (for delta updates) ---
// These remain as direct calls from your UI where a specific item is added/removed.
export async function pushStarredItemDelta(id, action, timestamp) {
    console.log(`[pushStarredItemDelta] ID: ${id}, Action: ${action}`);
    const API_BASE_URL = window.location.origin;
    const url = `${API_BASE_URL}/user-state/starred/delta`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, action: action, starredAt: timestamp })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for starred delta`);
        }
        const data = await response.json();
        if (data.serverTime) {
            // Update the local 'starred' state in IndexedDB (re-fetch or update directly)
            // For delta operations, we usually rely on the next pull to reconcile the full array.
            // Or, you could manually add/remove from IndexedDB here.
            await saveSimpleState(db, 'lastStateSync', data.serverTime); // Update global timestamp
            // Also update the starred's own lastModified timestamp if you track it separately:
            // await saveSimpleState(db, 'starred', null, data.serverTime);
        }
        console.log(`[pushStarredItemDelta] Success. Server response:`, data);
        return true;
    } catch (error) {
        console.error(`[pushStarredItemDelta] Failed:`, error);
        return false;
    }
}

export async function pushHiddenItemDelta(id, action, timestamp) {
    console.log(`[pushHiddenItemDelta] ID: ${id}, Action: ${action}`);
    const API_BASE_URL = window.location.origin;
    const url = `${API_BASE_URL}/user-state/hidden/delta`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, action: action, hiddenAt: timestamp })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for hidden delta`);
        }
        const data = await response.json();
        if (data.serverTime) {
            await saveSimpleState(db, 'lastStateSync', data.serverTime); // Update global timestamp
            // await saveSimpleState(db, 'hidden', null, data.serverTime);
        }
        console.log(`[pushHiddenItemDelta] Success. Server response:`, data);
        return true;
    } catch (error) {
        console.error(`[pushHiddenItemDelta] Failed:`, error);
        return false;
    }
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