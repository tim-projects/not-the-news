// www/js/data/database.js

import { openDB } from '../libs/idb.js';

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 11; // Increment DB_VERSION

let _dbInstance = null;
let _dbInitPromise = null;

const OBJECT_STORES_SCHEMA = [
    { name: 'feedItems', keyPath: 'guid', options: { unique: true } },
    { name: 'starredItems', options: { keyPath: 'id' } },
    { name: 'hiddenItems', options: { keyPath: 'id' } },
    { name: 'currentDeckGuids', keyPath: 'id' },
    { name: 'shuffledOutGuids', keyPath: 'id' }, // Add shuffledOutGuids Object Store
    { name: 'userSettings', keyPath: 'key' },
    { name: 'pendingOperations', keyPath: 'id', options: { autoIncrement: true } }
];

export const USER_STATE_DEFS = {
    starred: { store: 'starredItems', type: 'array', default: [] },
    hidden: { store: 'hiddenItems', type: 'array', default: [] },
    currentDeckGuids: { store: 'currentDeckGuids', type: 'array', default: [] },
    shuffledOutGuids: { store: 'shuffledOutGuids', type: 'array', default: [] }, // Add shuffledOutGuids to USER_STATE_DEFS

    filterMode: { store: 'userSettings', type: 'simple', default: 'all' },
    syncEnabled: { store: 'userSettings', type: 'simple', default: true },
    imagesEnabled: { store: 'userSettings', type: 'simple', default: true },
    rssFeeds: { store: 'userSettings', type: 'simple', default: [] },
    keywordBlacklist: { store: 'userSettings', type: 'simple', default: [] },
    shuffleCount: { store: 'userSettings', type: 'simple', default: 2 },
    lastShuffleResetDate: { store: 'userSettings', type: 'simple', default: null },
    openUrlsInNewTabEnabled: { store: 'userSettings', type: 'simple', default: true },
    lastViewedItemId: { store: 'userSettings', type: 'simple', default: null },
    lastStateSync: { store: 'userSettings', type: 'simple', default: null },
    theme: { store: 'userSettings', type: 'simple', default: 'light' },
    lastFeedSync: { store: 'userSettings', type: 'simple', default: null },
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

export async function loadSimpleState(key, tx = null) {
    const db = await getDb(); // ADDED
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

export async function saveSimpleState(key, value, serverTimestamp = null, tx = null) {
    const db = await getDb(); // ADDED
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
        // --- NEW/UPDATED: Add to pending operations for specific simple states that need server sync ---
        // These keys are managed as simple updates on the server
        if (['filterMode', 'syncEnabled', 'imagesEnabled', 'shuffleCount', 'lastShuffleResetDate', 'openUrlsInNewTabEnabled', 'lastViewedItemId', 'lastViewedItemOffset', 'theme'].includes(key)) {
            const op = { type: 'simpleUpdate', key: key, value: value };
            await queueAndAttemptSyncOperation(op); // Use the new unified queueing/sync function
        }
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

export async function loadArrayState(key, tx = null) {
    const db = await getDb(); // ADDED
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

        const { lastModified: arrayTimestamp } = await loadSimpleState(key, transaction); // db param removed here

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

export async function saveArrayState(key, arr, serverTimestamp = null, tx = null) {
    const db = await getDb(); // ADDED
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'array') {
        console.error(`[saveArrayState] Invalid or undefined array state key: ${key}`);
        throw new Error(`Invalid or undefined array state key: ${key}`);
    }
    const arrayStoreName = def.store;

    let transaction;
    try {
        transaction = tx || db.transaction([arrayStoreName, 'userSettings', 'pendingOperations'], 'readwrite');
        const arrayObjectStore = transaction.objectStore(arrayStoreName);

        await arrayObjectStore.clear();

        const clonableArr = JSON.parse(JSON.stringify(arr));

        for (const item of clonableArr) {
            const itemToStore = (key === 'currentDeckGuids' || key === 'shuffledOutGuids') && typeof item === 'string'
                               ? { id: item }
                               : item;
            await arrayObjectStore.put(itemToStore);
        }

        console.log(`[saveArrayState] Saved ${clonableArr.length} items for "${key}" to store "${arrayStoreName}".`);

        await saveSimpleState(key, null, serverTimestamp, transaction); // db param removed here

        // --- NEW/UPDATED: Add to pending operations for specific array states that need server sync ---
        // These keys are managed as full array replacements on the server
        if (['shuffledOutGuids', 'currentDeckGuids', 'rssFeeds', 'keywordBlacklist'].includes(key)) {
            const op = { type: 'simpleUpdate', key: key, value: Array.from(arr) };
            await queueAndAttemptSyncOperation(op); // Use the new unified queueing/sync function
        }

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

let _operationIdCounter = Date.now(); // Simple counter for unique IDs if autoIncrement not sufficient
export async function queueAndAttemptSyncOperation(operation) {
    const db = await getDb();

    // Assign a unique client-side ID for tracking, especially crucial for ops without natural IDs
    // and for reliable removal from pendingOperations store.
    if (operation.id === undefined) { // autoIncrement will assign, but client-side tracking benefits from a known ID
        operation.id = _operationIdCounter++; // Assign a temporary client-side ID
    }

    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    let generatedId = null;

    try {
        // Add the operation to IndexedDB. If autoIncrement is used, this returns the key.
        generatedId = await store.add(operation);
        // If the operation initially had no ID, update it with the IndexedDB assigned ID
        if (operation.id !== generatedId) {
            operation.id = generatedId;
        }
        await tx.done;
        console.log(`[queueAndAttemptSyncOperation] Operation buffered with ID: ${operation.id}`, operation);

        // Immediate sync attempt for starDelta/hiddenDelta if online
        if ((operation.type === 'starDelta' || operation.type === 'hiddenDelta') && isOnline()) {
            console.log(`[queueAndAttemptSyncOperation] Attempting immediate sync for ${operation.type} (ID: ${operation.id}).`);
            const API_BASE_URL = window.location.origin;

            try {
                const response = await fetch(`${API_BASE_URL}/api/user-state`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([operation]) // Send as an array containing one operation
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP error! status: ${response.status} for immediate ${operation.type} sync. Details: ${errorText}`);
                }

                const responseData = await response.json();
                const result = responseData.results ? responseData.results[0] : null;

                if (result && result.status === 'success') {
                    // If successfully synced, remove from pending operations
                    const deleteTx = db.transaction('pendingOperations', 'readwrite');
                    await deleteTx.objectStore('pendingOperations').delete(operation.id);
                    await deleteTx.done;
                    console.log(`[queueAndAttemptSyncOperation] Successfully synced and removed immediate operation ${operation.id} (${operation.type}) from buffer.`);
                    // Optionally update lastStateSync if the serverTime is new
                    if (responseData.serverTime) {
                        const { value: currentLastStateSync } = await loadSimpleState('lastStateSync');
                        if (!currentLastStateSync || responseData.serverTime > currentLastStateSync) {
                            await saveSimpleState('lastStateSync', responseData.serverTime);
                            console.log(`[queueAndAttemptSyncOperation] Updated global lastStateSync to: ${responseData.serverTime}`);
                        }
                    }
                } else {
                    console.warn(`[queueAndAttemptSyncOperation] Immediate sync for ${operation.type} (ID: ${operation.id}) reported non-success by server:`, result);
                    // Operation remains in buffer for batch sync
                }

            } catch (networkError) {
                console.error(`[queueAndAttemptSyncOperation] Network error during immediate sync for ${operation.type} (ID: ${operation.id}). Will retry with batch sync:`, networkError);
                // Operation remains in buffer for batch sync
            }
        } else if (!isOnline() && (operation.type === 'starDelta' || operation.type === 'hiddenDelta')) {
             console.log(`[queueAndAttemptSyncOperation] Offline. Buffering ${operation.type} (ID: ${operation.id}) for later batch sync.`);
        } else {
            console.log(`[queueAndAttemptSyncOperation] Buffering ${operation.type} (ID: ${operation.id}) for later batch sync.`);
        }

    } catch (e) {
        console.error('[queueAndAttemptSyncOperation] Error buffering operation:', e);
        throw e;
    }
}
export async function addPendingOperation(operation) {
    const db = await getDb(); // ADDED
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

export async function processPendingOperations() {
    const db = await getDb(); // ADDED and moved to the beginning

    if (!isOnline()) {
        console.log('[processPendingOperations] Offline. Skipping sync.');
        return;
    }

    let operations;
    try {
        // MOVED this block after db is acquired
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

    try {
        const operationsToSync = [];
        const idsToRemove = []; // Store IDs of operations that were successfully sent

        // Filter operations: Only include simpleUpdates, or starDelta/hiddenDelta that haven't been immediately synced
        for (const op of operations) {
            // If an operation doesn't have an ID (e.g., older buffered ops or a bug), skip it for removal tracking
            // and just include it in the batch.
            if (!op.id) {
                console.warn('[processPendingOperations] Found operation without an ID. It will be processed but cannot be individually tracked for removal:', op);
            }

            if (op.type === 'simpleUpdate' || op.type === 'starDelta' || op.type === 'hiddenDelta') {
                operationsToSync.push(op);
            } else {
                console.warn(`[processPendingOperations] Unknown operation type found during batching: ${op.type}. Skipping from batch.`, op);
            }
        }

        if (operationsToSync.length === 0) {
            console.log('[processPendingOperations] No operations to batch for server sync.');
            return;
        }

        console.log(`[processPendingOperations] Sending ${operationsToSync.length} batched operations to /api/user-state.`);

        const response = await fetch(`${API_BASE_URL}/api/user-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operationsToSync) // Send the full array of operations
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status} for /api/user-state batch sync. Details: ${errorText}`);
        }

        const responseData = await response.json();
        console.log('[processPendingOperations] Batch sync successful. Server response:', responseData);

        if (responseData.results && Array.isArray(responseData.results)) {
            const tx = db.transaction('pendingOperations', 'readwrite');
            const store = tx.objectStore('pendingOperations');

            for (const result of responseData.results) {
                if (result.status === 'success' && result.id !== undefined) { // Check for explicit undefined for autoIncrement keys
                    await store.delete(result.id);
                    console.log(`[processPendingOperations] Removed buffered operation ${result.id} (${result.opType})`);
                } else if (result.status === 'failed' || result.status === 'skipped') {
                    console.warn(`[processPendingOperations] Operation ${result.id} (${result.opType}) ${result.status}: ${result.reason || 'No specific reason provided.'}`);
                }
            }
            await tx.done; // Commit the delete transaction
        } else {
             console.warn('[processPendingOperations] Server response did not contain a valid "results" array.');
        }

        if (responseData.serverTime) {
            await saveSimpleState('lastStateSync', responseData.serverTime);
            console.log(`[processPendingOperations] Global lastStateSync updated to: ${responseData.serverTime}`);
        }

    } catch (error) {
        console.error('[processPendingOperations] Error during batch synchronization:', error);
        // Operations will remain in IndexedDB to be retried on next sync attempt.
    }
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

export async function pullUserState() {
    const db = await getDb(); // ADDED
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
        if (key === 'lastStateSync' || key === 'lastFeedSync' || key === 'feedScrollY' || key === 'feedVisibleLink' || key === 'itemsClearedCount') {
            // These keys are managed client-side or by specific feed sync.
            // They don't have direct server-side counterparts for individual pull in this loop.
            return { key, status: 'skipped' };
        }

        const url = `${API_BASE_URL}/api/user-state/${key}`;
        let localTimestamp = '';

        const { lastModified } = await loadSimpleState(key); // db param removed here
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
                await saveArrayState(key, data.value || def.default, data.lastModified, tx); // db param removed here
            } else {
                await saveSimpleState(key, data.value, data.lastModified, tx); // db param removed here
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
        await saveSimpleState('lastStateSync', newestOverallTimestamp); // db param removed here
        console.log(`[pullUserState] Updated global lastStateSync to: ${newestOverallTimestamp}`);
    } else {
        console.log('[pullUserState] No new overall timestamp found from server pull to update global lastStateSync.');
    }

    _isPullingUserState = false;
    console.log('[pullUserState] All user state pull operations completed.');
}

// The pushUserState function has been removed as per the instructions.

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
        const { value: lastFeedSyncTime } = await loadSimpleState('lastFeedSync');
        const sinceTimestamp = lastFeedSyncTime || '';

        // 2. Fetch new and updated GUIDs from server
        const guidsResponse = await fetch(`${API_BASE_URL}/api/feed-guids?since=${sinceTimestamp}`);
        if (!guidsResponse.ok) {
            throw new Error(`HTTP error! status: ${guidsResponse.status} for /api/feed-guids`);
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
            await saveSimpleState('lastFeedSync', serverTime);
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
        await pullUserState(); // db param removed here
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
    const { value } = await loadArrayState('starred');
    return value;
}

export async function getHiddenItems() {
    const db = await getDb();
    const { value } = await loadArrayState('hidden');
    return value;
}

export async function getCurrentDeckGuids() {
    const db = await getDb();
    const { value } = await loadArrayState('currentDeckGuids');
    return value.map(item => item.id);
}

export async function getShuffledOutGuids() {
    const db = await getDb();
    const { value } = await loadArrayState('shuffledOutGuids');
    return value.map(item => item.id);
}

export async function getFilterMode() {
    const db = await getDb();
    const { value } = await loadSimpleState('filterMode');
    return value;
}

export async function getSyncEnabled() {
    const db = await getDb();
    const { value } = await loadSimpleState('syncEnabled');
    return value;
}

export async function getImagesEnabled() {
    const db = await getDb();
    const { value } = await loadSimpleState('imagesEnabled');
    return value;
}
export async function getRssFeeds() {
    const db = await getDb();
    const { value } = await loadSimpleState('rssFeeds');
    return value;
}
export async function getKeywordBlacklist() {
    const db = await getDb();
    const { value } = await loadSimpleState('keywordBlacklist');
    return value;
}
export async function getShuffleCount() {
    const db = await getDb();
    const { value } = await loadSimpleState('shuffleCount');
    return value;
}
export async function getLastShuffleResetDate() {
    const db = await getDb();
    const { value } = await loadSimpleState('lastShuffleResetDate');
    return value;
}
export async function getOpenUrlsInNewTabEnabled() {
    const db = await getDb();
    const { value } = await loadSimpleState('openUrlsInNewTabEnabled');
    return value;
}

export async function getLastViewedItemId() {
    const db = await getDb();
    const { value } = await loadSimpleState('lastViewedItemId');
    return value;
}

export async function getLastViewedItemOffset() {
    const db = await getDb();
    const { value } = await loadSimpleState('lastViewedItemOffset');
    return value;
}

export async function getAllFeedItems() {
    const db = await getDb();
    const tx = db.transaction('feedItems', 'readonly');
    const store = tx.objectStore('feedItems');
    const items = await store.getAll();
    await tx.done;
    return items;
}

export async function getFeedItem(guid) {
    const db = await getDb();
    const tx = db.transaction('feedItems', 'readonly');
    const store = tx.objectStore('feedItems');
    const item = await store.get(guid);
    await tx.done;
    return item;
}

export async function addStarredItem(itemGuid) {
    const db = await getDb();
    try {
        const itemToStar = { id: itemGuid, starredAt: new Date().toISOString() };
        const tx = db.transaction('starredItems', 'readwrite');
        await tx.objectStore('starredItems').put(itemToStar);
        await tx.done;
        console.log(`[addStarredItem] Added ${itemGuid} to starredItems locally.`);

        // Queue and attempt immediate sync
        const op = { type: 'starDelta', data: { id: itemGuid, action: 'add', starredAt: itemToStar.starredAt } };
        await queueAndAttemptSyncOperation(op);

    } catch (e) {
        console.error(`[addStarredItem] Error adding ${itemGuid} to starredItems:`, e);
        throw e;
    }
}
export async function removeStarredItem(itemGuid) {
    const db = await getDb();
    try {
        const tx = db.transaction('starredItems', 'readwrite');
        await tx.objectStore('starredItems').delete(itemGuid);
        await tx.done;
        console.log(`[removeStarredItem] Removed ${itemGuid} from starredItems locally.`);

        // Queue and attempt immediate sync
        const op = { type: 'starDelta', data: { id: itemGuid, action: 'remove' } };
        await queueAndAttemptSyncOperation(op);

    } catch (e) {
        console.error(`[removeStarredItem] Error removing ${itemGuid} from starredItems:`, e);
        throw e;
    }
}
export async function addHiddenItem(itemGuid) {
    const db = await getDb();
    try {
        const itemToHide = { id: itemGuid, hiddenAt: new Date().toISOString() };
        const tx = db.transaction('hiddenItems', 'readwrite');
        await tx.objectStore('hiddenItems').put(itemToHide);
        await tx.done;
        console.log(`[addHiddenItem] Added ${itemGuid} to hiddenItems locally.`);

        // Queue and attempt immediate sync
        const op = { type: 'hiddenDelta', data: { id: itemGuid, action: 'add', timestamp: itemToHide.hiddenAt } };
        await queueAndAttemptSyncOperation(op);

    } catch (e) {
        console.error(`[addHiddenItem] Error adding ${itemGuid} to hiddenItems:`, e);
        throw e;
    }
}
export async function removeHiddenItem(itemGuid) {
    const db = await getDb();
    try {
        const tx = db.transaction('hiddenItems', 'readwrite');
        await tx.objectStore('hiddenItems').delete(itemGuid);
        await tx.done;
        console.log(`[removeHiddenItem] Removed ${itemGuid} from hiddenItems locally.`);

        // Queue and attempt immediate sync
        const op = { type: 'hiddenDelta', data: { id: itemGuid, action: 'remove' } };
        await queueAndAttemptSyncOperation(op);

    } catch (e) {
        console.error(`[removeHiddenItem] Error removing ${itemGuid} from hiddenItems:`, e);
        throw e;
    }
}