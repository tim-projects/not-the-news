// @filepath: src/js/data/dbSyncOperations.js

import { withDb } from './dbCore.js';
import { isOnline } from '../utils/connectivity.js';
import {
    loadSimpleState,
    loadArrayState,
    // NOTE: We no longer import writers like `saveSimpleState` or `updateArrayState`
    // to prevent accidental sync loops. This file manages its own local writes.
    USER_STATE_DEFS
} from './dbUserState.js';

const API_BASE_URL = window.location.origin;

/**
 * A private helper to save sync-related metadata directly to IndexedDB
 * without triggering the sync queue. This is critical to prevent infinite loops.
 * @param {string} key The key to save (e.g., 'lastStateSync').
 * @param {any} value The value to save.
 * @returns {Promise<void>}
 */
async function _saveSyncMetaState(key, value) {
    return withDb(async (db) => {
        try {
            // Directly use `db.put` to bypass the queueing logic in dbUserState.js
            await db.put('userSettings', { key, value, lastModified: new Date().toISOString() });
        } catch (e) {
            console.error(`[DB] Failed to save sync metadata for key '${key}':`, e);
        }
    });
}

/**
 * A private helper to add a user operation to the pending buffer.
 * @param {object} operation The operation object to add.
 * @returns {Promise<number>} The ID of the buffered operation.
 */
async function _addPendingOperationToBuffer(operation) {
    return withDb(async (db) => {
        // Ensure we don't try to store an existing primary key.
        const opToStore = { ...operation };
        if (opToStore.id) delete opToStore.id;
        try {
            const tx = db.transaction('pendingOperations', 'readwrite');
            const id = await tx.store.add(opToStore);
            await tx.done;
            return id;
        } catch (e) {
            console.error('[DB] Error buffering operation:', e);
            throw e;
        }
    });
}

/**
 * --- MODIFIED: Queues any user operation and attempts an immediate sync if online. ---
 * The logic is now generalized and not limited to specific operation types.
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
        
        const { value: syncEnabled } = await loadSimpleState('syncEnabled');
        
        // Generalize the immediate sync check to apply to any operation type.
        if (isOnline() && syncEnabled) {
            console.log(`[DB] Attempting immediate sync for ${operation.type} (ID: ${generatedId}).`);
            const syncPayload = [{ ...operation, id: generatedId }];
            const response = await fetch(`${API_BASE_URL}/api/user-state`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(syncPayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error ${response.status} for immediate sync. Details: ${errorText}`);
            }

            const responseData = await response.json();
            const result = responseData.results?.find(res => res.id === generatedId);

            if (result?.status === 'success') {
                await withDb(db => db.delete('pendingOperations', generatedId));
                console.log(`[DB] Successfully synced and removed immediate op ${generatedId} (${operation.type}).`);
                if (responseData.serverTime) await _saveSyncMetaState('lastStateSync', responseData.serverTime);

                // --- SOLUTION ---
                // After successfully pushing a change, pull the latest state to ensure consistency.
                pullUserState();
                // --- END SOLUTION ---

            } else {
                console.warn(`[DB] Immediate sync for op ${generatedId} reported non-success by server:`, result);
            }
        } else {
            console.log(`[DB] ${!isOnline() ? 'Offline.' : 'Sync is disabled.'} Buffering op ${generatedId} for later batch sync.`);
        }
    } catch (networkError) {
        console.error(`[DB] Network error during immediate sync for ${operation.type}. Will retry with batch sync.`, networkError);
    }
}

/**
 * Processes all pending operations in the buffer and syncs them with the server.
 */
export async function processPendingOperations() {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled');
    if (!isOnline() || !syncEnabled) {
        console.log('[DB] Offline or sync is disabled. Skipping batch sync.');
        return;
    }
    
    const operations = await withDb(db => db.getAll('pendingOperations')).catch(e => {
        console.error('[DB] Error fetching pending operations:', e);
        return null;
    });

    if (!operations || operations.length === 0) {
        if (operations) console.log('[DB] No pending operations.');
        return;
    }

    console.log(`[DB] Sending ${operations.length} batched operations to /api/user-state.`);

    try {
        const response = await fetch(`${API_BASE_URL}/api/user-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operations)
        });

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}. Details: ${await response.text()}`);
        }

        const responseData = await response.json();
        console.log('[DB] Batch sync successful. Server response:', responseData);

        if (responseData.results && Array.isArray(responseData.results)) {
            await withDb(async (db) => {
                const tx = db.transaction('pendingOperations', 'readwrite');
                for (const result of responseData.results) {
                    if (result.status === 'success' && result.id !== undefined) {
                        await tx.store.delete(result.id);
                    } else {
                        console.warn(`[DB] Op ${result.id ?? 'N/A'} (${result.opType}) ${result.status}: ${result.reason || 'N/A'}`);
                    }
                }
                await tx.done;
            });
        } else {
            console.warn('[DB] Server response invalid; cannot clear buffered operations.');
        }

        if (responseData.serverTime) await _saveSyncMetaState('lastStateSync', responseData.serverTime);

        // --- SOLUTION ---
        // After a successful batch sync, pull the latest state.
        pullUserState();
        // --- END SOLUTION ---

    } catch (error) {
        console.error('[DB] Error during batch synchronization:', error);
    }
}

