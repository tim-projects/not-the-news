// @filepath: src/js/data/dbUserState.js

import { withDb } from './dbCore.js';
import { queueAndAttemptSyncOperation } from './dbSyncOperations.js';

// --- User State Definitions ---
export const USER_STATE_DEFS = {
    starred: { store: 'starred', type: 'array', localOnly: false, default: [] },
    hidden: { store: 'hidden', type: 'array', localOnly: false, default: [] },
    lastStateSync: { store: 'userSettings', type: 'simple', localOnly: false, default: 0 },
    lastFeedSync: { store: 'userSettings', type: 'simple', localOnly: true, default: 0 },
    rssFeeds: { store: 'userSettings', type: 'simple', localOnly: true, default: '' },
    openUrlsInNewTabEnabled: { store: 'userSettings', type: 'simple', localOnly: true, default: true },
    imagesEnabled: { store: 'userSettings', type: 'simple', localOnly: true, default: true },
    syncEnabled: { store: 'userSettings', type: 'simple', localOnly: true, default: true },
    keywordBlacklist: { store: 'userSettings', type: 'simple', localOnly: true, default: [] },
    currentDeckGuids: { store: 'currentDeckGuids', type: 'array', localOnly: true, default: [] },
    shuffledOutGuids: { store: 'shuffledOutGuids', type: 'array', localOnly: true, default: [] },
    feedLastModified: { store: 'userSettings', type: 'simple', localOnly: true, default: 0 }
};

/**
 * Loads a simple key-value state from the specified store.
 * @param {string} key The key to look for in the store.
 * @param {string} storeName The object store to query (e.g., 'userSettings').
 * @returns {Promise<{value: any, lastModified: string | null}>} The value and last modified date.
 */
export async function loadSimpleState(key, storeName = 'userSettings') {
    return withDb(async (db) => {
        try {
            const record = await db.get(storeName, key);
            return {
                value: record ? record.value : USER_STATE_DEFS[key]?.default || null,
                lastModified: record?.lastModified || null // Return lastModified for sync
            };
        } catch (e) {
            console.error(`Failed to load simple state for key '${key}':`, e);
            return { value: USER_STATE_DEFS[key]?.default || null, lastModified: null };
        }
    });
}

/**
 * Saves a simple key-value state locally AND queues it for synchronization.
 * @param {string} key The key to save.
 * @param {any} value The value to save.
 * @param {string} storeName The object store to use (e.g., 'userSettings').
 * @returns {Promise<void>}
 */
export async function saveSimpleState(key, value, storeName = 'userSettings') {
    // First, save the state locally for immediate UI feedback.
    await withDb(async (db) => {
        try {
            await db.put(storeName, { key, value, lastModified: new Date().toISOString() });
        } catch (e) {
            console.error(`Failed to save simple state for key '${key}':`, e);
            throw e; // Re-throw to prevent queuing if local save fails.
        }
    });

    // Second, after local save, queue the operation for the server if it's not local-only.
    const def = USER_STATE_DEFS[key];
    if (def && !def.localOnly) {
        await queueAndAttemptSyncOperation({
            type: 'simpleUpdate',
            key: key,
            value: value,
            timestamp: new Date().toISOString()
        });
    }
}

// Helper to generate the correct timestamp key based on the store name / action.
const getTimestampKey = (storeName) => {
    switch (storeName) {
        case 'starred': return 'starredAt';
        case 'hidden': return 'hiddenAt';
        case 'currentDeckGuids': return 'addedAt';
        case 'shuffledOutGuids': return 'shuffledAt';
        default: return 'updatedAt'; // A sensible fallback
    }
};

/**
 * Loads all items from a store, returning full objects.
 * Includes logic to migrate legacy string-based data to the new object format.
 * @param {string} storeName The name of the object store.
 * @returns {Promise<{value: Array<object>}>} An object containing the array of full data objects.
 */
