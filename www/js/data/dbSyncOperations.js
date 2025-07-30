// www/js/data/dbSyncOperations.js

import { getDb, isOnline } from './dbCore.js';
import { loadSimpleState, saveSimpleState, saveArrayState, USER_STATE_DEFS } from './dbUserState.js';

let _operationIdCounter = Date.now();
export async function queueAndAttemptSyncOperation(operation) {
    const db = await getDb();
    if (operation.id === undefined) {
        operation.id = _operationIdCounter++;
    }
    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    let generatedId = null;
    try {
        generatedId = await store.add(operation);
        if (operation.id !== generatedId) {
            operation.id = generatedId;
        }
        await tx.done;
        console.log(`[DB] Operation buffered with ID: ${operation.id}`); // Added logging

        if ((operation.type === 'starDelta' || operation.type === 'hiddenDelta') && isOnline()) {
            console.log(`[DB] Attempting immediate sync for ${operation.type} (ID: ${operation.id}).`); // Added logging
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
                if (result && result.status === 'success') {
                    const deleteTx = db.transaction('pendingOperations', 'readwrite');
                    await deleteTx.objectStore('pendingOperations').delete(operation.id);
                    await deleteTx.done;
                    console.log(`[DB] Synced and removed immediate operation ${operation.id}.`); // Added logging
                    if (responseData.serverTime) {
                        const { value: currentLastStateSync } = await loadSimpleState('lastStateSync');
                        if (!currentLastStateSync || responseData.serverTime > currentLastStateSync) {
                            await saveSimpleState('lastStateSync', responseData.serverTime);
                            console.log(`[DB] Updated lastStateSync to: ${responseData.serverTime}`); // Added logging
                        }
                    }
                } else {
                    console.warn(`[DB] Immediate sync for ${operation.type} (ID: ${operation.id}) not successful.`); // Added logging
                }
            } catch (networkError) {
                console.error(`[DB] Network error during immediate sync for ${operation.type} (ID: ${operation.id}):`, networkError); // Added logging
            }
        }
    } catch (e) {
        console.error('[DB] Error buffering operation:', e); // Added logging
        throw e;
    }
}

export async function addPendingOperation(operation) {
    const db = await getDb();
    const tx = db.transaction('pendingOperations', 'readwrite');
    const store = tx.objectStore('pendingOperations');
    try {
        await store.add(operation);
        await tx.done;
        console.log('[DB] Operation buffered:', operation); // Added logging
    } catch (e) {
        console.error('[DB] Error buffering operation:', e); // Added logging
        throw e;
    }
}

export async function processPendingOperations() {
    const db = await getDb();
    if (!isOnline()) {
        console.log('[DB] Offline. Skipping batch sync.'); // Added logging
        return;
    }
    let operations;
    try {
        const fetchTx = db.transaction('pendingOperations', 'readonly');
        operations = await fetchTx.objectStore('pendingOperations').getAll();
        await fetchTx.done;
    } catch (e) {
        console.error('[DB] Error fetching pending operations:', e); // Added logging
        return;
    }
    if (operations.length === 0) {
        console.log('[DB] No pending operations.'); // Added logging
        return;
    }
    const API_BASE_URL = window.location.origin;

    try {
        const operationsToSync = [];
        for (const op of operations) {
            if (!op.id) { // Added logging
                console.warn('[DB] Op without ID:', op); // Added logging
            } // Added logging
            if (op.type === 'simpleUpdate' || op.type === 'starDelta' || op.type === 'hiddenDelta') {
                operationsToSync.push(op);
                console.log(`[DB] Adding ${op.type} (ID: ${op.id || 'no-id'}) to batch.`); // Added logging
            } else { // Added logging
                console.warn(`[DB] Unknown op type: ${op.type}. Skipping.`, op); // Added logging
            } // Added logging
        }
        if (operationsToSync.length === 0) {
            console.log('[DB] No ops to batch for server sync.'); // Added logging
            return;
        }
        console.log(`[DB] Sending ${operationsToSync.length} batched operations.`); // Added logging
        const response = await fetch(`${API_BASE_URL}/api/user-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operationsToSync)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[DB] HTTP error! status: ${response.status}. Details: ${errorText}`); // Added logging
            throw new Error(`HTTP error! status: ${response.status} for /api/user-state batch sync. Details: ${errorText}`);
        }
        const responseData = await response.json();
        console.log('[DB] Batch sync successful.'); // Added logging
        if (responseData.results && Array.isArray(responseData.results)) {
            const tx = db.transaction('pendingOperations', 'readwrite');
            const store = tx.objectStore('pendingOperations');
            for (const result of responseData.results) {
                if (result.status === 'success' && result.id !== undefined) {
                    await store.delete(result.id);
                    console.log(`[DB] Removed buffered op ${result.id} (${result.opType}).`); // Added logging
                } else if (result.status === 'failed' || result.status === 'skipped') { // Added logging
                    console.warn(`[DB] Op ${result.id} (${result.opType}) ${result.status}: ${result.reason || 'No reason.'}`); // Added logging
                } // Added logging
            }
            await tx.done;
        } else { // Added logging
            console.warn('[DB] Server response missing "results" array.'); // Added logging
        } // Added logging
        if (responseData.serverTime) {
            await saveSimpleState('lastStateSync', responseData.serverTime);
            console.log(`[DB] Updated lastStateSync to: ${responseData.serverTime}`); // Added logging
        }
    } catch (error) {
        console.error('[DB] Error during batch sync:', error); // Added logging
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
        console.error('[DB] Error getting buffer count:', e); // Added logging
        return 0;
    }
}

