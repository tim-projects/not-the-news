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
 */
export async function loadSimpleState(key, storeName = 'userSettings') {
    return withDb(async (db) => {
        try {
            const record = await db.get(storeName, key);
            return {
                value: record ? record.value : USER_STATE_DEFS[key]?.default || null,
                lastModified: record?.lastModified || null
            };
        } catch (e) {
            console.error(`Failed to load simple state for key '${key}':`, e);
            return { value: USER_STATE_DEFS[key]?.default || null, lastModified: null };
        }
    });
}

/**
 * Saves a simple key-value state locally AND queues it for synchronization.
 */
export async function saveSimpleState(key, value, storeName = 'userSettings') {
    await withDb(db => db.put(storeName, { key, value, lastModified: new Date().toISOString() }));

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

const getTimestampKey = (storeName) => {
    switch (storeName) {
        case 'starred': return 'starredAt';
        case 'hidden': return 'hiddenAt';
        case 'currentDeckGuids': return 'addedAt';
        case 'shuffledOutGuids': return 'shuffledAt';
        default: return 'updatedAt';
    }
};

/**
 * Loads all items from a store, performing data migration if necessary.
 */
export async function loadArrayState(storeName) {
    return withDb(async (db) => {
        try {
            const allItems = await db.getAll(storeName);
            const needsMigration = allItems.length > 0 && (typeof allItems[0] === 'string' || allItems[0].id === undefined);

            if (needsMigration) {
                console.log(`[DB] Migration required for '${storeName}'.`);
                const timestampKey = getTimestampKey(storeName);
                const now = new Date().toISOString();
                // Deduplicate the array before migration to prevent unique constraint errors.
                const uniqueItems = new Map();
                allItems.forEach(item => {
                    const guid = typeof item === 'string' ? item : item.guid;
                    if (guid && !uniqueItems.has(guid)) {
                        uniqueItems.set(guid, item);
                    }
                });

                const deduplicatedItems = Array.from(uniqueItems.values());

                const migratedItems = deduplicatedItems.map(item => ({
                    guid: typeof item === 'string' ? item : item.guid,
                    [timestampKey]: now
                }));

                const tx = db.transaction(storeName, 'readwrite');
                await tx.store.clear();
                for (const item of migratedItems) await tx.store.put(item);
                await tx.done;

                console.log(`[DB] Migration complete for '${storeName}'.`);
                return { value: await db.getAll(storeName) };
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
 */
export async function findByGuid(storeName, guid) {
    return withDb(db => db.getFromIndex(storeName, 'guid', guid)).catch(e => {
        console.error(`Error finding item by GUID '${guid}' in store '${storeName}':`, e);
        return undefined;
    });
}

/**
 * Adds or removes a single object locally AND queues the change for synchronization.
 */
export async function updateArrayState(storeName, item, add) {
    // Step 1: Perform the local database operation.
    await withDb(async (db) => {
        const tx = db.transaction(storeName, 'readwrite');
        if (!item || !item.guid) {
            console.error("[DB] updateArrayState requires an item with a guid property.", item);
            return;
        }
        const store = tx.objectStore(storeName);
        if (add) {
            await store.put(item);
        } else {
            const existingItem = await store.index('guid').get(item.guid);
            if (existingItem?.id !== undefined) {
                await store.delete(existingItem.id);
            }
        }
        await tx.done;
    });

    // Step 2: If the store is syncable, construct and queue the operation.
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
 * Overwrites an array locally, calculates the changes, and queues them for sync.
 */
export async function overwriteArrayAndSyncChanges(storeName, newObjects) {
    const { value: oldObjects } = await loadArrayState(storeName);
    const oldGuids = new Set(oldObjects.map(item => item.guid));
    
    // Step 1: Overwrite the local database. This is the source of truth for the UI.
    await saveArrayState(storeName, newObjects);
    const newGuids = new Set(newObjects.map(item => item.guid));

    // Step 2: Calculate the differences.
    const guidsToRemove = [...oldGuids].filter(guid => !newGuids.has(guid));
    const guidsToAdd = [...newGuids].filter(guid => !newGuids.has(guid));
    
    // Step 3: Check if the store is syncable.
    const defEntry = Object.entries(USER_STATE_DEFS).find(([, v]) => v.store === storeName);
    if (!defEntry || defEntry[1].localOnly) return;
    
    let opType = '';
    if (storeName === 'starred') opType = 'starDelta';
    if (storeName === 'hidden') opType = 'hiddenDelta';

    if (!opType) return; // Nothing to do if we can't determine the operation type

    // ✅ FIX: Loop through the differences and queue operations directly using the public function.
    if (guidsToRemove.length > 0) {
        console.log(`[DB] Queuing ${guidsToRemove.length} 'remove' operations for '${storeName}'.`);
        for (const guid of guidsToRemove) {
            await queueAndAttemptSyncOperation({ type: opType, guid: guid, action: 'remove', timestamp: new Date().toISOString() });
        }
    }
    if (guidsToAdd.length > 0) {
        console.log(`[DB] Queuing ${guidsToAdd.length} 'add' operations for '${storeName}'.`);
        for (const guid of guidsToAdd) {
            await queueAndAttemptSyncOperation({ type: opType, guid: guid, action: 'add', timestamp: new Date().toISOString() });
        }
    }
}

/**
 * Re-implements the 30-day grace period pruning for hidden items.
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
        if (validFeedGuids.has(item.guid)) return true;
        const hiddenAtTimestamp = new Date(item.hiddenAt).getTime();
        return (now - hiddenAtTimestamp) < THIRTY_DAYS_MS;
    });

    if (prunedHiddenItems.length < hiddenItems.length) {
        const itemsRemoved = hiddenItems.length - prunedHiddenItems.length;
        console.log(`[DB] Pruning ${itemsRemoved} stale hidden items.`);
        await overwriteArrayAndSyncChanges('hidden', prunedHiddenItems);
    } else {
        console.log('[DB] No stale hidden items to prune.');
    }
}

/**
 * Overwrites a store LOCALLY ONLY.
 */
export async function saveArrayState(storeName, objects) {
    return withDb(async (db) => {
        const tx = db.transaction(storeName, 'readwrite');
        await tx.store.clear();
        for (const item of objects) {
            const sanitizedItem = JSON.parse(JSON.stringify(item));
            delete sanitizedItem.id;
            await tx.store.put(sanitizedItem);
        }
        await tx.done;
    });
}

export { queueAndAttemptSyncOperation };