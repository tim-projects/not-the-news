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

// Helper functions for merging (Moved here for better encapsulation if not in userStateUtils.js)
function mergeHiddenStates(local, remote) {
    const mergedMap = new Map();
    local.forEach(item => mergedMap.set(item.id, item));
    remote.forEach(item => {
        if (!mergedMap.has(item.id) || new Date(item.hiddenAt) > new Date(mergedMap.get(item.id).hiddenAt)) {
            mergedMap.set(item.id, item);
        }
    });
    return Array.from(mergedMap.values());
}

function mergeStarredStates(local, remote) {
    const mergedMap = new Map();
    local.forEach(item => mergedMap.set(item.id, item));
    remote.forEach(item => {
        if (!mergedMap.has(item.id) || new Date(item.starredAt) > new Date(mergedMap.get(item.id).starredAt)) {
            mergedMap.set(item.id, item);
        }
    });
    return Array.from(mergedMap.values());
}


export async function pullUserState(db) {
    if (!isOnline()) return null;

    // The 'lastStateSync' key stores a nonce/timestamp from the server
    const lastSyncEntry = await db.get('userState', 'lastStateSync') || { value: null };
    const lastSyncNonce = lastSyncEntry.value;
    const headers = lastSyncNonce ? { 'If-None-Match': lastSyncNonce } : {};

    try {
        // Assuming your server has an endpoint to pull user state changes or full state
        const res = await fetchWithRetry('/user-state', { headers }); // Assuming /user-state returns full state or changes since nonce

        // If server indicates no new changes
        if (res.status === 304) {
            console.log('User state: No changes from server (304 Not Modified).');
            return lastSyncEntry.value; // Return the current nonce
        }

        if (!res.ok) {
            throw new Error(`Server error pulling user state: ${res.statusText}`);
        }

        const { userState, serverTime } = await res.json(); // Assuming server returns { userState: { hidden: [...], starred: [...], currentDeckGuids: [...] }, serverTime: "nonce" }

        const tx = db.transaction('userState', 'readwrite');
        const store = tx.objectStore('userState');

        // --- MERGE/UPDATE LOGIC FOR EACH USER STATE ---

        // Hidden state
        const localHidden = await store.get('hidden') || { value: [] };
        const newHidden = mergeHiddenStates(JSON.parse(localHidden.value || '[]'), userState.hidden || []);
        await store.put({ key: 'hidden', value: JSON.stringify(newHidden) });

        // Starred state
        const localStarred = await store.get('starred') || { value: [] };
        const newStarred = mergeStarredStates(JSON.parse(localStarred.value || '[]'), userState.starred || []);
        await store.put({ key: 'starred', value: JSON.stringify(newStarred) });

        // Current Deck GUIDs: Simple "server wins" strategy for now.
        // If serverState.currentDeckGuids is null/undefined, keep local.
        const serverDeck = userState.currentDeckGuids || [];
        await store.put({ key: 'currentDeckGuids', value: JSON.stringify(serverDeck) });


        // Other simple states (filterMode, syncEnabled, imagesEnabled, rssFeeds, keywordBlacklist, shuffleCount, lastShuffleResetDate)
        // Iterate over potential keys and apply server value if present
        const simpleStateKeys = ['filterMode', 'syncEnabled', 'imagesEnabled', 'rssFeeds', 'keywordBlacklist', 'shuffleCount', 'lastShuffleResetDate'];
        for (const key of simpleStateKeys) {
            if (userState.hasOwnProperty(key)) {
                // Values coming from the server might not be stringified yet,
                // so ensure they are stringified before storing.
                await store.put({ key: key, value: JSON.stringify(userState[key]) });
            }
        }

        // Save the new serverTime nonce
        await store.put({ key: 'lastStateSync', value: serverTime });

        await tx.done;
        console.log('User state pulled and merged successfully.');
        return serverTime;
    } catch (error) {
        console.error('Failed to pull user state:', error);
        throw error; // Re-throw to propagate error
    }
}

export async function pushUserState(db, changes = bufferedChanges) {
    if (changes.length === 0) return;

    // Use a unique ID for this batch of operations, if you want server to handle idempotency
    // const batchId = Date.now().toString();

    if (!isOnline()) {
        pendingOperations.push({ type: 'pushUserState', data: JSON.parse(JSON.stringify(changes)) });
        console.warn("Offline: Queued user state changes for later push.");
        return;
    }

    const compiledChanges = {};
    for (const { key, value } of changes) {
        // Ensure values are consistently stringified for sending
        // If value is already a string (e.g., a simple text input), send as is.
        // Otherwise, JSON.stringify complex types (arrays, objects, booleans, numbers).
        compiledChanges[key] = (typeof value === 'string' && !['rssFeeds', 'keywordBlacklist'].includes(key)) ? value : JSON.stringify(value);
        // Special handling for rssFeeds/keywordBlacklist if they are always string values on client.
        // The original line `typeof value === 'string' ? value : JSON.stringify(value)` works for most cases
        // but can stringify `"true"` to `""true""`. Better to parse, then stringify.
        // Or simpler: always JSON.stringify everything except the nonce.
        // Let's stick to the current logic: if it's a string, send as is (assuming it's a primitive string),
        // otherwise stringify.
        // For 'rssFeeds' and 'keywordBlacklist', their `value` in `bufferedChanges` will be the raw string from input.
        // So, `typeof value === 'string'` will be true, and they'll be sent as is.
        // For arrays/objects, it will be JSON.stringify(value).
        // This line as it was is fine, assuming `value` is the raw form (not stringified already).
    }

    try {
        const res = await fetchWithRetry('/user-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ userState: compiledChanges /*, batchId: batchId */ }) // Send the compiled changes
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`pushUserState failed ${res.status}: ${errorText}`);
        }

        const { serverTime } = await res.json(); // Assuming server returns { serverTime: "nonce" }
        const tx = db.transaction('userState', 'readwrite');
        tx.objectStore('userState').put({ key: 'lastStateSync', value: serverTime });
        await tx.done;
        changes.length = 0; // Clear buffered changes after successful push
        console.log('User state changes pushed successfully.');
    } catch (error) {
        console.error('Failed to push user state changes:', error);
        // Do not clear changes if push fails, they remain buffered for next attempt.
        throw error; // Re-throw to propagate error
    }
}

