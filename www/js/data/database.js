// www/js/data/database.js

import { openDB } from '../libs/idb.js';

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 7;

let _dbInstance = null;
let _dbInitPromise = null;

const OBJECT_STORES_SCHEMA = [
    { name: 'feedItems', keyPath: 'guid', options: { unique: true } },
    { name: 'starredItems', keyPath: 'id' },
    { name: 'hiddenItems', keyPath: 'id' },
    { name: 'currentDeckGuids', keyPath: 'id' },
    { name: 'userSettings', keyPath: 'key' },
    { name: 'pendingOperations', keyPath: 'id', options: { autoIncrement: true } }
];

export const USER_STATE_DEFS = {
    starred: { store: 'starredItems', type: 'array', default: [] },
    hidden: { store: 'hiddenItems', type: 'array', default: [] },
    currentDeckGuids: { store: 'currentDeckGuids', type: 'array', default: [] },

    filterMode: { store: 'userSettings', type: 'simple', default: 'all' },
    syncEnabled: { store: 'userSettings', type: 'simple', default: true },
    imagesEnabled: { store: 'userSettings', type: 'simple', default: true },
    rssFeeds: { store: 'userSettings', type: 'simple', default: [] },
    keywordBlacklist: { store: 'userSettings', type: 'simple', default: [] },
    shuffleCount: { store: 'userSettings', type: 'simple', default: 0 },
    lastShuffleResetDate: { store: 'userSettings', type: 'simple', default: null },
    openUrlsInNewTabEnabled: { store: 'userSettings', type: 'simple', default: true },
    lastViewedItemId: { store: 'userSettings', type: 'simple', default: null },
    lastViewedItemOffset: { store: 'userSettings', type: 'simple', default: 0 },
    lastStateSync: { store: 'userSettings', type: 'simple', default: null },
    // --- ADDED ---
    theme: { store: 'userSettings', type: 'simple', default: 'light' },
    lastFeedSync: { store: 'userSettings', type: 'simple', default: null },
    feedScrollY: { store: 'userSettings', type: 'simple', default: 0 }, // Assuming numerical scroll position
    feedVisibleLink: { store: 'userSettings', type: 'simple', default: '' } // Assuming string URL/ID for visible link
    // --- /ADDED ---
};

export async function initDb() {
    if (_dbInitPromise) return _dbInitPromise;
    _dbInitPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion) { // Removed 'transaction' as it's not directly used in modern idb
            console.log(`[IndexedDB] Upgrading DB from version ${oldVersion} to ${newVersion}`);
            
            OBJECT_STORES_SCHEMA.forEach(schema => {
                if (!db.objectStoreNames.contains(schema.name)) {
                    db.createObjectStore(schema.name, { keyPath: schema.keyPath, ...schema.options });
                    console.log(`[IndexedDB] Created object store: ${schema.name}`);
                }
            });

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
    _dbInstance = await _dbInitPromise;
    console.log(`[IndexedDB] Database '${DB_NAME}' opened, version ${DB_VERSION}`);
    return _dbInstance;
}

export async function getDb() {
    if (!_dbInstance) {
        await initDb();
    }
    return _dbInstance;
}

export async function loadSimpleState(db, key, tx = null) {
    const def = USER_STATE_DEFS[key];
    if (!def) {
        console.error(`[loadSimpleState] Invalid or undefined state key: ${key}.`);
        return { value: null, lastModified: null };
    }
    
    const storeName = 'userSettings';

    let transaction;
    try {
        transaction = tx || db.transaction(storeName, 'readonly');
        const data = await transaction.objectStore(storeName).get(key);
        if (data && data.hasOwnProperty('value')) {
            return { value: data.value, lastModified: data.lastModified || null };
        }
    } catch (e) {
        console.error(`[loadSimpleState] Error loading ${key} from store ${storeName}:`, e);
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                // Ignore AbortError if transaction was explicitly aborted elsewhere
                if (e.name !== 'AbortError') {
                    console.error(`[loadSimpleState] Transaction.done error for ${key}:`, e);
                }
            }
        }
    }
    return { value: def.default, lastModified: null };
}

