// @filepath: src/js/data/dbSyncOperations.js

// @refactor-directive
// Refactor JS: concise, modern, functional, same output.
/**
 * Handles all synchronization operations between the client-side IndexedDB and the server API.
 */

import { getDb, isOnline } from './dbCore.js';
import { loadSimpleState, saveSimpleState, saveArrayState, loadArrayState, USER_STATE_DEFS } from './dbUserState.js';

/**
 * Queues a user operation and attempts an immediate sync if online.
 * @param {object} operation - The operation object to queue and sync.
 */
export async function queueAndAttemptSyncOperation(operation) {
    const db = await getDb();

    // Defensive check to ensure the operation object is valid
    if (!operation || typeof operation.type !== 'string') {
        console.error("[DB] Invalid operation object received:", operation);
        return;
    }
    
    // Check for a null or undefined 'value' in simpleUpdate operations,
    // as this could be the source of the DataError in the pendingOperations store.
    if (operation.type === 'simpleUpdate' && (operation.value === null || operation.value === undefined)) {
        console.warn(`[DB] Skipping queuing 'simpleUpdate' for key '${operation.key}' due to a null or undefined value.`, operation);
        return;
    }

    if (operation.guid !== undefined) {
        console.warn("[DB] Operation destined for 'pendingOperations' has an unexpected 'guid' property. Removing it:", operation);
        delete operation.guid;
    }

    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    let generatedId = null;

    try {
        const opToStore = { ...operation };
        // The 'pendingOperations' store likely has a keyPath that is auto-incrementing
        // or has a key that is manually provided. Let's assume it's auto-incrementing.
        delete opToStore.id; // Ensure we are not trying to provide an 'id' for an auto-incrementing store.

        generatedId = await store.add(opToStore);
        operation.id = generatedId;

        await tx.done;
        console.log(`[DB] Operation buffered with ID: ${operation.id}`, operation);

        if ((operation.type === 'starDelta' || operation.type === 'hiddenDelta') && isOnline()) {
            console.log(`[DB] Attempting immediate sync for ${operation.type} (ID: ${operation.id}).`);
            const API_BASE_URL = window.location.origin;

            try {
                const response = await fetch(`${API_BASE_URL}/api/user-state`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([operation])
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP error! status: ${response.status} for immediate ${operation.type} sync. Details: ${errorText}`);
                }

                const responseData = await response.json();
                const result = responseData.results ? responseData.results[0] : null;

                if (result && result.status === 'success' && result.id !== undefined) {
                    const deleteTx = db.transaction('pendingOperations', 'readwrite');
                    await deleteTx.objectStore('pendingOperations').delete(operation.id);
                    await deleteTx.done;
                    console.log(`[DB] Successfully synced and removed immediate operation ${operation.id} (${operation.type}) from buffer.`);
                    if (responseData.serverTime) {
                        const { value: currentLastStateSync } = await loadSimpleState('lastStateSync');
                        if (!currentLastStateSync || responseData.serverTime > currentLastStateSync) {
                            await saveSimpleState('lastStateSync', responseData.serverTime);
                            console.log(`[DB] Updated lastStateSync to: ${responseData.serverTime}`);
                        }
                    }
                } else {
                    console.warn(`[DB] Immediate sync for ${operation.type} (ID: ${operation.id}) reported non-success by server:`, result);
                }

            } catch (networkError) {
                console.error(`[DB] Network error during immediate sync for ${operation.type} (ID: ${operation.id}). Will retry with batch sync:`, networkError);
            }
        } else if (!isOnline() && (operation.type === 'starDelta' || operation.type === 'hiddenDelta')) {
            console.log(`[DB] Offline. Buffering ${operation.type} (ID: ${operation.id}) for later batch sync.`);
        } else {
            console.log(`[DB] Buffering ${operation.type} (ID: ${operation.id}) for later batch sync.`);
        }

    } catch (e) {
        console.error('[DB] Error buffering operation:', e);
        throw e;
    }
}

/**
 * Adds a user operation to the pending operations buffer.
 * @param {object} operation - The operation object to add.
 */
export async function addPendingOperation(operation) {
    const db = await getDb();
    if (operation.guid !== undefined) {
        console.warn("[DB] Operation destined for 'pendingOperations' has an unexpected 'guid' property. Removing it:", operation);
        delete operation.guid;
    }

    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    try {
        const opToStore = { ...operation };
        delete opToStore.id;

        let generatedId = await store.add(opToStore);
        operation.id = generatedId;

        await tx.done;
        console.log('[DB] Operation buffered:', operation);
    } catch (e) {
        console.error('[DB] Error buffering operation:', e);
        throw e;
    }
}

/**
 * Processes all pending operations in the buffer and syncs them with the server.
 */
export async function processPendingOperations() {
    const db = await getDb();
    if (!isOnline()) {
        console.log('[DB] Offline. Skipping batch sync.');
        return;
    }
    let operations;
    try {
        const fetchTx = db.transaction('pendingOperations', 'readonly');
        operations = await fetchTx.objectStore('pendingOperations').getAll();
        await fetchTx.done;
    } catch (e) {
        console.error('[DB] Error fetching pending operations:', e);
        return;
    }
    if (operations.length === 0) {
        console.log('[DB] No pending operations.');
        return;
    }
    const API_BASE_URL = window.location.origin;

    try {
        const operationsToSync = [];
        for (const op of operations) {
            if (!op.id) {
                console.warn('[DB] Found operation without an ID (likely legacy data). It will be processed but cannot be individually tracked for removal from the client buffer by its ID:', op);
            }

            if (op.type === 'simpleUpdate' || op.type === 'starDelta' || op.type === 'hiddenDelta') {
                const opForSync = { ...op };
                if (opForSync.guid !== undefined) {
                    console.warn("[DB] Stripping unexpected 'guid' from user-state operation before sending to server:", opForSync);
                    delete opForSync.guid;
                }
                operationsToSync.push(opForSync);
            } else {
                console.warn(`[DB] Unknown operation type found during batching: ${op.type}. Skipping from batch.`, op);
            }
        }

        if (operationsToSync.length === 0) {
            console.log('[DB] No operations to batch for server sync.');
            return;
        }

        console.log(`[DB] Sending ${operationsToSync.length} batched operations to /api/user-state.`);

        const response = await fetch(`${API_BASE_URL}/api/user-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operationsToSync)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status} for /api/user-state batch sync. Details: ${errorText}`);
        }

        const responseData = await response.json();
        console.log('[DB] Batch sync successful. Server response:', responseData);

        if (responseData.results && Array.isArray(responseData.results)) {
            const tx = db.transaction('pendingOperations', 'readwrite');
            const store = tx.objectStore('pendingOperations');

            for (const result of responseData.results) {
                if (result.status === 'success' && result.id !== undefined) {
                    await store.delete(result.id);
                    console.log(`[DB] Removed buffered operation ${result.id} (${result.opType})`);
                } else if (result.status === 'failed' || result.status === 'skipped') {
                    console.warn(`[DB] Operation ${result.id !== undefined ? result.id : 'ID missing'} (${result.opType}) ${result.status}: ${result.reason || 'No specific reason provided.'}`);
                }
            }
            await tx.done;
        } else {
            console.warn('[DB] Server response did not contain a valid "results" array. Cannot clear buffered operations.');
        }

        if (responseData.serverTime) {
            await saveSimpleState('lastStateSync', responseData.serverTime);
            console.log(`[DB] Global lastStateSync updated to: ${responseData.serverTime}`);
        }

    } catch (error) {
        console.error('[DB] Error during batch synchronization:', error);
    }
}

/**
 * Gets the number of buffered changes waiting to be synced.
 * @returns {Promise<number>} The count of pending operations.
 */
export async function getBufferedChangesCount() {
    const db = await getDb();
    try {
        const tx = db.transaction('pendingOperations', 'readonly');
        const store = tx.objectStore('pendingOperations');
        const count = await store.count();
        await tx.done;
        return count;
    } catch (e) {
        console.error('[DB] Error getting buffer count:', e);
        return 0;
    }
}

let _isPullingUserState = false;
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500;

/**
 * Pulls the user state from the server. This function has been updated
 * to correctly fetch data for stores that are empty, or when the data
 * is present but invalid, preventing a 304 response from being treated
 * as a successful sync for an empty local state.
 */
export async function pullUserState() {
    const db = await getDb();
    if (_isPullingUserState) {
        console.log('[DB] Already pulling state. Skipping.');
        return;
    }
    const now = Date.now();
    if (now - _lastPullAttemptTime < PULL_DEBOUNCE_MS) {
        console.log('[DB] Debouncing pull.');
        return;
    }
    _lastPullAttemptTime = now;
    _isPullingUserState = true;
    console.log('[DB] Pulling user state...');
    const API_BASE_URL = window.location.origin;
    let newestOverallTimestamp = null;

    const fetchPromises = Object.entries(USER_STATE_DEFS).map(async ([key, def]) => {
        if (key === 'lastStateSync' || key === 'lastFeedSync' || key === 'feedScrollY' || key === 'feedVisibleLink' || key === 'itemsClearedCount') {
            return { key, status: 'skipped' };
        }
        const url = `${API_BASE_URL}/api/user-state/${key}`;
        let localTimestamp = '';
        let isLocalStateEmpty = false;
        
        let loadedState;
        if (def.type === 'array') {
            loadedState = await loadArrayState(key);
            console.log(`[DB] DEBUG: Loaded state for array key '${key}' is:`, loadedState);
            const hasValidData = loadedState.value && loadedState.value.length > 0 && loadedState.value.every(item => item !== null && item !== undefined);
            
            if (hasValidData) {
                localTimestamp = loadedState.lastModified || '';
                isLocalStateEmpty = false;
            } else {
                isLocalStateEmpty = true;
            }
        } else { // 'simple' type
            loadedState = await loadSimpleState(key);
            if (loadedState.value === null || loadedState.value === undefined) {
                isLocalStateEmpty = true;
            } else {
                localTimestamp = loadedState.lastModified || '';
            }
        }

        if (isLocalStateEmpty) {
            console.log(`[DB] Local state for ${key} is empty or invalid. Forcing a full fetch.`);
            localTimestamp = ''; // Ensure no ETag is sent
        } else {
            console.log(`[DB] Local state for ${key} has data. Using If-None-Match header.`);
        }
        
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (localTimestamp) {
                headers['If-None-Match'] = localTimestamp;
                console.log(`[DB] Fetching ${key} with If-None-Match header: ${localTimestamp}.`);
            } else {
                console.log(`[DB] Fetching ${key} with no ETag.`);
            }
            const response = await fetch(url, { method: 'GET', headers: headers });
            if (response.status === 304) {
                console.log(`[DB] State for ${key}: 304 Not Modified. Local data is up-to-date.`);
                if (localTimestamp && (!newestOverallTimestamp || localTimestamp > newestOverallTimestamp)) {
                    newestOverallTimestamp = localTimestamp;
                }
                return { key, status: 304 };
            }
            if (!response.ok) {
                if (response.status === 404) {
                    console.warn(`[DB] State key ${key} 404 on server. Using default.`);
                    return { key, status: 404 };
                }
                console.error(`[DB] HTTP error for ${key}: ${response.status}`);
                throw new Error(`HTTP error! status: ${response.status} for ${key}`);
            }
            const data = await response.json();
            console.log(`[DB] New data received for ${key}.`);
            const transactionStores = [def.store];
            if (def.store !== 'userSettings') {
                transactionStores.push('userSettings');
            }
            const tx = db.transaction(transactionStores, 'readwrite');

            if (def.type === 'array') {
                // --- START FIX ---
                // Filter the array to ensure only valid items are passed to the save function
                const cleanArray = (data.value || def.default).filter(item => {
                    if (typeof item === 'string' && item.trim() !== '') {
                        return true;
                    }
                    if (typeof item === 'object' && item !== null && typeof item.guid === 'string' && item.guid.trim() !== '') {
                        return true;
                    }
                    console.warn(`[DB] Skipping invalid array item for key '${key}':`, item);
                    return false;
                });
                await saveArrayState(key, cleanArray, data.lastModified, tx);
                // --- END FIX ---
            } else {
                await saveSimpleState(key, data.value, data.lastModified, tx);
            }

            await tx.done;
            if (data.lastModified && (!newestOverallTimestamp || data.lastModified > newestOverallTimestamp)) {
                newestOverallTimestamp = data.lastModified;
            }
            return { key, data, status: 200 };
        } catch (error) {
            console.error(`[DB] Failed to pull ${key}:`, error);
            return { key, data: null, status: 'error', error };
        }
    });

    await Promise.all(fetchPromises);
    if (newestOverallTimestamp) {
        await saveSimpleState('lastStateSync', newestOverallTimestamp);
        console.log(`[DB] Updated lastStateSync to: ${newestOverallTimestamp}`);
    } else {
        console.log('[DB] No new overall timestamp.');
    }
    _isPullingUserState = false;
    console.log('[DB] User state pull completed.');
}
/**
 * Performs a feed synchronization, fetching new or updated items.
 * @param {object} app - The main application state object.
 */
export async function performFeedSync(app) {
    const db = await getDb();
    if (!isOnline()) {
        console.log('[DB] Offline. Skipping feed sync.');
        return;
    }
    console.log('[DB] Fetching feed items from server.');
    const API_BASE_URL = window.location.origin;
    try {
        const { value: lastFeedSyncTime } = await loadSimpleState('lastFeedSync');
        const sinceTimestamp = lastFeedSyncTime || '';
        const guidsResponse = await fetch(`${API_BASE_URL}/api/feed-guids?since=${sinceTimestamp}`);
        if (!guidsResponse.ok) {
            console.error(`[DB] HTTP error! status: ${guidsResponse.status} for /api/feed-guids`);
            throw new Error(`HTTP error! status: ${guidsResponse.status} for /api/feed-guids`);
        }
        const guidsData = await guidsResponse.json();
        const serverGuids = new Set(guidsData.guids);
        const serverTime = guidsData.serverTime;
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
        console.log(`[DB] New/updated GUIDs: ${guidsToFetch.length}, Deleting: ${guidsToDelete.length}`);
        const BATCH_SIZE = 50;
        for (let i = 0; i < guidsToFetch.length; i += BATCH_SIZE) {
            const batch = guidsToFetch.slice(i, i + BATCH_SIZE);
            const itemsResponse = await fetch(`${API_BASE_URL}/api/feed-items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guids: batch })
            });
            if (!itemsResponse.ok) {
                console.error(`[DB] HTTP error! status: ${itemsResponse.status} for /api/feed-items batch.`);
                continue;
            }
            const newItems = await itemsResponse.json();
            const tx = db.transaction(['feedItems'], 'readwrite');
            const feedStore = tx.objectStore('feedItems');

            for (const item of newItems) {
                if (!item.guid) {
                    console.error("[DB] Item missing GUID, cannot store:", item);
                    continue;
                }
                await feedStore.put(item);
            }

            for (const guidToDelete of guidsToDelete) {
                if (!new Set(newItems.map(i => i.guid)).has(guidToDelete)) {
                    await feedStore.delete(guidToDelete);
                    console.log(`[DB] Deleted item: ${guidToDelete}`);
                }
            }
            await tx.done;
        }
        if (serverTime) {
            await saveSimpleState('lastFeedSync', serverTime);
            console.log(`[DB] Updated lastFeedSync to: ${serverTime}`);
        }
        if (app && app.loadFeedItemsFromDB) {
            await app.loadFeedItemsFromDB();
            // The deck needs to be re-evaluated and displayed after the feed is synced.
            // This ensures the UI updates with the new items.
            if (app.loadAndDisplayDeck) {
                await app.loadAndDisplayDeck();
            }
        }
        if (app && app.updateCounts) {
            app.updateCounts();
        }
        console.log('[DB] Feed sync completed.');
    } catch (error) {
        console.error('[DB] Failed to synchronize feed:', error);
    }
}

/**
 * Performs a full synchronization, pulling user state and feed items.
 * @param {object} app - The main application state object.
 */
export async function performFullSync(app) {
    console.log('[DB] Full sync initiated.');
    try {
        await pullUserState();
        await performFeedSync(app);
        console.log('[DB] Full sync completed successfully.');
    } catch (error) {
        console.error('[DB] Full sync failed:', error);
    }
}