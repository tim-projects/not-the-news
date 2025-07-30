// www/js/data/dbUserState.js

import { getDb } from './dbCore.js';
import { queueAndAttemptSyncOperation } from './dbSyncOperations.js';

// USER_STATE_DEFS no longer directly specifies keyPath,
// it just defines the store name. keyPath is defined in OBJECT_STORES_SCHEMA in dbCore.js
export const USER_STATE_DEFS = {
    // These 'array' types map to dedicated IndexedDB stores that use 'guid' as keyPath.
    // The items within these arrays/stores should always have a 'guid' property.
    starred: { store: 'starredItems', type: 'array', default: [] },
    hidden: { store: 'hiddenItems', type: 'array', default: [] },
    currentDeckGuids: { store: 'currentDeckGuids', type: 'array', default: [] }, // Stores objects like {guid: '...'}.
    shuffledOutGuids: { store: 'shuffledOutGuids', type: 'array', default: [] }, // Stores objects like {guid: '...'}.

    // These 'simple' types map to the 'userSettings' store, which uses 'key' as keyPath.
    filterMode: { store: 'userSettings', type: 'simple', default: 'all' },
    syncEnabled: { store: 'userSettings', type: 'simple', default: true },
    imagesEnabled: { store: 'userSettings', type: 'simple', default: true },
    rssFeeds: { store: 'userSettings', type: 'simple', default: [] }, // Stored as a simple value in userSettings
    keywordBlacklist: { store: 'userSettings', type: 'simple', default: [] }, // Stored as a simple value in userSettings
    shuffleCount: { store: 'userSettings', type: 'simple', default: 2 },
    lastShuffleResetDate: { store: 'userSettings', type: 'simple', default: null },
    openUrlsInNewTabEnabled: { store: 'userSettings', type: 'simple', default: true },
    lastViewedItemId: { store: 'userSettings', type: 'simple', default: null }, // This is a GUID, but stored as a simple setting.
    lastViewedItemOffset: { store: 'userSettings', type: 'simple', default: 0 }, // New: Ensure offset is included
    lastStateSync: { store: 'userSettings', type: 'simple', default: null },
    theme: { store: 'userSettings', type: 'simple', default: 'light' },
    lastFeedSync: { store: 'userSettings', type: 'simple', default: null },
};

export async function loadSimpleState(key, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'simple') { // Added def.type check for clarity
        console.error(`[DB] Invalid simple state key: ${key}.`);
        return { value: null, lastModified: null };
    }
    const storeName = 'userSettings'; // Simple states are stored in 'userSettings'
    let transaction = tx; // Use provided transaction or create a new one

    try {
        if (!transaction) { // Only create if no transaction was passed
            transaction = db.transaction(storeName, 'readonly');
        }
        const data = await transaction.objectStore(storeName).get(key);
        if (data && data.hasOwnProperty('value')) {
            return { value: data.value, lastModified: data.lastModified || null };
        }
    } catch (e) {
        console.error(`[DB] Error loading simple state "${key}":`, e);
    } finally {
        if (!tx && transaction) { // Only complete if *this function* created the transaction
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') { // Ignore AbortError if transaction was aborted by caller
                    console.error(`[DB] Transaction completion error for simple state "${key}":`, e);
                }
            }
        }
    }
    return { value: def.default, lastModified: null };
}

