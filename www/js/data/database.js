import { openDB } from '../../libs/idb.js';

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

export async function pullUserState(db) {
    if (!isOnline()) return null;

    const lastSyncEntry = await db.get('userState', 'lastStateSync') || { value: null };
    const lastSyncNonce = lastSyncEntry.value;
    const headers = lastSyncNonce ? { 'If-None-Match': lastSyncNonce } : {};

    const res = await fetchWithRetry('/user-state?since=' + encodeURIComponent(lastSyncNonce || ''), { headers });

    if (res.status === 304) return lastSyncEntry.value;

    const { changes, serverTime } = await res.json();
    const tx = db.transaction('userState', 'readwrite');
    for (let [k, v] of Object.entries(changes)) {
        // pullUserState already stringifies `v` before putting it. This is correct if all userState values are strings.
        tx.objectStore('userState').put({ key: k, value: JSON.stringify(v) });
    }
    tx.objectStore('userState').put({ key: 'lastStateSync', value: serverTime });
    await tx.done;
    return serverTime;
}

export async function pushUserState(db, changes = bufferedChanges) {
    if (changes.length === 0) return;

    if (!isOnline()) {
        pendingOperations.push({ type: 'pushUserState', data: JSON.parse(JSON.stringify(changes)) });
        return;
    }

    const compiledChanges = {};
    for (const { key, value } of changes) {
        // Ensure values are consistently stringified for sending
        compiledChanges[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    const payload = JSON.stringify({ changes: compiledChanges });

    const res = await fetchWithRetry('/user-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: payload
    });

    if (!res.ok) {
        console.error(`pushUserState failed ${res.status}:`, await res.text());
        return;
    }

    const { serverTime } = await res.json();
    const tx = db.transaction('userState', 'readwrite');
    // The serverTime itself should not be stringified here if it's a raw value
    tx.objectStore('userState').put({ key: 'lastStateSync', value: serverTime });
    await tx.done;
    changes.length = 0;
}

export async function performFullSync(db) {
    const feedT = await performFeedSync(db);
    const stateT = await pullUserState(db);
    await pushUserState(db);
    return { feedTime: feedT, stateTime: stateT };
}

// *** CRITICAL FIX: Make loadStateValue always parse the JSON string ***
export async function loadStateValue(db, key, defaultValue) {
    const entry = await db.transaction('userState', 'readonly').objectStore('userState').get(key);
    let value = entry?.value;

    if (value === undefined || value === null) {
        return defaultValue;
    }

    // Attempt to parse if it's a string.
    // This handles values like 'true', '"some string"', '123', or '[...]'
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (e) {
            // If it's a plain string that can't be parsed (e.g., just "hello"), return it as is.
            // This case needs careful handling: if server sends "hello" (no quotes) and it's not JSON,
            // JSON.parse fails. But if server sends "hello" (with quotes), it parses to "hello".
            // The expectation from pullUserState is that everything is JSON.stringify'd on the server side too.
            // If the server sends raw string values for some keys, and JSON.stringify'd for others,
            // this strategy needs refinement.
            // For now, assume everything from server is JSON.stringify'd if it's not a primitive.
            // A safer approach might involve explicit type mapping or just returning the string if parsing fails.
            // However, given `pullUserState` stringifies ALL values from server changes, this should be consistent.
            console.warn(`Could not parse value for key "${key}":`, value, e);
            return value; // Fallback to returning the raw string if parsing fails
        }
    }
    return value; // Return as is if it's not a string (e.g., lastStateSync might be stored directly)
}

export async function saveStateValue(db, key, value) {
    const tx = db.transaction('userState', 'readwrite');
    // *** FIX: Stringify all values before saving to userState store, except 'lastStateSync' if it's a raw timestamp/nonce ***
    // Assuming 'lastStateSync' is a raw string/number that shouldn't be stringified twice.
    // All other values (booleans, numbers, strings, objects, arrays) should be stringified.
    const valToSave = (key === 'lastStateSync') ? value : JSON.stringify(value);
    tx.objectStore('userState').put({ key: key, value: valToSave });
    await tx.done;
    // Add to bufferedChanges only if it's NOT lastStateSync and it's a user setting that needs syncing
    if (key !== 'lastStateSync' && ['filterMode', 'syncEnabled', 'imagesEnabled', 'rssFeeds', 'keywordBlacklist'].includes(key)) {
        bufferedChanges.push({ key, value: value }); // Push the original value, not the stringified one
        // Optionally, debounce or schedule pushUserState here instead of buffering.
        // For now, assume pushUserState is called periodically or on certain events.
    }
}

export async function loadArrayState(db, key) {
    const entry = await db.transaction('userState', 'readonly').objectStore('userState').get(key);
    let items = [];
    if (entry?.value != null) {
        try { items = JSON.parse(entry.value); } catch {}
    }
    return Array.isArray(items) ? items : [];
}

export async function saveArrayState(db, key, arr) {
    const tx = db.transaction('userState', 'readwrite');
    tx.objectStore('userState').put({ key: key, value: JSON.stringify(arr) });
    await tx.done;
    // Add to bufferedChanges only if it's a user setting that needs syncing
    if (['starred', 'hidden', 'currentDeck'].includes(key)) {
        bufferedChanges.push({ key, value: arr }); // Push the original array
    }
}

export async function processPendingOperations(db) {
    if (!isOnline() || pendingOperations.length === 0) return;

    const opsToProcess = pendingOperations.splice(0);
    for (const op of opsToProcess) {
        try {
            switch (op.type) {
                case 'pushUserState':
                    // op.data for 'pushUserState' is already an array of {key, value} objects
                    // pushUserState expects an array of changes, where value might not be stringified yet
                    await pushUserState(db, op.data);
                    break;
                case 'starDelta':
                    await fetchWithRetry("/user-state/starred/delta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.data) });
                    break;
                case 'hiddenDelta':
                    await fetchWithRetry("/user-state/hidden/delta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.data) });
                    break;
                default: console.warn(`Unknown op: ${op.type}`);
            }
        } catch (err) {
            console.error(`Failed to process ${op.type}`, err);
            pendingOperations.push(op); // Push back failed operations
        }
    }
}