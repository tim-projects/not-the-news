//

import { withDb } from './dbCore.ts';
import {
    USER_STATE_DEFS,
    loadSimpleState,
    loadArrayState,
    UserStateDef,
    SimpleStateValue,
    ArrayStateValue
} from './dbStateDefs.ts';
import { queueAndAttemptSyncOperation } from './dbSyncOperations.ts';

// Locally declare types that are not exported from their modules
type IDBPDatabase = any;

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
        } as any);
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

/**
 * Finds a single object in a store by its GUID.
 */
export async function findByGuid(storeName: string, guid: string): Promise<any | undefined> {
    return withDb(db => db.getFromIndex(storeName, 'guid', guid)).catch((e: any) => {
        console.error(`Error finding item by GUID '${guid}' in store '${storeName}':`, e);
        return undefined;
    });
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
            } as any);
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
            await queueAndAttemptSyncOperation({ type: opType, guid: guid, action: 'remove', timestamp: new Date().toISOString() } as any);
        }
    }
    if (guidsToAdd.length > 0) {
        console.log(`[DB] Queuing ${guidsToAdd.length} 'add' operations for '${storeName}'.`);
        for (const guid of guidsToAdd) {
            await queueAndAttemptSyncOperation({ type: opType, guid: guid, action: 'add', timestamp: new Date().toISOString() } as any);
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
        const isInFeed = validFeedGuids.has(item.guid);
        if (isInFeed) return true;
        
        const readAtTimestamp = new Date(item.readAt).getTime();
        const ageDays = (now - readAtTimestamp) / (24 * 60 * 60 * 1000);
        const isFresh = ageDays < 30;
        
        if (!isFresh) {
            console.log(`[Pruning] Item ${item.guid} is stale (age: ${ageDays.toFixed(1)} days) and not in current feed.`);
        }
        return isFresh;
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