export async function saveSimpleState(key, value, serverTimestamp = null, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'simple') { // Added def.type check
        console.error(`[DB] Invalid simple state key: ${key}.`);
        throw new Error(`Invalid or undefined simple state key: ${key}`);
    }
    const storeName = 'userSettings'; // Simple states are stored in 'userSettings'
    let transaction = tx; // Use provided transaction or create a new one

    try {
        if (!transaction) { // Only create if no transaction was passed
            transaction = db.transaction(storeName, 'readwrite');
        }
        const objectStore = transaction.objectStore(storeName);
        const objToSave = { key: key, value: value }; // 'userSettings' keyPath is 'key'
        if (serverTimestamp) {
            objToSave.lastModified = serverTimestamp;
        } else {
            objToSave.lastModified = new Date().toISOString();
        }
        await objectStore.put(objToSave);
        console.log(`[DB] Saved "${key}" to userSettings.`);

        // These keys are managed as simple updates on the server.
        // `queueAndAttemptSyncOperation` will automatically remove 'guid' from the op if present.
        if (['filterMode', 'syncEnabled', 'imagesEnabled', 'shuffleCount', 'lastShuffleResetDate', 'openUrlsInNewTabEnabled', 'lastViewedItemId', 'lastViewedItemOffset', 'theme', 'rssFeeds', 'keywordBlacklist'].includes(key)) {
            // Note: `lastViewedItemOffset` added to the list for server sync if it's a simpleUpdate.
            const op = { type: 'simpleUpdate', key: key, value: value };
            // Pass the operation to queueAndAttemptSyncOperation.
            // It will buffer it and potentially sync. It handles its own transaction.
            await queueAndAttemptSyncOperation(op);
        }

    } catch (e) {
        console.error(`[DB] Error saving simple state "${key}":`, e);
        throw e;
    } finally {
        if (!tx && transaction) { // Only complete if *this function* created the transaction
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(`[DB] Transaction completion error for simple state "${key}":`, e);
                }
            }
        }
    }
}

export async function loadArrayState(key, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'array') { // Ensure it's defined as an 'array' type
        console.error(`[DB] Invalid array state key: ${key}`);
        return { value: def ? def.default : [], lastModified: null };
    }
    const arrayStoreName = def.store; // Get the specific store name (e.g., 'starredItems')
    let transaction = tx;

    try {
        if (!transaction) {
            // Include 'userSettings' in the transaction to load array metadata if needed
            transaction = db.transaction([arrayStoreName, 'userSettings'], 'readonly');
        }
        const arrayStore = transaction.objectStore(arrayStoreName);
        const allItems = await arrayStore.getAll(); // Get all items from the dedicated store

        // Load the lastModified timestamp for this array state, which is stored in 'userSettings'
        // Pass the existing transaction to loadSimpleState
        const { lastModified: arrayTimestamp } = await loadSimpleState(key, transaction);
        return { value: allItems, lastModified: arrayTimestamp };
    } catch (e) {
        console.error(`[DB] Error loading array state "${key}" from store "${arrayStoreName}":`, e);
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(`[DB] Transaction completion error for array state "${key}":`, e);
                }
            }
        }
    }
    return { value: def.default, lastModified: null };
}

