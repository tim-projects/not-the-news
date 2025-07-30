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

        if ((operation.type === 'starDelta' || operation.type === 'hiddenDelta') && isOnline()) {
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
                    if (responseData.serverTime) {
                        const { value: currentLastStateSync } = await loadSimpleState('lastStateSync');
                        if (!currentLastStateSync || responseData.serverTime > currentLastStateSync) {
                            await saveSimpleState('lastStateSync', responseData.serverTime);
                        }
                    }
                } else {
                }
            } catch (networkError) {
            }
        }
    } catch (e) {
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
    } catch (e) {
        throw e;
    }
}

export async function processPendingOperations() {
    const db = await getDb();
    if (!isOnline()) {
        return;
    }
    let operations;
    try {
        const fetchTx = db.transaction('pendingOperations', 'readonly');
        operations = await fetchTx.objectStore('pendingOperations').getAll();
        await fetchTx.done;
    } catch (e) {
        return;
    }
    if (operations.length === 0) {
        return;
    }
    const API_BASE_URL = window.location.origin;

    try {
        const operationsToSync = [];
        for (const op of operations) {
            if (op.type === 'simpleUpdate' || op.type === 'starDelta' || op.type === 'hiddenDelta') {
                operationsToSync.push(op);
            }
        }
        if (operationsToSync.length === 0) {
            return;
        }
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
        if (responseData.results && Array.isArray(responseData.results)) {
            const tx = db.transaction('pendingOperations', 'readwrite');
            const store = tx.objectStore('pendingOperations');
            for (const result of responseData.results) {
                if (result.status === 'success' && result.id !== undefined) {
                    await store.delete(result.id);
                }
            }
            await tx.done;
        }
        if (responseData.serverTime) {
            await saveSimpleState('lastStateSync', responseData.serverTime);
        }
    } catch (error) {
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
        return 0;
    }
}

let _isPullingUserState = false;
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500;

export async function pullUserState() {
    const db = await getDb();
    if (_isPullingUserState) {
        return;
    }
    const now = Date.now();
    if (now - _lastPullAttemptTime < PULL_DEBOUNCE_MS) {
        return;
    }
    _lastPullAttemptTime = now;
    _isPullingUserState = true;
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
            }
            const response = await fetch(url, { method: 'GET', headers: headers });
            if (response.status === 304) {
                if (localTimestamp && (!newestOverallTimestamp || localTimestamp > newestOverallTimestamp)) {
                    newestOverallTimestamp = localTimestamp;
                }
                return { key, status: 304 };
            }
            if (!response.ok) {
                if (response.status === 404) {
                    return { key, status: 404 };
                }
                throw new Error(`HTTP error! status: ${response.status} for ${key}`);
            }
            const data = await response.json();
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
            return { key, data: null, status: 'error', error };
        }
    });

    await Promise.all(fetchPromises);
    if (newestOverallTimestamp) {
        await saveSimpleState('lastStateSync', newestOverallTimestamp);
    }
    _isPullingUserState = false;
}

export async function performFeedSync(app) {
    const db = await getDb();
    if (!isOnline()) {
        return;
    }
    const API_BASE_URL = window.location.origin;
    try {
        const { value: lastFeedSyncTime } = await loadSimpleState('lastFeedSync');
        const sinceTimestamp = lastFeedSyncTime || '';
        const guidsResponse = await fetch(`${API_BASE_URL}/api/feed-guids?since=${sinceTimestamp}`);
        if (!guidsResponse.ok) {
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
        const BATCH_SIZE = 50;
        for (let i = 0; i < guidsToFetch.length; i += BATCH_SIZE) {
            const batch = guidsToFetch.slice(i, i + BATCH_SIZE);
            const itemsResponse = await fetch(`${API_BASE_URL}/feed-items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guids: batch })
            });
            if (!itemsResponse.ok) {
                continue;
            }
            const newItems = await itemsResponse.json();
            const tx = db.transaction(['feedItems'], 'readwrite');
            const feedStore = tx.objectStore('feedItems');
            for (const item of newItems) {
                await feedStore.put(item);
            }
            for (const guidToDelete of guidsToDelete) {
                if (!new Set(newItems.map(i => i.guid)).has(guidToDelete)) {
                    await feedStore.delete(guidToDelete);
                }
            }
            await tx.done;
        }
        if (serverTime) {
            await saveSimpleState('lastFeedSync', serverTime);
        }
        if (app && app.loadFeedItemsFromDB) {
            await app.loadFeedItemsFromDB();
        }
        if (app && app.updateCounts) {
            app.updateCounts();
        }
    } catch (error) {
    }
}

export async function performFullSync(app) {
    try {
        await pullUserState();
        await performFeedSync(app);
    } catch (error) {
    }
}