export async function saveSimpleState(db, key, value, serverTimestamp = null, tx = null) {
    const def = USER_STATE_DEFS[key];
    if (!def) {
        console.error(`[saveSimpleState] Invalid or undefined state key: ${key}.`);
        throw new Error(`Invalid or undefined state key: ${key}`);
    }
    
    const storeName = 'userSettings';

    let transaction;
    try {
        transaction = tx || db.transaction(storeName, 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        
        const objToSave = { key: key, value: value };
        if (serverTimestamp) {
            objToSave.lastModified = serverTimestamp;
        } else {
            objToSave.lastModified = new Date().toISOString(); 
        }

        await objectStore.put(objToSave);
        console.log(`[saveSimpleState] Saved "${key}" to store "${storeName}". Value:`, value);
    } catch (e) {
        console.error(`[saveSimpleState] Error saving "${key}" to store "${storeName}":`, e);
        throw e;
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(`[saveSimpleState] Transaction.done error for ${key}:`, e);
                }
            }
        }
    }
}

export async function loadArrayState(db, key, tx = null) {
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'array') {
        console.error(`[loadArrayState] Invalid or undefined array state key: ${key}`);
        return { value: def ? def.default : [], lastModified: null };
    }
    const arrayStoreName = def.store;

    let transaction;
    try {
        transaction = tx || db.transaction([arrayStoreName, 'userSettings'], 'readonly'); 
        const arrayStore = transaction.objectStore(arrayStoreName);
        const allItems = await arrayStore.getAll();
        
        const { lastModified: arrayTimestamp } = await loadSimpleState(db, key, transaction); 

        return { value: allItems, lastModified: arrayTimestamp }; 
    } catch (e) {
        console.error(`[loadArrayState] Error loading ${key} from store ${arrayStoreName}:`, e);
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(`[loadArrayState] Transaction.done error for ${key}:`, e);
                }
            }
        }
    }
    return { value: def.default, lastModified: null };
}

export async function saveArrayState(db, key, arr, serverTimestamp = null, tx = null) {
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'array') {
        console.error(`[saveArrayState] Invalid or undefined array state key: ${key}`);
        throw new Error(`Invalid or undefined array state key: ${key}`);
    }
    const arrayStoreName = def.store;

    let transaction;
    try {
        transaction = tx || db.transaction([arrayStoreName, 'userSettings'], 'readwrite'); 
        const arrayObjectStore = transaction.objectStore(arrayStoreName);
        
        await arrayObjectStore.clear();

        const clonableArr = JSON.parse(JSON.stringify(arr));
        
        for (const item of clonableArr) {
            const itemToStore = (key === 'currentDeckGuids' && typeof item === 'string') 
                               ? { id: item } 
                               : item;
            await arrayObjectStore.put(itemToStore);
        }
        
        console.log(`[saveArrayState] Saved ${clonableArr.length} items for "${key}" to store "${arrayStoreName}".`);

        await saveSimpleState(db, key, null, serverTimestamp, transaction); 

    } catch (e) {
        console.error(`[saveArrayState] Error saving "${key}" to store "${arrayStoreName}":`, e);
        throw e;
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(`[saveArrayState] Transaction.done error for ${key}:`, e);
                }
            }
        }
    }
}

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