export async function loadArrayState(storeName) {
    return withDb(async (db) => {
        try {
            const allItems = await db.getAll(storeName);

            const needsMigration = allItems.length > 0 && (typeof allItems[0] === 'string' || allItems[0].id === undefined);

            if (needsMigration) {
                console.log(`[DB] Migration required for '${storeName}'. Converting string GUIDs to objects.`);
                const timestampKey = getTimestampKey(storeName);
                const now = new Date().toISOString();

                const migratedItems = allItems.map(item => {
                    const guid = typeof item === 'string' ? item : item.guid;
                    return { guid, [timestampKey]: now };
                });

                const tx = db.transaction(storeName, 'readwrite');
                await tx.store.clear();
                for (const item of migratedItems) {
                    await tx.store.put(item);
                }
                await tx.done;

                console.log(`[DB] Migration complete for '${storeName}'.`);
                const finalItems = await db.getAll(storeName);
                return { value: finalItems };
            }

            return { value: allItems || USER_STATE_DEFS[storeName]?.default || [] };
        } catch (e) {
            console.error(`Failed to load array state from store '${storeName}':`, e);
            return { value: USER_STATE_DEFS[storeName]?.default || [] };
        }
    });
}

/**
 * Finds a single object in a store by its GUID.
 * @param {string} storeName The name of the object store.
 * @param {string} guid The GUID to find.
 * @returns {Promise<object|undefined>} The found object or undefined.
 */
export async function findByGuid(storeName, guid) {
    return withDb(async (db) => {
        try {
            return await db.getFromIndex(storeName, 'guid', guid);
        } catch (e) {
            console.error(`Error finding item by GUID '${guid}' in store '${storeName}':`, e);
            return undefined;
        }
    });
}

/**
 * Adds or removes a single object locally AND queues the change for synchronization.
 * @param {string} storeName The name of the object store.
 * @param {object} item The object to add or remove. Must contain a 'guid' property.
 * @param {boolean} add true to add, false to remove.
 * @returns {Promise<void>}
 */
export async function updateArrayState(storeName, item, add) {
    // First, perform the local database operation.
    await withDb(async (db) => {
        const tx = db.transaction(storeName, 'readwrite');
        try {
            if (!item || !item.guid) {
                console.error("[DB] FATAL: updateArrayState requires an item with a guid property.", item);
                return;
            }
            const store = tx.objectStore(storeName);
            if (add) {
                await store.put(item);
            } else {
                const existingItem = await store.index('guid').get(item.guid);
                if (existingItem && typeof existingItem.id !== 'undefined') {
                    await store.delete(existingItem.id);
                } else {
                    console.warn(`[DB] WARN: Attempted to delete item with guid '${item.guid}' but it was not found in '${storeName}'.`);
                }
            }
            await tx.done;
        } catch (e) {
            console.error(`[DB] FATAL: Transaction FAILED in updateArrayState for store '${storeName}' (GUID: '${item.guid}'):`, e);
            if (tx && tx.abort) tx.abort();
            throw e;
        }
    });

    // Second, determine if this store needs to be synced and queue the operation.
    const defEntry = Object.entries(USER_STATE_DEFS).find(([, v]) => v.store === storeName);
    if (defEntry && !defEntry[1].localOnly) {
        let opType = '';
        if (storeName === 'starred') opType = 'starDelta';
        if (storeName === 'hidden') opType = 'hiddenDelta';
        
        if (opType) {
            await queueAndAttemptSyncOperation({
                type: opType,
                guid: item.guid,
                action: add ? 'add' : 'remove',
                timestamp: item[getTimestampKey(storeName)] || new Date().toISOString()
            });
        }
    }
}

/**
 * --- NEW: Re-implements the 30-day grace period pruning for hidden items. ---
 * It removes hidden items that are no longer in the main feed, but only after they
 * have been missing for 30 days.
 * @param {Array<object>} hiddenItems The current array of hidden item objects.
 * @param {Array<object>} feedItems The current array of all valid feed item objects.
 * @returns {Promise<void>} A promise that resolves when the pruning and sync queuing is complete.
 */
