// www/js/data/dbSyncOperations.js

import { getDb, isOnline } from './dbCore.js';
import { loadSimpleState, saveSimpleState, saveArrayState, USER_STATE_DEFS } from './dbUserState.js';

// This counter is no longer needed since 'pendingOperations' uses autoIncrement on 'id'.
// It's good to remove dead code.
// let _operationIdCounter = Date.now(); // <-- ***REMOVED***

export async function queueAndAttemptSyncOperation(operation) {
    const db = await getDb();

    // The `pendingOperations` store now explicitly uses `id` as its primary key with `autoIncrement: true`.
    // This means we should let IndexedDB assign the `id` when using `add()`.
    // Operations going into 'pendingOperations' should *not* have a 'guid' property,
    // as 'guid' is reserved for feed items.
    if (operation.guid !== undefined) { // Check if 'guid' is present
        console.warn("[DB] Operation destined for 'pendingOperations' has an unexpected 'guid' property. Removing it:", operation);
        delete operation.guid; // <-- ***ADDED: Remove guid if present on user-state operations***
    }

    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    let generatedId = null;

    try {
        const opToStore = { ...operation }; // Create a copy for storage
        // Ensure the `id` property is not present on the object passed to `store.add()`
        // so IndexedDB can assign a new autoIncremented ID.
        delete opToStore.id; // Correctly ensures autoIncrement takes over for the primary key.

        generatedId = await store.add(opToStore);
        // Update the original `operation` object with the ID assigned by IndexedDB.
        operation.id = generatedId;

        await tx.done;
        console.log(`[DB] Operation buffered with ID: ${operation.id}`, operation);

        // Immediate sync attempt for starDelta/hiddenDelta if online
        if ((operation.type === 'starDelta' || operation.type === 'hiddenDelta') && isOnline()) {
            console.log(`[DB] Attempting immediate sync for ${operation.type} (ID: ${operation.id}).`);
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

                // Server response for successful ops should provide the original `id` for tracking.
                // Assuming your server echoes back the `id` you sent.
                if (result && result.status === 'success' && result.id !== undefined) {
                    // If successfully synced, remove from pending operations by its `id`.
                    const deleteTx = db.transaction('pendingOperations', 'readwrite');
                    await deleteTx.objectStore('pendingOperations').delete(operation.id); // Delete by `id`
                    await deleteTx.done;
                    console.log(`[DB] Successfully synced and removed immediate operation ${operation.id} (${operation.type}) from buffer.`);
                    // Optionally update lastStateSync if the serverTime is new
                    if (responseData.serverTime) {
                        const { value: currentLastStateSync } = await loadSimpleState('lastStateSync');
                        // Corrected variable name from currentLastLastSync to currentLastStateSync
                        if (!currentLastStateSync || responseData.serverTime > currentLastStateSync) { // <-- ***CHANGED***
                            await saveSimpleState('lastStateSync', responseData.serverTime);
                            console.log(`[DB] Updated lastStateSync to: ${responseData.serverTime}`);
                        }
                    }
                } else {
                    console.warn(`[DB] Immediate sync for ${operation.type} (ID: ${operation.id}) reported non-success by server:`, result);
                    // Operation remains in buffer for batch sync
                }

            } catch (networkError) {
                console.error(`[DB] Network error during immediate sync for ${operation.type} (ID: ${operation.id}). Will retry with batch sync:`, networkError);
                // Operation remains in buffer for batch sync
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

export async function addPendingOperation(operation) {
    const db = await getDb();
    // Ensure 'guid' is not present if this is a user-state operation
    if (operation.guid !== undefined) {
        console.warn("[DB] Operation destined for 'pendingOperations' has an unexpected 'guid' property. Removing it:", operation);
        delete operation.guid; // <-- ***ADDED***
    }

    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    try {
        const opToStore = { ...operation };
        delete opToStore.id; // Ensure IndexedDB assigns the autoIncremented ID

        let generatedId = await store.add(opToStore);
        operation.id = generatedId; // Update the original object with the new ID

        await tx.done;
        console.log('[DB] Operation buffered:', operation);
    } catch (e) {
        console.error('[DB] Error buffering operation:', e);
        throw e;
    }
}

export async function processPendingOperations() {
    const db = await getDb();
    if (!isOnline()) {
        console.log('[DB] Offline. Skipping batch sync.');
        return;
    }
    let operations;
    try {
        const fetchTx = db.transaction('pendingOperations', 'readonly');
        // This will now correctly retrieve operations that were saved with an 'id' primary key.
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
        // `idsToRemove` variable is not strictly needed if we process results directly.
        // const idsToRemove = []; // Removed this as it's not used downstream

        // Filter operations: Only include simpleUpdates, or starDelta/hiddenDelta
        for (const op of operations) {
            // The warning about missing `op.id` will now only appear for legacy data
            // that was stored *before* the `dbCore.js` schema change and your
            // `operation.id = generatedId` logic was consistently applied.
            if (!op.id) {
                console.warn('[DB] Found operation without an ID (likely legacy data). It will be processed but cannot be individually tracked for removal from the client buffer by its ID:', op);
            }

            if (op.type === 'simpleUpdate' || op.type === 'starDelta' || op.type === 'hiddenDelta') {
                // Ensure no 'guid' is sent for these user-state operations.
                // It's already handled when queuing, but this is a final safeguard for batch sync.
                const opForSync = { ...op };
                if (opForSync.guid !== undefined) {
                    console.warn("[DB] Stripping unexpected 'guid' from user-state operation before sending to server:", opForSync);
                    delete opForSync.guid; // <-- ***ADDED: Final strip for server payload***
                }
                operationsToSync.push(opForSync); // Push the cleaned copy
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
            body: JSON.stringify(operationsToSync) // Send the full array of operations
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
                // The server should respond with the `id` of the operation it successfully processed.
                if (result.status === 'success' && result.id !== undefined) {
                    await store.delete(result.id); // Delete by `id`
                    console.log(`[DB] Removed buffered operation ${result.id} (${result.opType})`);
                } else if (result.status === 'failed' || result.status === 'skipped') {
                    // Log the ID if available, otherwise indicate it was missing.
                    console.warn(`[DB] Operation ${result.id !== undefined ? result.id : 'ID missing'} (${result.opType}) ${result.status}: ${result.reason || 'No specific reason provided.'}`);
                }
            }
            await tx.done; // Commit the delete transaction
        } else {
            console.warn('[DB] Server response did not contain a valid "results" array. Cannot clear buffered operations.');
        }

        if (responseData.serverTime) {
            await saveSimpleState('lastStateSync', responseData.serverTime);
            console.log(`[DB] Global lastStateSync updated to: ${responseData.serverTime}`);
        }

    } catch (error) {
        console.error('[DB] Error during batch synchronization:', error);
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
        console.error('[DB] Error getting buffer count:', e);
        return 0;
    }
}

let _isPullingUserState = false;
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500;

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
        // These keys are explicitly skipped for server pull, as they are client-managed or derived.
        if (key === 'lastStateSync' || key === 'lastFeedSync' || key === 'feedScrollY' || key === 'feedVisibleLink' || key === 'itemsClearedCount') {
            return { key, status: 'skipped' };
        }
        const url = `${API_BASE_URL}/api/user-state/${key}`;
        let localTimestamp = '';
        const { lastModified } = await loadSimpleState(key);
        localTimestamp = lastModified || '';
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (localTimestamp) {
                headers['If-None-Match'] = localTimestamp;
                console.log(`[DB] Fetching ${key} with If-None-Match.`);
            } else {
                console.log(`[DB] Fetching ${key} (no ETag).`);
            }
            const response = await fetch(url, { method: 'GET', headers: headers });
            if (response.status === 304) {
                console.log(`[DB] State for ${key}: 304 Not Modified.`);
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
            console.log(`[DB] New data for ${key}.`);
            const transactionStores = [def.store];
            if (def.store !== 'userSettings') {
                transactionStores.push('userSettings');
            }
            const tx = db.transaction(transactionStores, 'readwrite');
            if (def.type === 'array') {
                await saveArrayState(key, data.value || def.default, data.lastModified, tx);
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
                //console.log(`[DB] Stored item: ${item.guid}`);
            }

            for (const guidToDelete of guidsToDelete) {
                // This logic is correct: only delete if the GUID is not in the current batch of new items.
                if (!new Set(newItems.map(i => i.guid)).has(guidToDelete)) {
                    await feedStore.delete(guidToDelete);
                    console.log(`[DB] Deleted item: ${guidToDelete}`);
                }
            }
            await tx.done; // Commit the transaction for the current batch
        }
        if (serverTime) {
            await saveSimpleState('lastFeedSync', serverTime);
            console.log(`[DB] Updated lastFeedSync to: ${serverTime}`);
        }
        if (app && app.loadFeedItemsFromDB) {
            await app.loadFeedItemsFromDB();
        }
        if (app && app.updateCounts) {
            app.updateCounts();
        }
        console.log('[DB] Feed sync completed.');
    } catch (error) {
        console.error('[DB] Failed to synchronize feed:', error);
    }
}

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