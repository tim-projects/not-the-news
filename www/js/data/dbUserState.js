// www/js/data/dbUserState.js

import { getDb } from './dbCore.js';
import { queueAndAttemptSyncOperation } from './dbSyncOperations.js'; // This import is necessary due to original functionality

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
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
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
        if (['filterMode', 'syncEnabled', 'imagesEnabled', 'shuffleCount', 'lastShuffleResetDate', 'openUrlsInNewTabEnabled', 'lastViewedItemId', 'lastViewedItemOffset', 'theme'].includes(key)) {
            const op = { type: 'simpleUpdate', key: key, value: value };
            await queueAndAttemptSyncOperation(op);
        }
    } catch (e) {
        throw e;
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
                }
            }
        }
    }
}

export async function loadArrayState(key, tx = null) {
    const db = await getDb();
    const def = USER_STATE_DEFS[key];
    if (!def || def.type !== 'array') {
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
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
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
        await arrayObjectStore.clear();
        const clonableArr = JSON.parse(JSON.stringify(arr));
        for (const item of clonableArr) {
            const itemToStore = (key === 'currentDeckGuids' || key === 'shuffledOutGuids') && typeof item === 'string'
                ? { id: item }
                : item;
            await arrayObjectStore.put(itemToStore);
        }
        await saveSimpleState(key, null, serverTimestamp, transaction);
        if (['shuffledOutGuids', 'currentDeckGuids', 'rssFeeds', 'keywordBlacklist'].includes(key)) {
            const op = { type: 'simpleUpdate', key: key, value: Array.from(arr) };
            await queueAndAttemptSyncOperation(op);
        }
    } catch (e) {
        throw e;
    } finally {
        if (!tx && transaction) {
            try {
                await transaction.done;
            } catch (e) {
                if (e.name !== 'AbortError') {
                }
            }
        }
    }
}

export async function getStarredItems() {
    const { value } = await loadArrayState('starred');
    return value;
}

export async function getHiddenItems() {
    const { value } = await loadArrayState('hidden');
    return value;
}

export async function getCurrentDeckGuids() {
    const { value } = await loadArrayState('currentDeckGuids');
    return value.map(item => item.id);
}

export async function getShuffledOutGuids() {
    const { value } = await loadArrayState('shuffledOutGuids');
    return value.map(item => item.id);
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
    const item = await store.get(guid);
    await tx.done;
    return item;
}

export async function addStarredItem(itemGuid) {
    const db = await getDb();
    try {
        const itemToStar = { id: itemGuid, starredAt: new Date().toISOString() };
        const tx = db.transaction('starredItems', 'readwrite');
        await tx.objectStore('starredItems').put(itemToStar);
        await tx.done;
        const op = { type: 'starDelta', data: { id: itemGuid, action: 'add', starredAt: itemToStar.starredAt } };
        await queueAndAttemptSyncOperation(op);
    } catch (e) {
        throw e;
    }
}

export async function removeStarredItem(itemGuid) {
    const db = await getDb();
    try {
        const tx = db.transaction('starredItems', 'readwrite');
        await tx.objectStore('starredItems').delete(itemGuid);
        await tx.done;
        const op = { type: 'starDelta', data: { id: itemGuid, action: 'remove' } };
        await queueAndAttemptSyncOperation(op);
    } catch (e) {
        throw e;
    }
}
export async function addHiddenItem(itemGuid) {
    const db = await getDb();
    try {
        const itemToHide = { id: itemGuid, hiddenAt: new Date().toISOString() };
        const tx = db.transaction('hiddenItems', 'readwrite');
        await tx.objectStore('hiddenItems').put(itemToHide);
        await tx.done;
        const op = { type: 'hiddenDelta', data: { id: itemGuid, action: 'add', timestamp: itemToHide.hiddenAt } };
        await queueAndAttemptSyncOperation(op);
    } catch (e) {
        throw e;
    }
}

export async function removeHiddenItem(itemGuid) {
    const db = await getDb();
    try {
        const tx = db.transaction('hiddenItems', 'readwrite');
        await tx.objectStore('hiddenItems').delete(itemGuid);
        await tx.done;
        const op = { type: 'hiddenDelta', data: { id: itemGuid, action: 'remove' } };
        await queueAndAttemptSyncOperation(op);
    } catch (e) {
        throw e;
    }
}