export async function pruneStaleHiddenItems(hiddenItems, feedItems) {
    if (!Array.isArray(hiddenItems) || !Array.isArray(feedItems)) {
        console.warn('[DB] pruneStaleHiddenItems skipped due to invalid input.');
        return;
    }

    const validFeedGuids = new Set(feedItems.map(item => item.guid));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const prunedHiddenItems = hiddenItems.filter(item => {
        if (validFeedGuids.has(item.guid)) {
            return true;
        }
        const hiddenAtTimestamp = new Date(item.hiddenAt).getTime();
        return (now - hiddenAtTimestamp) < THIRTY_DAYS_MS;
    });

    if (prunedHiddenItems.length < hiddenItems.length) {
        const itemsRemoved = hiddenItems.length - prunedHiddenItems.length;
        console.log(`[DB] Pruning ${itemsRemoved} stale hidden items (older than 30 days and no longer in feed).`);
        await overwriteArrayAndSyncChanges('hidden', prunedHiddenItems);
    } else {
        console.log('[DB] No stale hidden items to prune.');
    }
}

/**
 * --- NEW: Overwrites an array locally, calculates the changes, and queues them for sync. ---
 * This is the correct function to use for data migration or sanitization tasks.
 * @param {string} storeName The name of the object store (e.g., 'hidden').
 * @param {Array<object>} newObjects The new, complete array of objects for the store.
 * @returns {Promise<void>}
 */
export async function overwriteArrayAndSyncChanges(storeName, newObjects) {
    const { value: oldObjects } = await loadArrayState(storeName);
    const oldGuids = new Set(oldObjects.map(item => item.guid));
    await saveArrayState(storeName, newObjects);
    const newGuids = new Set(newObjects.map(item => item.guid));

    const defEntry = Object.entries(USER_STATE_DEFS).find(([, v]) => v.store === storeName);
    if (!defEntry || defEntry[1].localOnly) {
        console.log(`[DB] '${storeName}' is local-only. No sync operations will be queued.`);
        return;
    }

    const guidsToRemove = [...oldGuids].filter(guid => !newGuids.has(guid));
    if (guidsToRemove.length > 0) {
        console.log(`[DB] Queuing ${guidsToRemove.length} 'remove' operations for '${storeName}'.`);
        for (const guid of guidsToRemove) {
            // Re-use updateArrayState's sync logic to queue a valid 'delta' operation.
            // We pass a minimal object because only the guid is needed for the sync op.
            // The local DB operation was already handled by saveArrayState.
            await updateArrayState(storeName, { guid }, false);
        }
    }

    const guidsToAdd = [...newGuids].filter(guid => !oldGuids.has(guid));
    if (guidsToAdd.length > 0) {
        console.log(`[DB] Queuing ${guidsToAdd.length} 'add' operations for '${storeName}'.`);
        const timestampKey = getTimestampKey(storeName);
        const now = new Date().toISOString();
        for (const guid of guidsToAdd) {
            await updateArrayState(storeName, { guid, [timestampKey]: now }, true);
        }
    }
}

/**
 * --- MODIFIED: Overwrites a store LOCALLY ONLY. ---
 * This is now a simple utility function. For syncing, use `overwriteArrayAndSyncChanges`.
 * @param {string} storeName The name of the object store.
 * @param {Array<object>} objects The array of objects to save into the store.
 * @returns {Promise<void>}
 */
export async function saveArrayState(storeName, objects) {
    return withDb(async (db) => {
        try {
            if (!Array.isArray(objects)) {
                console.error(`saveArrayState expects an array, but received:`, objects);
                return;
            }
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            await store.clear();
            for (const item of objects) {
                const sanitizedItem = JSON.parse(JSON.stringify(item));
                delete sanitizedItem.id;
                await store.put(sanitizedItem);
            }
            await tx.done;
        } catch (e) {
            console.error(`Failed to save array state to store '${storeName}':`, e);
            throw e;
        }
    });
}