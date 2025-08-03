// @filepath: src/js/data/dbUserState.js

// This module provides a simple API for saving and loading user-specific
// state and settings from IndexedDB. It also integrates with the
// synchronization logic.

import { getDb } from './dbCore.js';
import { queueAndAttemptSyncOperation } from './dbSyncOperations.js';

// USER_STATE_DEFS provides a single source of truth for all user state variables.
// The `store` and `type` properties are used by the helper functions to correctly access the data.
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
    lastViewedItemId: { store: 'userSettings', type: 'simple', default: null, localOnly: true },
    lastViewedItemOffset: { store: 'userSettings', type: 'simple', default: 0, localOnly: true },
    lastStateSync: { store: 'userSettings', type: 'simple', default: null },
    theme: { store: 'userSettings', type: 'simple', default: 'light' },
    lastFeedSync: { store: 'userSettings', type: 'simple', default: null },
};

/**
 * Loads a single simple state key-value pair.
 * @param {string} key The key of the setting to load.
 * @param {IDBTransaction} [tx=null] Optional transaction to use.
 * @returns {Promise<{value: any, lastModified: string|null}>}
 */
export async function loadSimpleState(key, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'simple') {
        console.warn(`[DB] Invalid key '${key}' for loadSimpleState. Returning default.`);
        return { value: def?.default, lastModified: null };
    }

    const store = tx ? tx.objectStore(def.store) : db.transaction(def.store, 'readonly').objectStore(def.store);

    try {
        const data = await store.get(key);
        return { value: data?.value ?? def.default, lastModified: data?.lastModified ?? null };
    } catch (e) {
        console.error(`[DB] Error loading simple state "${key}":`, e);
        return { value: def.default, lastModified: null };
    }
}

/**
 * Saves a single simple state key-value pair and queues a sync operation.
 * @param {string} key The key of the setting to save.
 * @param {any} value The value to save.
 * @param {string} [serverTimestamp=null] An optional timestamp from the server.
 * @param {IDBTransaction} [tx=null] Optional transaction to use.
 */
export async function saveSimpleState(key, value, serverTimestamp = null, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'simple') {
        throw new Error(`Invalid or undefined simple state key: ${key}`);
    }

    const transaction = tx ?? db.transaction(def.store, 'readwrite');
    const store = transaction.objectStore(def.store);

    const objToSave = {
        key,
        value,
        lastModified: serverTimestamp || new Date().toISOString()
    };

    try {
        await store.put(objToSave);
        console.log(`[DB] Saved "${key}" to userSettings.`);
        
        // If this function created the transaction, wait for it to finish and then queue the sync.
        if (!tx) {
            await transaction.done;
            if (!def.localOnly) {
                await queueAndAttemptSyncOperation({ type: 'simpleUpdate', key, value });
            }
        }
    } catch (e) {
        console.error(`[DB] Error saving simple state "${key}":`, e);
        if (!tx) throw e;
    }
}

/**
 * Loads an entire array state from a dedicated store.
 * @param {string} key The key of the array state to load.
 * @param {IDBTransaction} [tx=null] Optional transaction to use.
 * @returns {Promise<{value: Array<any>, lastModified: string|null}>}
 */
export async function loadArrayState(key, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'array') {
        console.warn(`[DB] Invalid key '${key}' for loadArrayState. Returning default.`);
        return { value: def?.default, lastModified: null };
    }

    const stores = [def.store, 'userSettings'];
    const transaction = tx ?? db.transaction(stores, 'readonly');
    const arrayStore = transaction.objectStore(def.store);
    const userSettingsStore = transaction.objectStore('userSettings');

    try {
        const [allItems, metadata] = await Promise.all([
            arrayStore.getAll(),
            userSettingsStore.get(key)
        ]);
        return {
            value: allItems,
            lastModified: metadata?.lastModified ?? null
        };
    } catch (e) {
        console.error(`[DB] Error loading array state "${key}":`, e);
        return { value: def.default, lastModified: null };
    }
}

/**
 * Saves an entire array state to a dedicated store and queues a sync operation.
 * @param {string} key The key of the array state to save.
 * @param {Array<any>} arr The array to save.
 * @param {string} [serverTimestamp=null] An optional timestamp from the server.
 * @param {IDBTransaction} [tx=null] Optional transaction to use.
 */
