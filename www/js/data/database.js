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
        compiledChanges[key] = value;
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

export async function loadStateValue(db, key, defaultValue) {
    const entry = await db.transaction('userState', 'readonly').objectStore('userState').get(key);
    return entry?.value ?? defaultValue;
}

export async function saveStateValue(db, key, value) {
    const tx = db.transaction('userState', 'readwrite');
    tx.objectStore('userState').put({ key: key, value: value });
    await tx.done;
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
}

export async function processPendingOperations(db) {
    if (!isOnline() || pendingOperations.length === 0) return;

    const opsToProcess = pendingOperations.splice(0);
    for (const op of opsToProcess) {
        try {
            switch (op.type) {
                case 'pushUserState': await pushUserState(db, op.data); break;
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
            pendingOperations.push(op);
        }
    }
}