let _isPullingUserState = false;
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500;

export async function pullUserState() {
    const db = await getDb();
    if (_isPullingUserState) {
        console.log('[DB] Already pulling state. Skipping.'); // Added logging
        return;
    }
    const now = Date.now();
    if (now - _lastPullAttemptTime < PULL_DEBOUNCE_MS) {
        console.log('[DB] Debouncing pull.'); // Added logging
        return;
    }
    _lastPullAttemptTime = now;
    _isPullingUserState = true;
    console.log('[DB] Pulling user state...'); // Added logging
    const API_BASE_URL = window.location.origin;
    let newestOverallTimestamp = null;

    const fetchPromises = Object.entries(USER_STATE_DEFS).map(async ([key, def]) => {
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
                console.log(`[DB] Fetching ${key} with If-None-Match.`); // Added logging
            } else { // Added logging
                console.log(`[DB] Fetching ${key} (no ETag).`); // Added logging
            } // Added logging
            const response = await fetch(url, { method: 'GET', headers: headers });
            if (response.status === 304) {
                console.log(`[DB] State for ${key}: 304 Not Modified.`); // Added logging
                if (localTimestamp && (!newestOverallTimestamp || localTimestamp > newestOverallTimestamp)) {
                    newestOverallTimestamp = localTimestamp;
                }
                return { key, status: 304 };
            }
            if (!response.ok) {
                if (response.status === 404) {
                    console.warn(`[DB] State key ${key} 404 on server. Using default.`); // Added logging
                    return { key, status: 404 };
                }
                console.error(`[DB] HTTP error for ${key}: ${response.status}`); // Added logging
                throw new Error(`HTTP error! status: ${response.status} for ${key}`);
            }
            const data = await response.json();
            console.log(`[DB] New data for ${key}.`); // Added logging
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
            console.error(`[DB] Failed to pull ${key}:`, error); // Added logging
            return { key, data: null, status: 'error', error };
        }
    });

    await Promise.all(fetchPromises);
    if (newestOverallTimestamp) {
        await saveSimpleState('lastStateSync', newestOverallTimestamp);
        console.log(`[DB] Updated lastStateSync to: ${newestOverallTimestamp}`); // Added logging
    } else { // Added logging
        console.log('[DB] No new overall timestamp.'); // Added logging
    } // Added logging
    _isPullingUserState = false;
    console.log('[DB] User state pull completed.'); // Added logging
}

export async function performFeedSync(app) {
    const db = await getDb();
    if (!isOnline()) {
        console.log('[DB] Offline. Skipping feed sync.'); // Added logging
        return;
    }
    console.log('[DB] Fetching feed items from server.'); // Added logging
    const API_BASE_URL = window.location.origin;
    try {
        const { value: lastFeedSyncTime } = await loadSimpleState('lastFeedSync');
        const sinceTimestamp = lastFeedSyncTime || '';
        const guidsResponse = await fetch(`${API_BASE_URL}/api/feed-guids?since=${sinceTimestamp}`);
        if (!guidsResponse.ok) {
            console.error(`[DB] HTTP error! status: ${guidsResponse.status} for /api/feed-guids`); // Added logging
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
        console.log(`[DB] New/updated GUIDs: ${guidsToFetch.length}, Deleting: ${guidsToDelete.length}`); // Changed logging
        const BATCH_SIZE = 50;
        for (let i = 0; i < guidsToFetch.length; i += BATCH_SIZE) {
            const batch = guidsToFetch.slice(i, i + BATCH_SIZE);
            const itemsResponse = await fetch(`${API_BASE_URL}/feed-items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guids: batch })
            });
            if (!itemsResponse.ok) {
                console.error(`[DB] HTTP error! status: ${itemsResponse.status} for /feed-items batch.`); // Added logging
                continue;
            }
            const newItems = await itemsResponse.json();
            const tx = db.transaction(['feedItems'], 'readwrite');
            const feedStore = tx.objectStore('feedItems');
            for (const item of newItems) {
                await feedStore.put(item);
                console.log(`[DB] Stored item: ${item.guid}`); // Added logging
            }
            for (const guidToDelete of guidsToDelete) {
                if (!new Set(newItems.map(i => i.guid)).has(guidToDelete)) {
                    await feedStore.delete(guidToDelete);
                    console.log(`[DB] Deleted item: ${guidToDelete}`); // Added logging
                }
            }
            await tx.done;
        }
        if (serverTime) {
            await saveSimpleState('lastFeedSync', serverTime);
            console.log(`[DB] Updated lastFeedSync to: ${serverTime}`); // Added logging
        }
        if (app && app.loadFeedItemsFromDB) {
            await app.loadFeedItemsFromDB();
        }
        if (app && app.updateCounts) {
            app.updateCounts();
        }
        console.log('[DB] Feed sync completed.'); // Added logging
    } catch (error) {
        console.error('[DB] Failed to synchronize feed:', error); // Added logging
    }
}

export async function performFullSync(app) {
    console.log('[DB] Full sync initiated.'); // Added logging
    try {
        await pullUserState();
        await performFeedSync(app);
        console.log('[DB] Full sync completed successfully.'); // Added logging
    } catch (error) {
        console.error('[DB] Full sync failed:', error); // Added logging
    }
}