let _isPullingUserState = false;
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500;

/**
 * A private helper to pull a single user state key from the server.
 */
async function _pullSingleStateKey(key, def) {
    // ✅ --- START: RACE CONDITION FIX ---
    // Before fetching from the server, check if there are local changes for this key
    // that are waiting to be synced. If so, we must not overwrite them.
    const allPendingOps = await withDb(db => db.getAll('pendingOperations')).catch(() => []);
    
    // Check for operations that match the key directly (e.g., 'simpleUpdate' for 'syncEnabled')
    // or match the operation type related to the key (e.g., 'starDelta' for the 'starred' key).
    const hasPendingOperations = allPendingOps.some(op => 
        op.key === key || 
        (op.type === 'starDelta' && key === 'starred') ||
        (op.type === 'hiddenDelta' && key === 'hidden') ||
        (op.type === 'simpleUpdate' && op.key === 'currentDeckGuids')
    );

    if (hasPendingOperations) {
        console.log(`[DB] Skipping pull for '${key}' because local changes are pending synchronization.`);
        return { key, status: 'skipped_pending' };
    }
    // ✅ --- END: RACE CONDITION FIX ---

    const { value: localData, lastModified } = def.type === 'array' ? await loadArrayState(def.store) : await loadSimpleState(key, def.store);
    const localTimestamp = lastModified || '';
    
    const headers = { 'Content-Type': 'application/json' };
    if (localTimestamp) headers['If-None-Match'] = localTimestamp;

    try {
        const response = await fetch(`${API_BASE_URL}/api/user-state/${key}`, { method: 'GET', headers });

        if (response.status === 304) {
            return { key, status: 304, timestamp: localTimestamp };
        }
        if (!response.ok) {
            console.error(`[DB] HTTP error for ${key}: ${response.status}`);
            return { key, status: response.status };
        }
        const data = await response.json();
        console.log(`[DB] New data received for ${key}.`);

        if (def.type === 'array') {
            const serverObjects = data.value || [];
            const localObjects = localData || [];
            const serverGuids = new Set(serverObjects.map(item => item.guid));
            const localGuids = new Set(localObjects.map(item => item.guid));

            const objectsToAdd = serverObjects.filter(item => !localGuids.has(item.guid));
            const objectsToRemove = localObjects.filter(item => !serverGuids.has(item.guid));

            if (objectsToAdd.length > 0 || objectsToRemove.length > 0) {
                 await withDb(async (db) => {
                    const tx = db.transaction(def.store, 'readwrite');
                    for (const item of objectsToAdd) await tx.store.put(item);
                    for (const item of objectsToRemove) await tx.store.delete(item.id);
                    await tx.done;
                });
            }
        } else {
            // Use the internal save function to prevent re-queuing this change.
            await _saveSyncMetaState(key, data.value);
        }
        
        return { key, status: 200, timestamp: data.lastModified };
    } catch (error) {
        console.error(`[DB] Failed to pull ${key}:`, error);
        return { key, status: 'error' };
    }
}

/**
 * Pulls the user state from the server.
 */
export async function pullUserState() {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled');
    if (!isOnline() || !syncEnabled) {
        if (syncEnabled) console.log('[DB] Offline. Skipping user state pull.');
        return;
    }
    
    if (_isPullingUserState) return;
    const now = Date.now();
    if (now - _lastPullAttemptTime < PULL_DEBOUNCE_MS) return;

    _lastPullAttemptTime = now;
    _isPullingUserState = true;
    console.log('[DB] Pulling user state...');
    
    try {
        const keysToPull = Object.entries(USER_STATE_DEFS).filter(([, def]) => !def.localOnly);
        const results = await Promise.all(keysToPull.map(([key, def]) => _pullSingleStateKey(key, def)));
        
        const newestOverallTimestamp = results.reduce((newest, result) => {
            return (result?.timestamp && result.timestamp > newest) ? result.timestamp : newest;
        }, '');

        if (newestOverallTimestamp) await _saveSyncMetaState('lastStateSync', newestOverallTimestamp);
    } catch (error) {
        console.error('[DB] User state pull failed:', error);
    } finally {
        _isPullingUserState = false;
        console.log('[DB] User state pull completed.');
    }
}

