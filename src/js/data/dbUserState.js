// @filepath: src/js/data/dbUserState.js

import { withDb } from './dbCore.js';
// NEW: Import the sync operation handler to create a uniform save/sync pipeline.
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
 * --- MODIFIED: Saves a simple key-value state locally AND queues it for synchronization. ---
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

            // Check if data migration is needed (i.e., data is old string format or objects without ids).
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
                    await tx.store.put(item); // New IDs will be auto-generated
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
 * @returns {Promise<object|undefined>} The found object (including its auto-incrementing id) or undefined.
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
 * --- MODIFIED: Adds or removes an object locally AND queues the change for synchronization. ---
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
            throw e; // Re-throw to prevent queuing if local save fails.
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
 * --- MODIFIED: Overwrites a store locally AND queues the change for synchronization. ---
 * @param {string} storeName The name of the object store.
 * @param {Array<object>} objects The array of objects to save into the store.
 * @returns {Promise<void>}
 */
export async function saveArrayState(storeName, objects) {
    // First, perform the local database operation.
    await withDb(async (db) => {
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
            throw e; // Re-throw to prevent queuing if local save fails.
        }
    });

    // Second, determine if this store needs to be synced and queue a 'replaceAll' operation.
    const defEntry = Object.entries(USER_STATE_DEFS).find(([, v]) => v.store === storeName);
    if (defEntry && !defEntry[1].localOnly) {
        await queueAndAttemptSyncOperation({
            type: 'arrayReplace',
            key: defEntry[0], // The key from USER_STATE_DEFS, e.g., 'starred'
            // The server payload can be simplified to just GUIDs for a full replace.
            value: objects.map(item => item.guid),
            timestamp: new Date().toISOString()
        });
    }
}