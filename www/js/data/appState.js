import { openDB } from '../libs/idb.js';

export const bufferedChanges = [];
export const pendingOperations = [];
export const isOnline = () => navigator.onLine;

export const dbPromise = openDB('not-the-news-db', 2, {
    upgrade(db, oldV) {
        if (oldV < 1) {
            const s = db.createObjectStore('items', { keyPath: 'guid' });
            s.createIndex('by-lastSync', 'lastSync');
        }
        if (oldV < 2) {
            db.createObjectStore('userState', { keyPath: 'key' });
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
    const cutoffTS = syncTS - 30 * 86400 * 1000; // 30 days

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

// Helper functions for merging (Moved here for better encapsulation if not in userStateUtils.js)
function mergeHiddenStates(local, remote) {
    const mergedMap = new Map();
    local.forEach(item => mergedMap.set(item.id, item));
    remote.forEach(item => {
        // Assuming 'hiddenAt' is a timestamp string, latest timestamp wins
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
        // Assuming 'starredAt' is a timestamp string, latest timestamp wins
        if (!mergedMap.has(item.id) || (item.starredAt && new Date(item.starredAt) > new Date(mergedMap.get(item.id).starredAt))) {
            mergedMap.set(item.id, item);
        }
    });
    return Array.from(mergedMap.values());
}


export async function pullUserState(db) {
    if (!isOnline()) return null;

    const lastSyncEntry = await db.get('userState', 'lastStateSync') || { value: null };
    const lastSyncNonce = lastSyncEntry.value;
    const headers = lastSyncNonce ? { 'If-None-Match': lastSyncNonce } : {};

    let responseText; // Declare outside try block for wider scope
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

        responseText = await res.text(); // Assign to wider scope variable
        console.log('[pullUserState] Raw response text length:', responseText.length);
        console.log('[pullUserState] Raw response text START (first 200 chars):', responseText.substring(0, 200));
        console.log('[pullUserState] Raw response text END (last 200 chars):', responseText.substring(responseText.length - 200));
        console.log('[pullUserState] Raw response text FULL:', responseText); // Log the full raw text for direct inspection

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

        // --- Fetch all local state needed for merging BEFORE starting the readwrite transaction ---
        const localHidden = await loadArrayState(db, 'hidden');
        const localStarred = await loadArrayState(db, 'starred');
        // No need to load other simple states if we're just overwriting them with server values or stringifying immediately


        // --- Start the readwrite transaction and perform all puts within it ---
        const tx = db.transaction('userState', 'readwrite');
        const store = tx.objectStore('userState');

        // Hidden state
        const newHidden = mergeHiddenStates(localHidden, userState.hidden || []);
        await store.put({ key: 'hidden', value: JSON.stringify(newHidden) });

        // Starred state
        const newStarred = mergeStarredStates(localStarred, userState.starred || []);
        await store.put({ key: 'starred', value: JSON.stringify(newStarred) });

        // Current Deck GUIDs: Simple "server wins" strategy for now.
        const serverDeck = userState.currentDeckGuids || [];
        await store.put({ key: 'currentDeckGuids', value: JSON.stringify(serverDeck) });

        // Other simple states (filterMode, syncEnabled, imagesEnabled, rssFeeds, keywordBlacklist, shuffleCount, lastShuffleResetDate)
        const simpleStateKeys = ['filterMode', 'syncEnabled', 'imagesEnabled', 'openUrlsInNewTabEnabled', 'rssFeeds', 'keywordBlacklist', 'shuffleCount', 'lastShuffleResetDate'];
        for (const key of simpleStateKeys) {
            if (userState.hasOwnProperty(key)) {
                await store.put({ key: key, value: JSON.stringify(userState[key]) });
            }
        }

        // Save the new serverTime nonce
        await store.put({ key: 'lastStateSync', value: serverTime });

        await tx.done; // Ensure the transaction completes
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
        pendingOperations.push({ type: 'pushUserState', data: JSON.parse(JSON.stringify(changes)) }); // Deep clone
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
        const tx = db.transaction('userState', 'readwrite');
        tx.objectStore('userState').put({ key: 'lastStateSync', value: serverTime });
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
    const entry = await db.transaction('userState', 'readonly').objectStore('userState').get(key);
    let value = entry?.value;

    if (value === undefined || value === null) {
        return defaultValue;
    }

    if (typeof value === 'string') {
        try {
            const parsedValue = JSON.parse(value);
            return parsedValue;
        } catch (e) {
            return value;
        }
    }
    return value;
}

export async function saveStateValue(db, key, value) {
    const tx = db.transaction('userState', 'readwrite');
    const valToSave = (key === 'lastStateSync') ? value : JSON.stringify(value);
    tx.objectStore('userState').put({ key: key, value: valToSave });
    await tx.done;

    if (['filterMode', 'syncEnabled', 'imagesEnabled', 'openUrlsInNewTabEnabled', 'rssFeeds', 'keywordBlacklist', 'shuffleCount', 'lastShuffleResetDate'].includes(key)) {
        bufferedChanges.push({ key, value: value });
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

export async function saveArrayState(db, key, arr) {
    const tx = db.transaction('userState', 'readwrite');
    tx.objectStore('userState').put({ key: key, value: JSON.stringify(arr) });
    await tx.done;
    if (['starred', 'hidden', 'currentDeckGuids'].includes(key)) {
        bufferedChanges.push({ key, value: arr });
    }
}

export async function processPendingOperations(db) {
    if (!isOnline() || pendingOperations.length === 0) return;

    const opsToProcess = pendingOperations.splice(0);

    for (const op of opsToProcess) {
        try {
            switch (op.type) {
                case 'pushUserState':
                    await pushUserState(db, op.data);
                    break;
                case 'starDelta':
                    await fetchWithRetry("/user-state/starred/delta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.data) });
                    break;
                case 'hiddenDelta':
                    await fetchWithRetry("/user-state/hidden/delta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.data) });
                    break;
                default: console.warn(`Unknown pending operation type: ${op.type}`);
            }
        } catch (err) {
            console.error(`Failed to process pending operation of type "${op.type}":`, err);
            pendingOperations.push(op);
        }
    }
    if (pendingOperations.length > 0) {
        console.warn(`${pendingOperations.length} operations failed and were re-queued.`);
    }
    console.log("Finished processing pending operations.");
}