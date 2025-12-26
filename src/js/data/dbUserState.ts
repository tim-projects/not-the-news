//

import { withDb } from './dbCore.ts';

type IDBPDatabase = any; // Temporarily use 'any' for the IDBPDatabase type to resolve import error
import { queueAndAttemptSyncOperation } from './dbSyncOperations.ts'; // Will be converted later

// Define interfaces for USER_STATE_DEFS and related types
interface UserStateDef {
    store: string;
    type: 'array' | 'simple';
    localOnly: boolean;
    default: any;
}

interface UserStateDefs {
    [key: string]: UserStateDef;
}

// --- User State Definitions ---
export const USER_STATE_DEFS: UserStateDefs = {
    starred: { store: 'starred', type: 'array', localOnly: false, default: [] },
    read: { store: 'read', type: 'array', localOnly: false, default: [] },
    currentDeckGuids: { store: 'currentDeckGuids', type: 'array', localOnly: false, default: [] },
    shuffledOutGuids: { store: 'shuffledOutGuids', type: 'array', localOnly: false, default: [] },
    lastStateSync: { store: 'userSettings', type: 'simple', localOnly: false, default: 0 },
    lastFeedSync: { store: 'userSettings', type: 'simple', localOnly: false, default: 0 },
    openUrlsInNewTabEnabled: { store: 'userSettings', type: 'simple', localOnly: false, default: true },
    imagesEnabled: { store: 'userSettings', type: 'simple', localOnly: false, default: true },
    itemButtonMode: { store: 'userSettings', type: 'simple', localOnly: false, default: 'play' },
    syncEnabled: { store: 'userSettings', type: 'simple', localOnly: false, default: true },
    theme: { store: 'userSettings', type: 'simple', localOnly: false, default: 'dark' },
    themeStyle: { store: 'userSettings', type: 'simple', localOnly: false, default: 'originalDark' },
    themeStyleLight: { store: 'userSettings', type: 'simple', localOnly: false, default: 'originalLight' },
    themeStyleDark: { store: 'userSettings', type: 'simple', localOnly: false, default: 'originalDark' },
    customCss: { store: 'userSettings', type: 'simple', localOnly: false, default: '' },
    fontSize: { store: 'userSettings', type: 'simple', localOnly: true, default: 100 },
    feedWidth: { store: 'userSettings', type: 'simple', localOnly: true, default: 50 },
    feedLastModified: { store: 'userSettings', type: 'simple', localOnly: true, default: 0 },
    rssFeeds: { store: 'userSettings', type: 'simple', localOnly: false, default: {} },
    keywordBlacklist: { store: 'userSettings', type: 'simple', localOnly: false, default: [] },
    shuffleCount: { store: 'userSettings', type: 'simple', localOnly: false, default: 2 },
    lastShuffleResetDate: { store: 'userSettings', type: 'simple', localOnly: false, default: null },
    shadowsEnabled: { store: 'userSettings', type: 'simple', localOnly: false, default: true },
    pregeneratedOnlineDeck: { store: 'userSettings', type: 'simple', localOnly: true, default: null },
    pregeneratedOfflineDeck: { store: 'userSettings', type: 'simple', localOnly: true, default: null }
};

interface SimpleStateValue {
    value: any;
    lastModified: string | null;
}

/**
 * Loads a simple key-value state from the specified store.
 */
