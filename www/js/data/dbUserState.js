// www/js/data/dbUserState.js

import { getDb } from './dbCore.js';
import { queueAndAttemptSyncOperation } from './dbSyncOperations.js'; // This import is necessary due to original functionality

// USER_STATE_DEFS no longer directly specifies keyPath,
// it just defines the store name. keyPath is defined in OBJECT_STORES_SCHEMA in dbCore.js
export const USER_STATE_DEFS = {
    starred: { store: 'starredItems', type: 'array', default: [] },
    hidden: { store: 'hiddenItems', type: 'array', default: [] },
    currentDeckGuids: { store: 'currentDeckGuids', type: 'array', default: [] },
    shuffledOutGuids: { store: 'shuffledOutGuids', type: 'array', default: [] },
    filterMode: { store: 'userSettings', type: 'simple', default: 'all' },
    syncEnabled: { store: 'userSettings', type: 'simple', default: true },
    imagesEnabled: { store: 'userSettings', type: 'simple', default: true },
    rssFeeds: { store: 'userSettings', type: 'simple', default: [] },
    keywordBlacklist: { store: 'userSettings', type: 'simple', default: [] },
    shuffleCount: { store: 'userSettings', type: 'simple', default: 2 },
    lastShuffleResetDate: { store: 'userSettings', type: 'simple', default: null },
    openUrlsInNewTabEnabled: { store: 'userSettings', type: 'simple', default: true },
    lastViewedItemId: { store: 'userSettings', type: 'simple', default: null },
    lastStateSync: { store: 'userSettings', type: 'simple', default: null },
    theme: { store: 'userSettings', type: 'simple', default: 'light' },
    lastFeedSync: { store: 'userSettings', type: 'simple', default: null },
};

export async function loadSimpleState(key, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def) {
        console.error(`[DB] Invalid key: ${key}.`);
        return { value: null, lastModified: null };
    }
    const storeName = 'userSettings';
    let transaction;
    try {
        transaction = tx || db.transaction(storeName, 'readonly');
        const data = await transaction.objectStore(storeName).get(key);
        if (data && data.hasOwnProperty('value')) {
            return { value: data.value, lastModified: data.lastModified || null };
        }
    } catch (e) {
        console.error(`[DB] Error loading ${key}:`, e);
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(`[DB] Transaction error for ${key}:`, e);
                }
            }
        }
    }
    return { value: def.default, lastModified: null };
}

export async function saveSimpleState(key, value, serverTimestamp = null, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def) {
        console.error(`[DB] Invalid key: ${key}.`);
        throw new Error(`Invalid or undefined state key: ${key}`);
    }
    const storeName = 'userSettings';
    let transaction;
    try {
        transaction = tx || db.transaction(storeName, 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        const objToSave = { key: key, value: value };
        if (serverTimestamp) {
            objToSave.lastModified = serverTimestamp;
        } else {
            objToSave.lastModified = new Date().toISOString();
        }
        await objectStore.put(objToSave);
        console.log(`[DB] Saved "${key}".`);

        // These keys are managed as simple updates on the server
        if (['filterMode', 'syncEnabled', 'imagesEnabled', 'shuffleCount', 'lastShuffleResetDate', 'openUrlsInNewTabEnabled', 'lastViewedItemId', 'lastViewedItemOffset', 'theme', 'rssFeeds', 'keywordBlacklist'].includes(key)) {
            const op = { type: 'simpleUpdate', key: key, value: value };
            await queueAndAttemptSyncOperation(op);
        }

    } catch (e) {
        console.error(`[DB] Error saving "${key}":`, e);
        throw e;
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(`[DB] Transaction error for ${key}:`, e);
                }
            }
        }
    }
}