export async function saveArrayState(key, arr, serverTimestamp = null, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'array') {
        throw new Error(`Invalid or undefined array state key: ${key}`);
    }
    const arrayStoreName = def.store; // Get the specific store name (e.g., 'starredItems')
    let transaction = tx;

    try {
        if (!transaction) {
            // Need 'readwrite' access to both the array store and 'userSettings' for metadata
            transaction = db.transaction([arrayStoreName, 'userSettings'], 'readwrite'); // Removed 'pendingOperations' here as queueAndAttemptSyncOperation handles its own tx
        }
        const arrayObjectStore = transaction.objectStore(arrayStoreName);
        await arrayObjectStore.clear(); // Clear existing data in the specific array store

        // Deep clone to avoid mutation issues and ensure compatibility with IndexedDB.
        // This is important if `arr` contains non-plain objects or circular references.
        const clonableArr = JSON.parse(JSON.stringify(arr));

        for (const item of clonableArr) {
            let itemToStore;
            let skipItem = false;

            // All array stores (`starredItems`, `hiddenItems`, `currentDeckGuids`, `shuffledOutGuids`)
            // use 'guid' as keyPath in dbCore.js.
            // Items must have a 'guid' property for `put` to work correctly.

            if (typeof item === 'string') {
                // If the item is just a plain GUID string, wrap it in an object.
                // This is common for `currentDeckGuids` and `shuffledOutGuids`.
                itemToStore = { guid: item };
            } else if (typeof item === 'object' && item !== null) {
                // If it's an object, it MUST have a 'guid' property.
                if (item.guid && typeof item.guid === 'string') {
                    itemToStore = { ...item, guid: item.guid }; // Use existing 'guid' and spread other properties
                } else {
                    console.error(`[DB] Item for "${key}" is an object but has NO valid 'guid' property. Will skip this item. Original item:`, item);
                    skipItem = true;
                }
            } else {
                console.error(`[DB] Unexpected item type for "${key}". Expected string or object with 'guid', got "${typeof item}". Will skip this item. Original item:`, item);
                skipItem = true;
            }

            if (!skipItem) {
                // `put` is used as it will add or update based on the 'guid' key.
                await arrayObjectStore.put(itemToStore);
            } else {
                console.warn(`[DB] Skipping put operation for problematic item in "${key}" store (Store: ${arrayStoreName}).`);
            }
        }

        // Save metadata like lastModified for the array itself in userSettings.
        // Pass the current transaction to `saveSimpleState` so it's part of the same transaction.
        await saveSimpleState(key, null, serverTimestamp, transaction); // The 'value' for array states in userSettings is typically null or a marker.

        const savedItemCount = clonableArr.filter(item => {
            if (typeof item === 'string') return item.trim() !== '';
            if (typeof item === 'object' && item !== null && typeof item.guid === 'string') return item.guid.trim() !== '';
            return false;
        }).length;
        console.log(`[DB] Saved ${savedItemCount} items for "${key}" to store "${arrayStoreName}".`);

    } catch (e) {
        console.error(`[DB] Error saving array state "${key}" to store "${arrayStoreName}":`, e);
        throw e;
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
                // Important: queueAndAttemptSyncOperation is called *after* transaction.done
                // if it's not part of the same explicit transaction (which it isn't here).
                // This is crucial for maintaining data consistency.
                if (['starred', 'hidden', 'currentDeckGuids', 'shuffledOutGuids'].includes(key)) {
                    // For array types that represent server-synced collections, we need to
                    // send the *entire* current state to the server, not just deltas from here.
                    // The server then reconciles.
                    // If your server supports delta updates for these, you'd send deltas here.
                    // Otherwise, send the full array state as a 'simpleUpdate' type operation.
                    await queueAndAttemptSyncOperation({
                        type: 'simpleUpdate', // Generic update for the full array
                        key: key, // e.g., 'starred', 'hidden'
                        value: arr.map(item => typeof item === 'string' ? item : item.guid).filter(Boolean) // Send array of GUIDs to server
                    });
                }
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(`[DB] Transaction completion or sync queuing error for array state "${key}":`, e);
                }
            }
        }
    }
}

// --- Helper functions for specific array types ---

export async function getStarredItems() {
    const { value } = await loadArrayState('starred');
    // Ensure starred items are objects with 'guid' and 'starredAt' as expected from store
    return value.filter(item => item && typeof item.guid === 'string' && typeof item.starredAt === 'string');
}

export async function getHiddenItems() {
    const { value } = await loadArrayState('hidden');
    // Ensure hidden items are objects with 'guid' and 'hiddenAt' as expected from store
    return value.filter(item => item && typeof item.guid === 'string' && typeof item.hiddenAt === 'string');
}

export async function getCurrentDeckGuids() {
    const { value } = await loadArrayState('currentDeckGuids');
    // Map objects { guid: '...' } back to plain GUID strings
    return value.map(item => item.guid).filter(guid => typeof guid === 'string');
}

export async function getShuffledOutGuids() {
    const { value } = await loadArrayState('shuffledOutGuids');
    // Map objects { guid: '...' } back to plain GUID strings
    return value.map(item => item.guid).filter(guid => typeof guid === 'string');
}

// --- Helper functions for specific simple types (no changes needed for ID logic) ---

export async function getFilterMode() {
    const { value } = await loadSimpleState('filterMode');
    return value;
}

export async function getSyncEnabled() {
    const { value } = await loadSimpleState('syncEnabled');
    return value;
}

export async function getImagesEnabled() {
    const { value } = await loadSimpleState('imagesEnabled');
    return value;
}

export async function getRssFeeds() {
    const { value } = await loadSimpleState('rssFeeds');
    return value;
}

export async function getKeywordBlacklist() {
    const { value } = await loadSimpleState('keywordBlacklist');
    return value;
}

export async function getShuffleCount() {
    const { value } = await loadSimpleState('shuffleCount');
    return value;
}

export async function getLastShuffleResetDate() {
    const { value } = await loadSimpleState('lastShuffleResetDate');
    return value;
}

export async function getOpenUrlsInNewTabEnabled() {
    const { value } = await loadSimpleState('openUrlsInNewTabEnabled');
    return value;
}

