// @filepath: src/js/data/dbSyncOperations.js

// Refactored JS: concise, modern, functional, same output.

import { getDb } from './dbCore.js';
import { isOnline } from '../utils/connectivity.js';
import {
    loadSimpleState,
    saveSimpleState,
    saveArrayState,
    loadArrayState,
    USER_STATE_DEFS
} from './dbUserState.js';

const API_BASE_URL = window.location.origin;

/**
 * A private helper to add a user operation to the pending buffer.
 * @param {object} operation The operation object to add.
 * @returns {Promise<number>} The ID of the buffered operation.
 */
async function _addPendingOperationToBuffer(operation) {
    const db = await getDb();
    const opToStore = { ...operation };
    // 'id' is the auto-incrementing key, so it should not be stored.
    if (opToStore.id) delete opToStore.id;

    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    try {
        const id = await store.add(opToStore);
        await tx.done;
        return id;
    } catch (e) {
        console.error('[DB] Error buffering operation:', e);
        throw e;
    }
}

/**
 * Queues a user operation and attempts an immediate sync if online.
 * @param {object} operation The operation object to queue and sync.
 */
export async function queueAndAttemptSyncOperation(operation) {
    if (!operation || typeof operation.type !== 'string' || (operation.type === 'simpleUpdate' && (operation.value === null || operation.value === undefined))) {
        console.warn(`[DB] Skipping invalid or empty operation:`, operation);
        return;
    }

    try {
        const generatedId = await _addPendingOperationToBuffer(operation);
        console.log(`[DB] Operation buffered with ID: ${generatedId}`, operation);

        if ((operation.type === 'starDelta' || operation.type === 'hiddenDelta') && isOnline()) {
            console.log(`[DB] Attempting immediate sync for ${operation.type} (ID: ${generatedId}).`);
            const syncPayload = [{ ...operation, id: generatedId }];
            const response = await fetch(`${API_BASE_URL}/api/user-state`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(syncPayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status} for immediate ${operation.type} sync. Details: ${errorText}`);
            }

            const responseData = await response.json();
            const result = responseData.results?.find(res => res.id === generatedId);

            if (result?.status === 'success') {
                const db = await getDb();
                const tx = db.transaction('pendingOperations', 'readwrite');
                await tx.objectStore('pendingOperations').delete(generatedId);
                await tx.done;
                console.log(`[DB] Successfully synced and removed immediate operation ${generatedId} (${operation.type}).`);
                if (responseData.serverTime) await saveSimpleState('lastStateSync', responseData.serverTime);
            } else {
                console.warn(`[DB] Immediate sync for ${operation.type} (ID: ${generatedId}) reported non-success by server:`, result);
            }
        } else {
            console.log(`[DB] Offline. Buffering ${operation.type} (ID: ${generatedId}) for later batch sync.`);
        }
    } catch (networkError) {
        console.error(`[DB] Network error during immediate sync for ${operation.type}. Will retry with batch sync.`, networkError);
    }
}

/**
 * Adds a user operation to the pending operations buffer.
 * @param {object} operation The operation object to add.
 */
export async function addPendingOperation(operation) {
    try {
        const generatedId = await _addPendingOperationToBuffer(operation);
        console.log('[DB] Operation buffered:', { ...operation, id: generatedId });
    } catch (e) {
        console.error('[DB] Error buffering operation:', e);
    }
}

/**
 * Processes all pending operations in the buffer and syncs them with the server.
 */
export async function processPendingOperations() {
    if (!isOnline()) {
        console.log('[DB] Offline. Skipping batch sync.');
        return;
    }
    
    const db = await getDb();
    let operations;
    try {
        operations = await db.transaction('pendingOperations', 'readonly').objectStore('pendingOperations').getAll();
    } catch (e) {
        console.error('[DB] Error fetching pending operations:', e);
        return;
    }

    if (operations.length === 0) {
        console.log('[DB] No pending operations.');
        return;
    }

    console.log(`[DB] Sending ${operations.length} batched operations to /api/user-state.`);

    try {
        // The operations array already contains the necessary data.
        const response = await fetch(`${API_BASE_URL}/api/user-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operations)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status} for batch sync. Details: ${errorText}`);
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
                } else {
                    console.warn(`[DB] Operation ${result.id ?? 'ID missing'} (${result.opType}) ${result.status}: ${result.reason || 'No specific reason provided.'}`);
                }
            }
            await tx.done;
        } else {
            console.warn('[DB] Server response did not contain a valid "results" array. Cannot clear buffered operations.');
        }

        if (responseData.serverTime) await saveSimpleState('lastStateSync', responseData.serverTime);

    } catch (error) {
        console.error('[DB] Error during batch synchronization:', error);
    }
}

/**
 * Gets the number of buffered changes waiting to be synced.
 * @returns {Promise<number>} The count of pending operations.
 */
export async function getBufferedChangesCount() {
    try {
        const db = await getDb();
        return await db.transaction('pendingOperations', 'readonly').objectStore('pendingOperations').count();
    } catch (e) {
        console.error('[DB] Error getting buffer count:', e);
        return 0;
    }
}

let _isPullingUserState = false;
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500;

/**
 * A private helper to pull a single user state key from the server.
 * @param {string} key The state key to pull.
 * @param {object} def The state key definition from USER_STATE_DEFS.
 * @returns {Promise<object>} The result of the pull operation.
 */
async function _pullSingleStateKey(key, def) {
    const db = await getDb();
    const url = `${API_BASE_URL}/api/user-state/${key}`;
    let localTimestamp = '';
    let isLocalStateEmpty = false;

    // Use a single transaction for loading state.
    const loadTx = db.transaction([def.store], 'readonly');
    if (def.type === 'array') {
        const loadedState = await loadArrayState(key, loadTx);
        const hasValidData = loadedState.value?.length > 0 && loadedState.value.every(item => item);
        isLocalStateEmpty = !hasValidData;
        if (hasValidData) localTimestamp = loadedState.lastModified || '';
    } else { // 'simple' type
        const loadedState = await loadSimpleState(key, loadTx);
        isLocalStateEmpty = loadedState.value === null || loadedState.value === undefined;
        if (!isLocalStateEmpty) localTimestamp = loadedState.lastModified || '';
    }
    await loadTx.done; // Ensure the load transaction is complete.

    const headers = { 'Content-Type': 'application/json' };
    if (!isLocalStateEmpty && localTimestamp) headers['If-None-Match'] = localTimestamp;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers
        });
        if (response.status === 304) {
            console.log(`[DB] State for ${key}: 304 Not Modified.`);
            return {
                key,
                status: 304,
                timestamp: localTimestamp
            };
        }
        if (!response.ok) {
            console.error(`[DB] HTTP error for ${key}: ${response.status}`);
            return {
                key,
                status: response.status
            };
        }
        const data = await response.json();
        console.log(`[DB] New data received for ${key}.`);

        // Use a new transaction for saving data.
        const saveTx = db.transaction([def.store], 'readwrite');
        if (def.type === 'array') {
            const cleanArray = (data.value || def.default || []).filter(item => {
                if (typeof item === 'string' && item.trim()) return true;
                if (typeof item === 'object' && item?.guid?.trim()) return true;
                console.warn(`[DB] Skipping invalid array item for key '${key}':`, item);
                return false;
            });
            await saveArrayState(key, cleanArray, data.lastModified, saveTx);
        } else {
            await saveSimpleState(key, data.value, data.lastModified, saveTx);
        }
        await saveTx.done;

        return {
            key,
            status: 200,
            timestamp: data.lastModified
        };
    } catch (error) {
        console.error(`[DB] Failed to pull ${key}:`, error);
        return {
            key,
            status: 'error'
        };
    }
}

/**
 * Pulls the user state from the server.
 */
export async function pullUserState() {
    if (_isPullingUserState) return console.log('[DB] Already pulling state. Skipping.');
    const now = Date.now();
    if (now - _lastPullAttemptTime < PULL_DEBOUNCE_MS) return console.log('[DB] Debouncing pull.');

    _lastPullAttemptTime = now;
    _isPullingUserState = true;
    console.log('[DB] Pulling user state...');
    let newestOverallTimestamp = null;

    const keysToPull = Object.entries(USER_STATE_DEFS).filter(([key, def]) => !def.localOnly);

    const results = await Promise.all(keysToPull.map(([key, def]) => _pullSingleStateKey(key, def)));

    for (const result of results) {
        if (result.timestamp && (!newestOverallTimestamp || result.timestamp > newestOverallTimestamp)) {
            newestOverallTimestamp = result.timestamp;
        }
    }

    if (newestOverallTimestamp) await saveSimpleState('lastStateSync', newestOverallTimestamp);

    _isPullingUserState = false;
    console.log('[DB] User state pull completed.');
}

/**
 * Performs a feed synchronization, fetching new or updated items.
 * @param {object} app The main application state object.
 */
export async function performFeedSync(app) {
    if (!isOnline()) return console.log('[DB] Offline. Skipping feed sync.');
    console.log('[DB] Fetching feed items from server.');

    try {
        const { value: lastFeedSyncTime } = await loadSimpleState('lastFeedSync');
        const sinceTimestamp = lastFeedSyncTime || '';
        const guidsResponse = await fetch(`${API_BASE_URL}/api/feed-guids?since=${sinceTimestamp}`);

        if (!guidsResponse.ok) throw new Error(`HTTP error! status: ${guidsResponse.status} for /api/feed-guids`);

        const guidsData = await guidsResponse.json();
        const serverGuids = new Set(guidsData.guids);
        const serverTime = guidsData.serverTime;

        const db = await getDb();
        const localItems = await db.transaction('feedItems', 'readonly').objectStore('feedItems').getAll();
        const localGuids = new Set(localItems.map(item => item.guid));

        const guidsToFetch = [...serverGuids].filter(guid => !localGuids.has(guid));
        const guidsToDelete = [...localGuids].filter(guid => !serverGuids.has(guid));

        console.log(`[DB] New/updated GUIDs: ${guidsToFetch.length}, Deleting: ${guidsToDelete.length}`);

        const BATCH_SIZE = 50;
        const tx = db.transaction(['feedItems'], 'readwrite');
        const feedStore = tx.objectStore('feedItems');

        // Handle deletions first
        for (const guidToDelete of guidsToDelete) {
            await feedStore.delete(guidToDelete);
            console.log(`[DB] Deleted item: ${guidToDelete}`);
        }

        // Handle new/updated items in batches
        for (let i = 0; i < guidsToFetch.length; i += BATCH_SIZE) {
            const batch = guidsToFetch.slice(i, i + BATCH_SIZE);
            const itemsResponse = await fetch(`${API_BASE_URL}/api/feed-items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    guids: batch
                })
            });

            if (!itemsResponse.ok) {
                console.error(`[DB] HTTP error! status: ${itemsResponse.status} for /api/feed-items batch.`);
                continue;
            }

            const newItems = await itemsResponse.json();
            for (const item of newItems) {
                if (item.guid) await feedStore.put(item);
                else console.error("[DB] Item missing GUID, cannot store:", item);
            }
        }
        await tx.done;

        if (serverTime) await saveSimpleState('lastFeedSync', serverTime);

        if (app?.loadFeedItemsFromDB) await app.loadFeedItemsFromDB();
        if (app?.loadAndDisplayDeck) await app.loadAndDisplayDeck();
        if (app?.updateCounts) app.updateCounts();

        console.log('[DB] Feed sync completed.');
    } catch (error) {
        console.error('[DB] Failed to synchronize feed:', error);
    }
}

/**
 * Performs a full synchronization, pulling user state and feed items.
 * @param {object} app The main application state object.
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