export async function loadSimpleState(key: string, storeName: string = 'userSettings'): Promise<SimpleStateValue> {
    return withDb(async (db: IDBPDatabase) => {
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
export async function saveSimpleState(key: string, value: any, storeName: string = 'userSettings'): Promise<void> {
    await withDb(db => db.put(storeName, { key, value, lastModified: new Date().toISOString() }));

    const def = USER_STATE_DEFS[key];
    if (def && !def.localOnly) {
        await queueAndAttemptSyncOperation({
            type: 'simpleUpdate',
            key: key,
            value: value,
            timestamp: new Date().toISOString()
        } as QueueOperation);
    }
}

const getTimestampKey = (storeName: string): string => {
    switch (storeName) {
        case 'starred': return 'starredAt';
        case 'read': return 'readAt';
        case 'currentDeckGuids': return 'addedAt';
        case 'shuffledOutGuids': return 'shuffledAt';
        default: return 'updatedAt';
    }
};

interface ArrayStateValue {
    value: any[];
}

/**
 * Loads all items from a store, performing data migration if necessary.
 */
export async function loadArrayState(storeName: string): Promise<ArrayStateValue> {
    console.log(`ENTERING loadArrayState for ${storeName}`);
    return withDb(async (db: IDBPDatabase) => {
        try {
            const allItems: any[] = await db.getAll(storeName);
            const needsMigration = allItems.length > 0 && (typeof allItems[0] === 'string' || allItems[0].id === undefined);

            if (needsMigration) {
                console.log(`[DB] Migration required for '${storeName}'.`);
                const timestampKey = getTimestampKey(storeName);
                const now = new Date().toISOString();
                // Deduplicate the array before migration to prevent unique constraint errors.
                const uniqueItems = new Map<string, any>();
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
export async function findByGuid(storeName: string, guid: string): Promise<any | undefined> {
    return withDb(db => db.getFromIndex(storeName, 'guid', guid)).catch((e: any) => {
        console.error(`Error finding item by GUID '${guid}' in store '${storeName}':`, e);
        return undefined;
    });
}

interface QueueOperation {
    type: string;
    guid?: string;
    action?: 'add' | 'remove';
    timestamp: string;
    key?: string;
    value?: any;
}

/**
 * Adds or removes a single object locally AND queues the change for synchronization.
 */
export async function updateArrayState(storeName: string, item: { guid: string, [key: string]: any }, add: boolean): Promise<void> {
    // Step 1: Perform the local database operation.
    await withDb(async (db: IDBPDatabase) => {
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
        if (storeName === 'read') opType = 'readDelta';
        
        if (opType) {
            await queueAndAttemptSyncOperation({
                type: opType,
                guid: item.guid,
                action: add ? 'add' : 'remove',
                timestamp: item[getTimestampKey(storeName)] || new Date().toISOString()
            } as QueueOperation);
        }
    }
}

/**
 * Overwrites an array locally, calculates the changes, and queues them for sync.
 */
export async function overwriteArrayAndSyncChanges(storeName: string, newObjects: any[]): Promise<void> {
    const { value: oldObjects } = await loadArrayState(storeName);
    const oldGuids = new Set(oldObjects.map((item: any) => item.guid));
    
    // Step 1: Overwrite the local database. This is the source of truth for the UI.
    await saveArrayState(storeName, newObjects);
    const newGuids = new Set(newObjects.map((item: any) => item.guid));

    // Step 2: Calculate the differences.
    const guidsToRemove = [...oldGuids].filter(guid => !newGuids.has(guid));
    const guidsToAdd = [...newGuids].filter(guid => !newGuids.has(guid));
    
    // Step 3: Check if the store is syncable.
    const defEntry = Object.entries(USER_STATE_DEFS).find(([, v]) => v.store === storeName);
    if (!defEntry || defEntry[1].localOnly) return;
    
    let opType = '';
    if (storeName === 'starred') opType = 'starDelta';
    if (storeName === 'read') opType = 'readDelta';

    if (!opType) {
        // --- FIX: Fallback for arrays without delta handlers (shuffledOutGuids, currentDeckGuids) ---
        await queueAndAttemptSyncOperation({
            type: 'simpleUpdate',
            key: defEntry[0], // Use the key from USER_STATE_DEFS
            value: newObjects,
            timestamp: new Date().toISOString()
        } as any);
        return;
    }

    // ✅ FIX: Loop through the differences and queue operations directly using the public function.
    if (guidsToRemove.length > 0) {
        console.log(`[DB] Queuing ${guidsToRemove.length} 'remove' operations for '${storeName}'.`);
        for (const guid of guidsToRemove) {
            await queueAndAttemptSyncOperation({ type: opType, guid: guid, action: 'remove', timestamp: new Date().toISOString() } as QueueOperation);
        }
    }
    if (guidsToAdd.length > 0) {
        console.log(`[DB] Queuing ${guidsToAdd.length} 'add' operations for '${storeName}'.`);
        for (const guid of guidsToAdd) {
            await queueAndAttemptSyncOperation({ type: opType, guid: guid, action: 'add', timestamp: new Date().toISOString() } as QueueOperation);
        }
    }
}

/**
 * Re-implements the 30-day grace period pruning for read items.
 */
export async function pruneStaleReadItems(readItems: { guid: string, readAt: string }[], feedItems: { guid: string }[]): Promise<void> {
    if (!Array.isArray(readItems) || !Array.isArray(feedItems)) {
        console.warn('[DB] pruneStaleReadItems skipped due to invalid input.');
        return;
    }

    const validFeedGuids = new Set(feedItems.map(item => item.guid));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const prunedReadItems = readItems.filter(item => {
        if (validFeedGuids.has(item.guid)) return true;
        const readAtTimestamp = new Date(item.readAt).getTime();
        return (now - readAtTimestamp) < THIRTY_DAYS_MS;
    });

    if (prunedReadItems.length < readItems.length) {
        const itemsRemoved = readItems.length - prunedReadItems.length;
        console.log(`[DB] Pruning ${itemsRemoved} stale read items.`);
        await overwriteArrayAndSyncChanges('read', prunedReadItems);
    } else {
        console.log('[DB] No stale read items to prune.');
    }
}

/**
 * Overwrites a store LOCALLY ONLY.
 */
export async function saveArrayState(storeName: string, objects: any[]): Promise<void> {
    return withDb(async (db: IDBPDatabase) => {
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