export async function processPendingOperations(db) {
    if (!isOnline()) {
        console.log('[processPendingOperations] Offline. Skipping sync.');
        return;
    }

    // --- CHANGED: Fetch all operations, but do NOT open a transaction yet. ---
    let operations;
    try {
        const fetchTx = db.transaction('pendingOperations', 'readonly');
        operations = await fetchTx.objectStore('pendingOperations').getAll();
        await fetchTx.done;
    } catch (e) {
        console.error('[processPendingOperations] Error fetching pending operations:', e);
        return;
    }

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
                const endpoint = op.type === 'starDelta' ? 'starred/delta' : 'hidden/delta';
                const response = await fetch(`${API_BASE_URL}/user-state/${endpoint}`, {
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
                success = await pushUserState(db, op.key, op.value); 
            } else {
                console.warn(`[processPendingOperations] Unknown operation type: ${op.type}. Skipping.`);
                success = true;
            }

            if (success) {
                // --- CHANGED: Delete in a new, dedicated transaction for each operation ---
                try {
                    const deleteTx = db.transaction('pendingOperations', 'readwrite');
                    await deleteTx.objectStore('pendingOperations').delete(op.id);
                    await deleteTx.done;
                    console.log(`[processPendingOperations] Removed buffered operation ${op.id} (${op.type})`);
                } catch (deleteError) {
                    console.error(`[processPendingOperations] Error deleting operation ${op.id} (${op.type}) from buffer:`, deleteError);
                    // This is a rare case, but we should not re-add to buffer if sync was success
                    // The operation will remain in buffer but won't be re-processed.
                }
            }
        } catch (error) {
            console.error(`[processPendingOperations] Failed to sync operation ${op.id} (${op.type}). Keeping in buffer:`, error);
            // Break the loop if an error occurs to prevent continuous retries on failed operations
            // or if the network is down. The next call will attempt from remaining operations.
            break; 
        }
    }
    // No await tx.done here because the main transaction was removed.
    console.log('[processPendingOperations] Finished processing pending operations.');
}

export async function getBufferedChangesCount() {
    const db = await getDb();
    try {
        const tx = db.transaction('pendingOperations', 'readonly');
        const store = tx.objectStore('pendingOperations');
        const count = await store.count();
        await tx.done;
        return count;
    } catch (e) {
        console.error('[getBufferedChangesCount] Error getting pending operations count:', e);
        return 0;
    }
}

export function isOnline() {
    return navigator.onLine;
}

let _isPullingUserState = false;
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500;

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

    let newestOverallTimestamp = null;

    const fetchPromises = Object.entries(USER_STATE_DEFS).map(async ([key, def]) => {
        if (key === 'lastStateSync' || key === 'lastFeedSync' || key === 'feedScrollY' || key === 'feedVisibleLink') {
            // These keys are managed client-side or by specific feed sync.
            // They don't have direct server-side counterparts for individual pull in this loop.
            return { key, status: 'skipped' };
        }

        const url = `${API_BASE_URL}/user-state/${key}`;
        let localTimestamp = '';
        
        const { lastModified } = await loadSimpleState(db, key);
        localTimestamp = lastModified || '';
        
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
                
                if (localTimestamp && (!newestOverallTimestamp || localTimestamp > newestOverallTimestamp)) {
                    newestOverallTimestamp = localTimestamp;
                }
                return { key, status: 304 };
            }

            if (!response.ok) {
                if (response.status === 404) {
                    console.warn(`[pullUserState] User state key ${key} not found on server (404). Using client default.`);
                    return { key, status: 404 };
                }
                throw new Error(`HTTP error! status: ${response.status} for ${key}`);
            }

            const data = await response.json();
            console.log(`[pullUserState] Received new data for key ${key}:`, data);

            const transactionStores = [def.store];
            if (def.store !== 'userSettings') { 
                transactionStores.push('userSettings'); 
            }
            const tx = db.transaction(transactionStores, 'readwrite');

            if (def.type === 'array') {
                await saveArrayState(db, key, data.value || def.default, data.lastModified, tx);
            } else {
                await saveSimpleState(db, key, data.value, data.lastModified, tx);
            }
            
            await tx.done;

            if (data.lastModified && (!newestOverallTimestamp || data.lastModified > newestOverallTimestamp)) {
                newestOverallTimestamp = data.lastModified;
            }

            return { key, data, status: 200 };

        } catch (error) {
            console.error(`[pullUserState] Failed to pull user state for key ${key}:`, error);
            return { key, data: null, status: 'error', error };
        }
    });

    await Promise.all(fetchPromises);

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

    if (keyToUpdate === 'starred' || keyToUpdate === 'hidden') {
        console.warn(`[pushUserState] Cannot use generic push for delta-managed key: ${keyToUpdate}. Use specific delta functions.`);
        return false;
    } else {
        url = `${API_BASE_URL}/user-state`;
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

        const data = await response.json();
        if (data.serverTime) {
            await saveSimpleState(db, keyToUpdate, valueToUpdate, data.serverTime);
            
            const { value: currentLastStateSync } = await loadSimpleState(db, 'lastStateSync');
            if (!currentLastStateSync || data.serverTime > currentLastStateSync) {
                await saveSimpleState(db, 'lastStateSync', data.serverTime);
            }
        }
        console.log(`[pushUserState] Successfully pushed ${keyToUpdate}. Server response:`, data);
        return true;
    } catch (error) {
        console.error(`[pushUserState] Failed to push user state for key ${keyToUpdate}:`, error);
        return false;
    }
}