/**
 * Retrieves all items from the feedItems store.
 */
export async function getAllFeedItems() {
    return withDb(db => db.getAll('feedItems')).catch(e => {
        console.error('Failed to get all feed items:', e);
        return [];
    });
}

/**
 * Performs a feed synchronization, fetching new or updated items.
 */
export async function performFeedSync(app) {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled');
    if (!isOnline() || !syncEnabled) {
        if (syncEnabled) console.log('[DB] Offline. Skipping feed sync.');
        return;
    }
    
    console.log('[DB] Fetching feed items from server.');

    try {
        const { value: lastFeedSyncTime } = await loadSimpleState('lastFeedSync');
        const response = await fetch(`${API_BASE_URL}/api/feed-guids?since=${lastFeedSyncTime || ''}`);

        if (response.status === 304) {
            console.log('[DB] Feed not modified.');
            return;
        }
        if (!response.ok) throw new Error(`HTTP error ${response.status} for /api/feed-guids`);

        const responseData = await response.json();
        console.log('[DB] /api/feed-guids response:', responseData);
        const { guids: serverGuidsList, serverTime } = responseData;
        const serverGuids = new Set(serverGuidsList);
        const localItems = await getAllFeedItems();
        const localGuids = new Set(localItems.map(item => item.guid));

        const guidsToFetch = [...serverGuids].filter(guid => !localGuids.has(guid));
        console.log(`[DB] GUIDs to fetch: ${guidsToFetch.length}`, guidsToFetch);
        const guidsToDelete = [...localGuids].filter(guid => !serverGuids.has(guid));

        console.log(`[DB] New GUIDs: ${guidsToFetch.length}, Deleting: ${guidsToDelete.length}`);

        if (guidsToFetch.length > 0) {
            // ✅ STABILITY FIX: Re-introduce batching for fetching item bodies to avoid network errors on large updates.
            const BATCH_SIZE = 50;
            const newItems = [];
            for (let i = 0; i < guidsToFetch.length; i += BATCH_SIZE) {
                const batch = guidsToFetch.slice(i, i + BATCH_SIZE);
                const itemsResponse = await fetch(`${API_BASE_URL}/api/feed-items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ guids: batch })
                });

                if (itemsResponse.ok) {
                    const fetchedItems = await itemsResponse.json();
                    console.log(`[DB] Fetched batch of ${fetchedItems.length} items:`, fetchedItems);
                    newItems.push(...fetchedItems);
                } else {
                    console.error(`[DB] Failed to fetch a batch of feed items. Status: ${itemsResponse.status}`);
                }
            }
            
            await withDb(async (db) => {
                const tx = db.transaction('feedItems', 'readwrite');
                for (const item of newItems) if (item.guid) await tx.store.put(item);
                await tx.done;
            });
        }
        
        if (guidsToDelete.length > 0) {
            const guidToIdMap = new Map(localItems.map(item => [item.guid, item.id]));
            await withDb(async (db) => {
                const tx = db.transaction('feedItems', 'readwrite');
                for (const guid of guidsToDelete) {
                    const id = guidToIdMap.get(guid);
                    if (id !== undefined) await tx.store.delete(id);
                }
                await tx.done;
            });
        }

        if (serverTime) await _saveSyncMetaState('lastFeedSync', serverTime);
        
        // Trigger UI updates
        app?.loadFeedItemsFromDB?.();
        app?.loadAndDisplayDeck?.();
        app?.updateCounts?.();

    } catch (error) {
        console.error('[DB] Failed to synchronize feed:', error);
    }
}

/**
 * Performs a full synchronization, pulling user state and feed items.
 */
export async function performFullSync(app) {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled');
    if (!isOnline() || !syncEnabled) return;
    
    console.log('[DB] Full sync initiated.');
    try {
        // Run pulls first, then push any pending changes.
        await pullUserState();
        await performFeedSync(app);
        await processPendingOperations(); // Process any items that were queued while offline.
    } catch (error) {
        console.error('[DB] Full sync failed:', error);
    }
}