export async function getLastViewedItemId() {
    const { value } = await loadSimpleState('lastViewedItemId');
    return value;
}

export async function getLastViewedItemOffset() {
    const { value } = await loadSimpleState('lastViewedItemOffset');
    return value;
}

// --- Feed Item specific functions (already good, use GUID) ---

export async function getAllFeedItems() {
    const db = await getDb();
    const tx = db.transaction('feedItems', 'readonly');
    const store = tx.objectStore('feedItems');
    const items = await store.getAll();
    await tx.done;
    return items;
}

export async function getFeedItem(guid) {
    const db = await getDb();
    const tx = db.transaction('feedItems', 'readonly');
    const store = tx.objectStore('feedItems');
    const item = await store.get(guid); // get by guid
    await tx.done;
    return item;
}

// --- Specific add/remove functions for starred/hidden/deck items ---
// These are essentially wrappers around `toggleStar`/`toggleHidden` if they queue.
// They also need to be careful about *what* they queue for sync.

export async function addStarredItem(itemGuid) {
    const db = await getDb();
    try {
        // Store objects with 'guid' as key (as per starredItems store keyPath)
        const itemToStar = { guid: itemGuid, starredAt: new Date().toISOString() };
        const tx = db.transaction('starredItems', 'readwrite');
        await tx.objectStore('starredItems').put(itemToStar); // Use put to add or update
        await tx.done;
        console.log(`[DB] Starred ${itemGuid} locally.`);

        // Queue and attempt immediate sync. The `data` sent to the server needs the item's GUID.
        // The server expects `id` for the item's unique identifier within the `starDelta` type.
        // So, we map `itemGuid` to `id` for the server payload.
        const op = { type: 'starDelta', data: { id: itemGuid, action: 'add', starredAt: itemToStar.starredAt } };
        await queueAndAttemptSyncOperation(op);

    } catch (e) {
        console.error(`[DB] Error starring ${itemGuid}:`, e);
        throw e;
    }
}

export async function removeStarredItem(itemGuid) {
    const db = await getDb();
    try {
        const tx = db.transaction('starredItems', 'readwrite');
        await tx.objectStore('starredItems').delete(itemGuid); // Delete by guid directly
        await tx.done;
        console.log(`[DB] Unstarred ${itemGuid} locally.`);

        // Queue and attempt immediate sync.
        // Server expects `id` for the item's unique identifier within the `starDelta` type.
        const op = { type: 'starDelta', data: { id: itemGuid, action: 'remove' } };
        await queueAndAttemptSyncOperation(op);

    } catch (e) {
        console.error(`[DB] Error unstarring ${itemGuid}:`, e);
        throw e;
    }
}

export async function addHiddenItem(itemGuid) {
    const db = await getDb();
    try {
        // Store objects with 'guid' as key (as per hiddenItems store keyPath)
        const itemToHide = { guid: itemGuid, hiddenAt: new Date().toISOString() };
        const tx = db.transaction('hiddenItems', 'readwrite');
        await tx.objectStore('hiddenItems').put(itemToHide); // Use put to add or update
        await tx.done;
        console.log(`[DB] Hidden ${itemGuid} locally.`);

        // Queue and attempt immediate sync.
        // Server expects `id` for the item's unique identifier within the `hiddenDelta` type.
        const op = { type: 'hiddenDelta', data: { id: itemGuid, action: 'add', timestamp: itemToHide.hiddenAt } };
        await queueAndAttemptSyncOperation(op);

    } catch (e) {
        console.error(`[DB] Error hiding ${itemGuid}:`, e);
        throw e;
    }
}

export async function removeHiddenItem(itemGuid) {
    const db = await getDb();
    try {
        const tx = db.transaction('hiddenItems', 'readwrite');
        await tx.objectStore('hiddenItems').delete(itemGuid); // Delete by guid directly
        await tx.done;
        console.log(`[DB] Unhidden ${itemGuid} locally.`);

        // Queue and attempt immediate sync.
        // Server expects `id` for the item's unique identifier within the `hiddenDelta` type.
        const op = { type: 'hiddenDelta', data: { id: itemGuid, action: 'remove' } };
        await queueAndAttemptSyncOperation(op);

    } catch (e) {
        console.error(`[DB] Error unhiding ${itemGuid}:`, e);
        throw e;
    }
}