export async function performFullSync(db) {
    console.log("Performing full sync...");
    const feedT = await performFeedSync(db);
    // After performing feed sync (which fetches items), pull user state to ensure consistency,
    // as the deck might contain new items.
    const stateT = await pullUserState(db);
    // Push any pending local changes after pulling server's latest state.
    await pushUserState(db); // pushUserState uses bufferedChanges by default
    console.log("Full sync completed.");
    return { feedTime: feedT, stateTime: stateT };
}

// *** CRITICAL FIX: Make loadStateValue always parse the JSON string ***
// This function needs to be robust for all types of values stored in userState.
export async function loadStateValue(db, key, defaultValue) {
    const entry = await db.transaction('userState', 'readonly').objectStore('userState').get(key);
    let value = entry?.value;

    if (value === undefined || value === null) {
        return defaultValue;
    }

    // Attempt to parse if it's a string. Values saved by saveStateValue and pullUserState
    // should generally be JSON stringified for complex types and primitives.
    if (typeof value === 'string') {
        try {
            // This correctly parses "true" to true, "123" to 123, "[...]" to array, "{...}" to object.
            // If it's a simple string like "hello" (which was intentionally not stringified), it will throw,
            // so we return the string itself in the catch block.
            return JSON.parse(value);
        } catch (e) {
            // This catch block handles cases where the stored string value is NOT valid JSON.
            // E.g., if 'lastStateSync' stores a raw nonce string like "some-random-guid", JSON.parse would fail.
            // In such cases, we return the raw string.
            // console.warn(`loadStateValue: Could not parse JSON for key "${key}", returning raw string. Value:`, value);
            return value; // Return the raw string if it's not valid JSON
        }
    }
    return value; // If it's not a string (e.g., it was stored as a number/boolean directly, though current saveStateValue stringifies), return as is.
}


export async function saveStateValue(db, key, value) {
    const tx = db.transaction('userState', 'readwrite');
    // All values (booleans, numbers, strings, objects, arrays) should be stringified
    // when stored in IndexedDB's userState store, except 'lastStateSync' which is a nonce/timestamp.
    const valToSave = (key === 'lastStateSync') ? value : JSON.stringify(value);
    tx.objectStore('userState').put({ key: key, value: valToSave });
    await tx.done;

    // Add to bufferedChanges if it's a user setting that needs syncing.
    // Ensure we push the ORIGINAL value, not the stringified one, to bufferedChanges.
    // 'currentDeckGuids' should be handled by saveArrayState for consistency with other arrays.
    if (['filterMode', 'syncEnabled', 'imagesEnabled', 'rssFeeds', 'keywordBlacklist', 'shuffleCount', 'lastShuffleResetDate'].includes(key)) {
        bufferedChanges.push({ key, value: value });
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
    // Add to bufferedChanges for syncing. Ensure the key here is 'currentDeckGuids', not just 'currentDeck'.
    if (['starred', 'hidden', 'currentDeckGuids'].includes(key)) { // Changed 'currentDeck' to 'currentDeckGuids'
        bufferedChanges.push({ key, value: arr }); // Push the original array
    }
}

export async function processPendingOperations(db) {
    if (!isOnline() || pendingOperations.length === 0) return;

    const opsToProcess = pendingOperations.splice(0); // Take all pending operations
    console.log(`Processing ${opsToProcess.length} pending operations...`);

    for (const op of opsToProcess) {
        try {
            switch (op.type) {
                case 'pushUserState':
                    // op.data for 'pushUserState' is already an array of {key, value} objects (the bufferedChanges that were queued)
                    // pushUserState expects an array of changes.
                    await pushUserState(db, op.data);
                    break;
                case 'starDelta': // If you use delta endpoints for hidden/starred
                    await fetchWithRetry("/user-state/starred/delta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.data) });
                    break;
                case 'hiddenDelta': // If you use delta endpoints for hidden/starred
                    await fetchWithRetry("/user-state/hidden/delta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op.data) });
                    break;
                default: console.warn(`Unknown pending operation type: ${op.type}`);
            }
        } catch (err) {
            console.error(`Failed to process pending operation of type "${op.type}":`, err);
            // Re-queue the failed operation for a future attempt
            pendingOperations.push(op);
        }
    }
    if (pendingOperations.length > 0) {
        console.warn(`${pendingOperations.length} operations failed and were re-queued.`);
    }
    console.log("Finished processing pending operations.");
}