// --- NEW/UPDATED: Implementation for performFeedSync ---
export async function performFeedSync(app) {
    const db = await getDb();
    if (!isOnline()) {
        console.log('[performFeedSync] Offline. Skipping feed sync.');
        return;
    }

    console.log('[performFeedSync] Fetching latest feed items from server.');
    const API_BASE_URL = window.location.origin;

    try {
        // 1. Get local lastFeedSync timestamp
        const { value: lastFeedSyncTime } = await loadSimpleState(db, 'lastFeedSync');
        const sinceTimestamp = lastFeedSyncTime || '';

        // 2. Fetch new and updated GUIDs from server
        const guidsResponse = await fetch(`${API_BASE_URL}/feed-guids?since=${sinceTimestamp}`);
        if (!guidsResponse.ok) {
            throw new Error(`HTTP error! status: ${guidsResponse.status} for /feed-guids`);
        }
        const guidsData = await guidsResponse.json();
        const serverGuids = new Set(guidsData.guids); // GUIDs currently on the server
        const serverTime = guidsData.serverTime; // Server's current time, use for lastFeedSync

        // 3. Get existing local GUIDs and identify items to delete/update
        const localItems = await db.transaction('feedItems', 'readonly').objectStore('feedItems').getAll();
        const localGuids = new Set(localItems.map(item => item.guid));

        const guidsToFetch = [];
        const guidsToDelete = [];

        for (const localGuid of localGuids) {
            if (!serverGuids.has(localGuid)) {
                guidsToDelete.push(localGuid);
            }
        }
        for (const serverGuid of serverGuids) {
            if (!localGuids.has(serverGuid)) {
                guidsToFetch.push(serverGuid);
            }
        }

        console.log(`[performFeedSync] New/updated GUIDs to fetch: ${guidsToFetch.length}`);
        console.log(`[performFeedSync] GUIDs to delete locally: ${guidsToDelete.length}`);

        // 4. Fetch full data for new/updated GUIDs in batches
        const BATCH_SIZE = 50; // Adjust as needed
        for (let i = 0; i < guidsToFetch.length; i += BATCH_SIZE) {
            const batch = guidsToFetch.slice(i, i + BATCH_SIZE);
            const itemsResponse = await fetch(`${API_BASE_URL}/feed-items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guids: batch })
            });

            if (!itemsResponse.ok) {
                console.error(`[performFeedSync] HTTP error! status: ${itemsResponse.status} for /feed-items batch. Skipping batch.`);
                continue; // Skip this batch but continue with others
            }
            const newItems = await itemsResponse.json();
            
            // Store new/updated items and delete old ones in a single transaction
            const tx = db.transaction(['feedItems'], 'readwrite');
            const feedStore = tx.objectStore('feedItems');

            for (const item of newItems) {
                await feedStore.put(item); // .put() handles both add and update
            }
            console.log(`[performFeedSync] Stored ${newItems.length} new/updated feed items.`);
            
            for (const guidToDelete of guidsToDelete) {
                // Ensure only items that were actually in the original guidsToDelete are processed
                // (in case a guid was updated and fetched, preventing accidental deletion)
                if (!new Set(newItems.map(i => i.guid)).has(guidToDelete)) {
                    await feedStore.delete(guidToDelete);
                }
            }
            console.log(`[performFeedSync] Deleted ${guidsToDelete.length} obsolete feed items.`);

            await tx.done; // Commit transaction
        }

        // 5. Update lastFeedSync timestamp
        if (serverTime) {
            await saveSimpleState(db, 'lastFeedSync', serverTime);
            console.log(`[performFeedSync] Updated lastFeedSync to: ${serverTime}`);
        }

        // --- Important: Trigger UI update after sync ---
        if (app && app.loadFeedItemsFromDB) {
            await app.loadFeedItemsFromDB(); // Assuming app has this method to reload data
        }
        if (app && app.updateCounts) {
            app.updateCounts();
        }

        // You might have a global status bar function
        // if (typeof createStatusBarMessage === 'function') {
        //     createStatusBarMessage('Feed synced!', 'success');
        // }

        console.log('[performFeedSync] Feed synchronization completed.');

    } catch (error) {
        console.error('[performFeedSync] Failed to synchronize feed:', error);
        // if (typeof createStatusBarMessage === 'function') {
        //     createStatusBarMessage('Feed sync failed!', 'error');
        // }
    }
}

// --- UPDATED: Implementation for performFullSync ---
export async function performFullSync(app) {
    console.log('[performFullSync] Initiating full synchronization (feed + user state).');
    const db = await getDb();
    try {
        await pullUserState(db); // First, pull user state
        await performFeedSync(app); // Then, pull feed items
        // if (typeof createStatusBarMessage === 'function') {
        //     createStatusBarMessage('Full sync complete!', 'success');
        // }
        console.log('[performFullSync] Full synchronization completed successfully.');
    } catch (error) {
        console.error('[performFullSync] Full synchronization failed:', error);
        // if (typeof createStatusBarMessage === 'function') {
        //     createStatusBarMessage('Full sync failed!', 'error');
        // }
    }
}

export async function getStarredItems() {
    const db = await getDb();
    const { value } = await loadArrayState(db, 'starred');
    return value;
}

export async function getHiddenItems() {
    const db = await getDb();
    const { value } = await loadArrayState(db, 'hidden');
    return value;
}

export async function getCurrentDeckGuids() {
    const db = await getDb();
    const { value } = await loadArrayState(db, 'currentDeckGuids');
    return value.map(item => item.id);
}

export async function getFilterMode() {
    const db = await getDb();
    const { value } = await loadSimpleState(db, 'filterMode');
    return value;
}

export async function getSyncEnabled() {
    const db = await getDb();
    const { value } = await loadSimpleState(db, 'syncEnabled');
    return value;
}

export async function getImagesEnabled() {
    const db = await getDb();
    const { value } = await loadSimpleState(db, 'imagesEnabled');
    return value;
}
export async function getRssFeeds() {
    const db = await getDb();
    const { value } = await loadSimpleState(db, 'rssFeeds');
    return value;
}
export async function getKeywordBlacklist() {
    const db = await getDb();
    const { value } = await loadSimpleState(db, 'keywordBlacklist');
    return value;
}
export async function getShuffleCount() {
    const db = await getDb();
    const { value } = await loadSimpleState(db, 'shuffleCount');
    return value;
}
export async function getLastShuffleResetDate() {
    const db = await getDb();
    const { value } = await loadSimpleState(db, 'lastShuffleResetDate');
    return value;
}
export async function getOpenUrlsInNewTabEnabled() {
    const db = await getDb();
    const { value } = await loadSimpleState(db, 'openUrlsInNewTabEnabled');
    return value;
}

export async function getLastViewedItemId() {
    const db = await getDb();
    const { value } = await loadSimpleState(db, 'lastViewedItemId');
    return value;
}

export async function getLastViewedItemOffset() {
    const db = await getDb();
    const { value } = await loadSimpleState(db, 'lastViewedItemOffset');
    return value;
}