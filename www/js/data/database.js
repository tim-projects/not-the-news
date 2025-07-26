// database.js:
import { openDB } from '../../libs/idb.js';

export const bufferedChanges = [];
export const pendingOperations = [];
export const isOnline = () => navigator.onLine;

export async function addPendingOperation(db, operation) {
    const tx = db.transaction('pendingOperations', 'readwrite');
    await tx.objectStore('pendingOperations').add(operation);
    await tx.done;
}

export const dbPromise = openDB('not-the-news-db', 5, {
    async upgrade(db, oldV) {
        if (oldV < 1) {
            const s = db.createObjectStore('items', { keyPath: 'guid' });
            s.createIndex('by-lastSync', 'lastSync');
        }
        if (oldV < 2) {
            db.createObjectStore('userState', { keyPath: 'key' });
        }
        if (oldV < 4) {
            db.createObjectStore('userSettings', { keyPath: 'key' });
            const starredItems = db.createObjectStore('starredItems', { keyPath: 'id' });
            starredItems.createIndex('by-starredAt', 'starredAt');
            const hiddenItems = db.createObjectStore('hiddenItems', { keyPath: 'id' });
            hiddenItems.createIndex('by-hiddenAt', 'hiddenAt');
            db.createObjectStore('pendingOperations', { keyPath: 'id', autoIncrement: true });
        }
        if (oldV >= 2 && oldV < 4) {
            const tx = db.transaction('userState', 'readwrite');
            const userStateStore = tx.objectStore('userState');
            const settingsKeys = ['filterMode', 'syncEnabled', 'imagesEnabled', 'openUrlsInNewTabEnabled', 'rssFeeds', 'keywordBlacklist', 'shuffleCount', 'lastShuffleResetDate', 'lastStateSync', 'currentDeckGuids'];
            for (const key of settingsKeys) {
                const entry = await userStateStore.get(key);
                if (entry) {
                    let value = entry.value;
                    if (typeof value === 'string' && key !== 'lastStateSync') {
                        try {
                            value = JSON.parse(value);
                        } catch (e) {
                            console.warn(`Could not parse JSON for key "${key}", using raw value.`, value, e);
                        }
                    }
                    await db.transaction('userSettings', 'readwrite').objectStore('userSettings').put({ key: key, value: value });
                }
            }
            await tx.done;
            const starredEntry = await userStateStore.get('starred');
            if (starredEntry) {
                try {
                    const starredItems = JSON.parse(starredEntry.value);
                    for (const item of starredItems) {
                        if (item && item.id) {
                            await db.transaction('starredItems', 'readwrite').objectStore('starredItems').put(item);
                        }
                    }
                } catch (e) {
                    console.warn("Could not parse starred items, skipping migration.", starredEntry.value, e);
                }
            }
            const hiddenEntry = await userStateStore.get('hidden');
            if (hiddenEntry) {
                try {
                    const hiddenItems = JSON.parse(hiddenEntry.value);
                    for (const item of hiddenItems) {
                        if (item && item.id) {
                            await db.transaction('hiddenItems', 'readwrite').objectStore('hiddenItems').put(item);
                        }
                    }
                } catch (e) {
                    console.warn("Could not parse hidden items, skipping migration.", hiddenEntry.value, e);
                }
            }
            await tx.done;
            db.deleteObjectStore('userState');
        }
    }
});

export async function fetchWithRetry(url, opts = {}, retries = 3, backoff = 500) {
    if (!isOnline()) throw new Error('Offline');
    try {
        return await fetch(url, opts);
    } catch (err) {
        if (retries === 0) throw err;
        await new Promise(r => setTimeout(r, backoff));
        return fetchWithRetry(url, opts, retries - 1, backoff * 2);
    }
}