export async function loadArrayState(key, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'array') {
        console.error(`[DB] Invalid array key: ${key}`);
        return { value: def ? def.default : [], lastModified: null };
    }
    const arrayStoreName = def.store;
    let transaction;
    try {
        transaction = tx || db.transaction([arrayStoreName, 'userSettings'], 'readonly');
        const arrayStore = transaction.objectStore(arrayStoreName);
        const allItems = await arrayStore.getAll();
        const { lastModified: arrayTimestamp } = await loadSimpleState(key, transaction);
        return { value: allItems, lastModified: arrayTimestamp };
    } catch (e) {
        console.error(`[DB] Error loading ${key}:`, e);
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(`[DB] Transaction error for ${key}:`, e);
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
    const arrayStoreName = def.store;
    let transaction;
    try {
        transaction = tx || db.transaction([arrayStoreName, 'userSettings', 'pendingOperations'], 'readwrite');
        const arrayObjectStore = transaction.objectStore(arrayStoreName);
        await arrayObjectStore.clear(); // Clear existing data

        const clonableArr = JSON.parse(JSON.stringify(arr)); // Deep clone to avoid mutation issues

        for (const item of clonableArr) {
            let itemToStore;
            let skipItem = false; // Flag to indicate if we should skip this item

            // All array stores for user data (starred, hidden, currentDeckGuids, shuffledOutGuids)
            // are now assumed to have 'guid' as keyPath.
            // So, ensure the item has a 'guid' property.
            if (typeof item === 'string') {
                itemToStore = { guid: item }; // Wrap plain GUID string into an object with 'guid'
            } else if (typeof item === 'object' && item !== null) {
                if (item.guid) {
                    itemToStore = { ...item, guid: item.guid }; // Use existing 'guid' and spread other properties
                } else { // No 'guid' property found (removed 'id' fallback)
                    console.error(`[DB] Item for "${key}" is an object but has NO 'guid' property. Will skip this item. Original item:`, item);
                    skipItem = true;
                }
            } else {
                console.error(`[DB] Unexpected item type for "${key}". Expected string or object, got "${typeof item}". Will skip this item. Original item:`, item);
                skipItem = true;
            }

            // Final validation: ensure 'guid' property is valid
            if (!skipItem && (!itemToStore || !itemToStore.guid || typeof itemToStore.guid !== 'string' || itemToStore.guid.trim() === '')) {
                console.error(`[DB] Constructed itemToStore for "${key}" has an invalid 'guid' property. Will skip this item. itemToStore:`, itemToStore, "Original item:", item);
                skipItem = true;
            }

            if (!skipItem) {
                //console.log(`[DB] Saving item to store "${arrayStoreName}". itemToStore:`, itemToStore);
                await arrayObjectStore.put(itemToStore);
            } else {
                console.warn(`[DB] Skipping put operation for problematic item in "${key}" store (Store: ${arrayStoreName}).`);
            }
        }

        // Save metadata like lastModified for the array itself in userSettings
        await saveSimpleState(key, null, serverTimestamp, transaction); // Pass transaction to ensure it's part of this batch

        // Refined count of saved items (excludes skipped items)
        const savedItemCount = clonableArr.filter(item => {
            if (typeof item === 'string') return item.trim() !== '';
            if (typeof item === 'object' && item !== null && typeof item.guid === 'string') return item.guid.trim() !== '';
            return false;
        }).length;
        console.log(`[DB] Saved ${savedItemCount} items for "${key}".`);

        if (!tx) {
            await transaction.done;
            console.log(`[DB] Transaction for "${key}" completed.`);
        }
    } catch (e) {
        console.error(`[DB] Error saving "${key}" to store "${arrayStoreName}":`, e);
        throw e;
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(`[DB] Transaction error for ${key}:`, e);
                }
            }
        }
    }
}

export async function getStarredItems() {
    const { value } = await loadArrayState('starred');
    // Ensure starred items are objects with 'guid' and 'starredAt'
    return value.filter(item => item && typeof item.guid === 'string' && typeof item.starredAt === 'string');
}

export async function getHiddenItems() {
    const { value } = await loadArrayState('hidden');
    // Ensure hidden items are objects with 'guid' and 'hiddenAt'
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

export async function addStarredItem(itemGuid) {
    const db = await getDb();
    try {
        // Store objects with 'guid' as key, not 'id'
        const itemToStar = { guid: itemGuid, starredAt: new Date().toISOString() };
        const tx = db.transaction('starredItems', 'readwrite');
        await tx.objectStore('starredItems').put(itemToStar);
        await tx.done;
        console.log(`[DB] Starred ${itemGuid} locally.`);

        // Queue and attempt immediate sync
        // Server expects 'id', so transform if necessary before sending to server
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

        // Queue and attempt immediate sync
        // Server expects 'id', so transform if necessary before sending to server
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
        // Store objects with 'guid' as key, not 'id'
        const itemToHide = { guid: itemGuid, hiddenAt: new Date().toISOString() };
        const tx = db.transaction('hiddenItems', 'readwrite');
        await tx.objectStore('hiddenItems').put(itemToHide);
        await tx.done;
        console.log(`[DB] Hidden ${itemGuid} locally.`);

        // Queue and attempt immediate sync
        // Server expects 'id', so transform if necessary before sending to server
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

        // Queue and attempt immediate sync
        // Server expects 'id', so transform if necessary before sending to server
        const op = { type: 'hiddenDelta', data: { id: itemGuid, action: 'remove' } };
        await queueAndAttemptSyncOperation(op);

    } catch (e) {
        console.error(`[DB] Error unhiding ${itemGuid}:`, e);
        throw e;
    }
}