export async function saveArrayState(key, arr, serverTimestamp = null, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'array') {
        throw new Error(`Invalid or undefined array state key: ${key}`);
    }

    const stores = [def.store, 'userSettings'];
    const transaction = tx ?? db.transaction(stores, 'readwrite');
    const arrayStore = transaction.objectStore(def.store);
    const userSettingsStore = transaction.objectStore('userSettings');

    // Filter and validate the array to avoid storing invalid items.
    const cleanedArr = (arr || []).filter(item => {
        if (typeof item === 'object' && item?.guid?.trim()) return true;
        console.warn(`[DB] Filtering out an invalid item for key "${key}":`, item);
        return false;
    });

    try {
        await arrayStore.clear();
        await Promise.all(cleanedArr.map(item => arrayStore.put(item)));
        
        await userSettingsStore.put({
            key,
            value: null, // We save null as a marker for array states
            lastModified: serverTimestamp || new Date().toISOString()
        });

        console.log(`[DB] Saved ${cleanedArr.length} items for "${key}".`);

        if (!tx) {
            await transaction.done;
            if (!def.localOnly) {
                await queueAndAttemptSyncOperation({
                    type: 'simpleUpdate',
                    key,
                    value: cleanedArr.map(item => item.guid)
                });
            }
        }
    } catch (e) {
        console.error(`[DB] Error saving array state "${key}":`, e);
        if (!tx) throw e;
    }
}

// --- Specific Getter Functions ---

export async function getStarredItems() {
    return (await loadArrayState('starred')).value;
}
export async function getHiddenItems() {
    return (await loadArrayState('hidden')).value;
}
export async function getCurrentDeckGuids() {
    return (await loadArrayState('currentDeckGuids')).value.map(item => item.guid);
}
export async function getShuffledOutGuids() {
    return (await loadArrayState('shuffledOutGuids')).value.map(item => item.guid);
}
export async function getFilterMode() {
    return (await loadSimpleState('filterMode')).value;
}
export async function getSyncEnabled() {
    return (await loadSimpleState('syncEnabled')).value;
}
export async function getImagesEnabled() {
    return (await loadSimpleState('imagesEnabled')).value;
}
export async function getRssFeeds() {
    return (await loadSimpleState('rssFeeds')).value;
}
export async function getKeywordBlacklist() {
    return (await loadSimpleState('keywordBlacklist')).value;
}
export async function getShuffleCount() {
    return (await loadSimpleState('shuffleCount')).value;
}
export async function getLastShuffleResetDate() {
    return (await loadSimpleState('lastShuffleResetDate')).value;
}
export async function getOpenUrlsInNewTabEnabled() {
    return (await loadSimpleState('openUrlsInNewTabEnabled')).value;
}
export async function getLastViewedItemId() {
    return (await loadSimpleState('lastViewedItemId')).value;
}
export async function getLastViewedItemOffset() {
    return (await loadSimpleState('lastViewedItemOffset')).value;
}
export async function getLastStateSync() {
    return (await loadSimpleState('lastStateSync')).value;
}
export async function getLastFeedSync() {
    return (await loadSimpleState('lastFeedSync')).value;
}

// --- Feed Item Specific Functions ---

export async function getAllFeedItems() {
    const db = await getDb();
    return await db.transaction('feedItems', 'readonly').objectStore('feedItems').getAll();
}

export async function getFeedItem(guid) {
    const db = await getDb();
    return await db.transaction('feedItems', 'readonly').objectStore('feedItems').get(guid);
}

// --- Specific add/remove functions for starred/hidden/deck items ---

export async function addStarredItem(itemGuid) {
    const db = await getDb();
    const itemToStar = { guid: itemGuid, starredAt: new Date().toISOString() };
    const tx = db.transaction('starredItems', 'readwrite');
    const store = tx.objectStore('starredItems');
    await store.put(itemToStar);
    await tx.done;
    console.log(`[DB] Starred ${itemGuid} locally.`);
    const op = { type: 'starDelta', data: { itemGuid, action: 'add', starredAt: itemToStar.starredAt } };
    await queueAndAttemptSyncOperation(op);
}

export async function removeStarredItem(itemGuid) {
    const db = await getDb();
    const tx = db.transaction('starredItems', 'readwrite');
    await tx.objectStore('starredItems').delete(itemGuid);
    await tx.done;
    console.log(`[DB] Unstarred ${itemGuid} locally.`);
    const op = { type: 'starDelta', data: { itemGuid, action: 'remove' } };
    await queueAndAttemptSyncOperation(op);
}

export async function addHiddenItem(itemGuid) {
    const db = await getDb();
    const itemToHide = { guid: itemGuid, hiddenAt: new Date().toISOString() };
    const tx = db.transaction('hiddenItems', 'readwrite');
    const store = tx.objectStore('hiddenItems');
    await store.put(itemToHide);
    await tx.done;
    console.log(`[DB] Hidden ${itemGuid} locally.`);
    const op = { type: 'hiddenDelta', data: { itemGuid, action: 'add', timestamp: itemToHide.hiddenAt } };
    await queueAndAttemptSyncOperation(op);
}

export async function removeHiddenItem(itemGuid) {
    const db = await getDb();
    const tx = db.transaction('hiddenItems', 'readwrite');
    await tx.objectStore('hiddenItems').delete(itemGuid);
    await tx.done;
    console.log(`[DB] Unhidden ${itemGuid} locally.`);
    const op = { type: 'hiddenDelta', data: { itemGuid, action: 'remove' } };
    await queueAndAttemptSyncOperation(op);
}