export async function performFeedSync(db) {
    if (!isOnline()) return Date.now();

    const { time: srvTime } = await fetchWithRetry('/time').then(res => res.json());
    const syncTS = Date.parse(srvTime);
    const cutoffTS = syncTS - 30 * 86400 * 1000;

    const allGuids = await fetchWithRetry('/guids').then(res => res.json());

    const txRO = db.transaction('items', 'readonly');
    const localItems = await txRO.objectStore('items').getAll();
    const localGuids = new Set(localItems.map(i => i.guid));

    const guidsToDel = localItems.filter(i => !allGuids.includes(i.guid) && i.lastSync < cutoffTS).map(i => i.guid);
    if (guidsToDel.length) {
        const txRW = db.transaction('items', 'readwrite');
        await Promise.all(guidsToDel.map(g => txRW.objectStore('items').delete(g)));
        await txRW.done;
    }

    const newGuids = allGuids.filter(g => !localGuids.has(g));
    const BATCH_SIZE = 50;
    for (let i = 0; i < newGuids.length; i += BATCH_SIZE) {
        const batch = newGuids.slice(i, i + BATCH_SIZE);
        const res = await fetchWithRetry(`/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guids: batch })
        });
        const data = await res.json();
        const txRW = db.transaction('items', 'readwrite');
        batch.forEach(g => {
            const item = data[g];
            item.lastSync = syncTS;
            txRW.objectStore('items').put(item);
        });
        await txRW.done;
    }

    const existingGuids = allGuids.filter(g => localGuids.has(g));
    for (let i = 0; i < existingGuids.length; i += BATCH_SIZE) {
        const batch = existingGuids.slice(i, i + BATCH_SIZE);
        const txRW = db.transaction('items', 'readwrite');
        const s = txRW.objectStore('items');
        for (let g of batch) {
            const item = await s.get(g);
            if (item) {
                item.lastSync = syncTS;
                s.put(item);
            }
        }
        await txRW.done;
    }
    return syncTS;
}

function mergeHiddenStates(local, remote) {
    const mergedMap = new Map();
    local.forEach(item => mergedMap.set(item.id, item));
    remote.forEach(item => {
        if (!mergedMap.has(item.id) || (item.hiddenAt && new Date(item.hiddenAt) > new Date(mergedMap.get(item.id).hiddenAt))) {
            mergedMap.set(item.id, item);
        }
    });
    return Array.from(mergedMap.values());
}

function mergeStarredStates(local, remote) {
    const mergedMap = new Map();
    local.forEach(item => mergedMap.set(item.id, item));
    remote.forEach(item => {
        if (!mergedMap.has(item.id) || (item.starredAt && new Date(item.starredAt) > new Date(mergedMap.get(item.id).starredAt))) {
            mergedMap.set(item.id, item);
        }
    });
    return Array.from(mergedMap.values());
}

export async function pullUserState(db) {
    if (!isOnline()) return null;
    const lastSyncEntry = await db.transaction('userSettings', 'readonly').objectStore('userSettings').get('lastStateSync') || { value: null };
    const lastSyncNonce = lastSyncEntry.value;
    const headers = lastSyncNonce ? { 'If-None-Match': lastSyncNonce } : {};
    let responseText;
    try {
        const res = await fetchWithRetry('/user-state', { headers });
        if (res.status === 304) {
            console.log('[pullUserState] User state: No changes from server (304 Not Modified).');
            return lastSyncEntry.value;
        }
        if (!res.ok) {
            const errorText = await res.text();
            console.error(`[pullUserState] Server returned an error: ${res.status} ${res.statusText}`);
            console.error('[pullUserState] Server error response body:', errorText);
            throw new Error(`Failed to fetch user state: ${res.status} ${res.statusText}`);
        }
        responseText = await res.text();
        console.log('[pullUserState] Raw response text length:', responseText.length);
        console.log('[pullUserState] Raw response text START (first 200 chars):', responseText.substring(0, 200));
        console.log('[pullUserState] Raw response text END (last 200 chars):', responseText.substring(responseText.length - 200));
        console.log('[pullUserState] Raw response text FULL:', responseText);
        let data;
        try {
            data = JSON.parse(responseText);
            console.log('[pullUserState] Successfully parsed JSON data.');
        } catch (parseError) {
            console.error('[pullUserState] JSON parsing failed! Raw text was:', responseText);
            console.error('[pullUserState] JSON parsing error:', parseError);
            throw parseError;
        }
        const { userState, serverTime } = data;
        const tx = db.transaction(['userState', 'starredItems', 'hiddenItems'], 'readwrite');
        await tx.objectStore('starredItems').clear();
        if (userState.starred) {
            for (const item of userState.starred) {
                await tx.objectStore('starredItems').put(item);
            }
        }
        await tx.objectStore('hiddenItems').clear();
        if (userState.hidden) {
            for (const item of userState.hidden) {
                await tx.objectStore('hiddenItems').put(item);
            }
        }
        const simpleStateKeys = ['filterMode', 'syncEnabled', 'imagesEnabled', 'openUrlsInNewTabEnabled', 'rssFeeds', 'keywordBlacklist', 'shuffleCount', 'lastShuffleResetDate', 'currentDeckGuids'];
        for (const key of simpleStateKeys) {
            if (userState.hasOwnProperty(key)) {
                await tx.objectStore('userSettings').put({ key: key, value: userState[key] });
            }
        }
        await tx.objectStore('userSettings').put({ key: 'lastStateSync', value: serverTime });
        await tx.done;
        console.log('[pullUserState] User state pulled and merged successfully.');
        return serverTime;
    } catch (error) {
        console.error('[pullUserState] Failed to pull user state:', error);
        throw error;
    }
}

export async function pushUserState(db, changes = bufferedChanges) {
    if (changes.length === 0) return;

    if (!isOnline()) {
        pendingOperations.push({ type: 'pushUserState', data: JSON.parse(JSON.stringify(changes)) });
        console.warn("Offline: Queued user state changes for later push.");
        return;
    }

    const compiledChanges = {};
    for (const { key, value } of changes) {
        compiledChanges[key] = JSON.stringify(value);
    }

    try {
        const res = await fetchWithRetry('/user-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ userState: compiledChanges })
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`pushUserState failed ${res.status}: ${errorText}`);
        }

        const { serverTime } = await res.json();
        const tx = db.transaction('userSettings', 'readwrite');
        tx.objectStore('userSettings').put({ key: 'lastStateSync', value: serverTime });
        await tx.done;
        changes.length = 0;
        console.log('User state changes pushed successfully.');
    } catch (error) {
        console.error('Failed to push user state changes:', error);
        throw error;
    }
}

export async function performFullSync(db) {
    console.log("Performing full sync...");
    const feedT = await performFeedSync(db);
    const stateT = await pullUserState(db);
    await pushUserState(db);
    console.log("Full sync completed.");
    return { feedTime: feedT, stateTime: stateT };
}

export async function loadStateValue(db, key, defaultValue) {
    const entry = await db.transaction('userSettings', 'readonly').objectStore('userSettings').get(key);
    let value = entry?.value;
    if (value === undefined || value === null) {
        return defaultValue;
    }
    return value;
}

export async function saveStateValue(db, key, value) {
    const tx = db.transaction('userSettings', 'readwrite');
    tx.objectStore('userSettings').put({ key: key, value: value });
    await tx.done;
    if (['filterMode', 'syncEnabled', 'imagesEnabled', 'openUrlsInNewTabEnabled', 'rssFeeds', 'keywordBlacklist', 'shuffleCount', 'lastShuffleResetDate'].includes(key)) {
        
    }
}

export async function loadArrayState(db, key) {
    const entry = await db.transaction('userState', 'readonly').objectStore('userState').get(key);
    let items = [];
    if (entry?.value != null) {
        try { items = JSON.parse(entry.value); } catch (e) {
            console.warn(`[loadArrayState] Could not parse JSON for array key "${key}", returning empty array. Value:`, entry.value, e);
        }
    }
    return Array.isArray(items) ? items : [];
}

export async function loadStarredItems(db) {
    return await db.transaction('starredItems', 'readonly').objectStore('starredItems').getAll() || [];
}
export async function loadHiddenItems(db) {
    return await db.transaction('hiddenItems', 'readonly').objectStore('hiddenItems').getAll() || [];
}

export async function saveArrayState(db, key, arr) {
    const tx = db.transaction('userSettings', 'readwrite');
    tx.objectStore('userSettings').put({ key: key, value: arr });
    await tx.done;
}

export async function processPendingOperations(db) {
    if (!isOnline()) return;

    const allPendingOps = await db.transaction('pendingOperations', 'readwrite').objectStore('pendingOperations').getAll();
    if (allPendingOps.length === 0) return;

    const opsToDelete = [];

    for (const op of allPendingOps) {
        try {
            switch (op.type) {
                case 'pushUserState':
                    await pushUserState(db, op.data);
                    opsToDelete.push(op.id);
                    break;
                case 'starDelta':
                    await fetchWithRetry("/user-state/starred/delta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.data) });
                    opsToDelete.push(op.id);
                    break;
                case 'hiddenDelta':
                    await fetchWithRetry("/user-state/hidden/delta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.data) });
                    opsToDelete.push(op.id);
                    break;
                default: console.warn(`Unknown pending operation type: ${op.type}`);
            }
        } catch (err) {
            console.error(`Failed to process pending operation of type "${op.type}":`, err);
        }
    }
    
    if (opsToDelete.length > 0) {
        const tx = db.transaction('pendingOperations', 'readwrite');
        for (const id of opsToDelete) {
            await tx.objectStore('pendingOperations').delete(id);
        }
        await tx.done;
        console.log(`Processed and removed ${opsToDelete.length} pending operations.`);
    }

    const remainingOpsCount = await db.transaction('pendingOperations', 'readonly').objectStore('pendingOperations').count();
    if (remainingOpsCount > 0) {
        console.warn(`${remainingOpsCount} operations failed and remain in the queue.`);
    } else {
        console.log("Finished processing all pending operations.");
    }
}