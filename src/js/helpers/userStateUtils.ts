// @filepath: src/js/userStateUtils.js

import { AppState, PendingOperation, ReadItem, StarredItem, DeckItem, ShuffledOutItem } from '@/types/app.ts';

import {
    saveSimpleState,
    saveArrayState,
    updateArrayState,
    overwriteArrayAndSyncChanges
} from '../data/dbUserState.ts';
import {
    loadSimpleState,
    loadArrayState
} from '../data/dbStateDefs.ts';
import { queueAndAttemptSyncOperation } from '../data/dbSyncOperations.ts';

/**
 * A helper function to deeply clone an object, sanitizing it for IndexedDB storage.
 * It removes non-cloneable properties like functions.
 * @param {object} obj The object to sanitize.
 * @returns {object} A sanitized, cloneable copy of the object.
 */
function sanitizeForIndexedDB(obj: any): any {
    // Safest way to clone pure data objects and "un-proxy" Alpine/Vue objects
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch (e) {
        console.error("JSON serialization failed during sanitization, using manual fallback.", e);
    }

    // Fallback manual recursive check that omits non-serializable properties
    const sanitized: { [key: string]: any } = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            const type = typeof value;
            if (type === 'object' && value !== null) {
                if (Array.isArray(value)) {
                    sanitized[key] = value.map(item => sanitizeForIndexedDB(item));
                } else {
                    sanitized[key] = sanitizeForIndexedDB(value);
                }
            } else if (type !== 'function' && type !== 'symbol' && type !== 'undefined') {
                sanitized[key] = value;
            }
        }
    }
    return sanitized;
}


export async function toggleItemStateAndSync(app: AppState, guid: string, stateKey: 'read' | 'starred'): Promise<void> {
    const g = guid.toLowerCase();
    const isCurrentlyActive = (app[stateKey] as Array<ReadItem | StarredItem>).some(item => item.guid.toLowerCase() === g);
    const action = isCurrentlyActive ? 'remove' : 'add';
    const timestamp = new Date().toISOString();
    const itemObject: ReadItem | StarredItem = stateKey === 'read'
        ? { guid, readAt: timestamp }
        : { guid, starredAt: timestamp };

    // --- IMMEDIATE UI UPDATE ---
    if (action === 'add') {
        if (stateKey === 'read') {
            app.read = [...app.read, itemObject as ReadItem];
        } else { // stateKey === 'starred'
            app.starred = [...app.starred, itemObject as StarredItem];
        }
    } else {
        if (stateKey === 'read') {
            app.read = app.read.filter(item => item.guid !== guid);
        } else { // stateKey === 'starred'
            app.starred = app.starred.filter(item => item.guid !== guid);
        }
    }
    
    if (typeof app.updateCounts === 'function') app.updateCounts();

    // 1. Local DB write (AWAITED to prevent race conditions during deck management)
    try {
        await updateArrayState(stateKey, itemObject, action === 'add', app);
    } catch (error) {
        console.error(`[DB State Update] Failed for ${stateKey} on ${guid}:`, error);
    }

    // 2. Queue for server sync (BACKGROUNDED)
    (async () => {
        try {
            const opType = `${stateKey}Delta`;
            const pendingOp: PendingOperation = {
                type: opType,
                guid: guid,
                action: action,
                timestamp: timestamp
            };
            await queueAndAttemptSyncOperation(pendingOp, app);
        } catch (error) {
            console.error(`[Background Sync Queue] Failed for ${stateKey} on ${guid}:`, error);
        }
    })();
}

export async function pruneStaleRead(feedItems: any[], readItems: ReadItem[], currentTS: number): Promise<ReadItem[]> {
    if (!Array.isArray(readItems)) return [];
    if (!Array.isArray(feedItems) || feedItems.length === 0) return readItems;

    const validFeedGuids = new Set(feedItems.filter(e => e && e.guid).map(e => String(e.guid).trim().toLowerCase()));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    return readItems.filter(item => {
        if (!item || !item.guid) {
            console.log("[Pruning] Removing invalid/empty read item.");
            return false;
        }

        const normalizedGuid = String(item.guid).trim().toLowerCase();
        const isInFeed = validFeedGuids.has(normalizedGuid);
        if (isInFeed) return true;

        // Use the timestamp on the object for pruning logic
        if (item.readAt) {
            const readAtTS = new Date(item.readAt).getTime();
            if (!isNaN(readAtTS)) {
                const ageDays = (currentTS - readAtTS) / (24 * 60 * 60 * 1000);
                const isFresh = ageDays < 30;
                if (!isFresh) {
                    console.log(`[Pruning] Removing stale read item ${normalizedGuid} (age: ${ageDays.toFixed(1)} days)`);
                }
                return isFresh;
            }
        }
        
        // If an item somehow has no timestamp, don't prune it.
        return true; 
    });
}

export async function loadAndPruneReadItems(feedItems: any[]): Promise<ReadItem[]> {
    const { value: rawItems } = await loadArrayState('read');
    let needsResave = false;
    
    // Data migration and normalization logic
    let normalizedItems: ReadItem[] = [];
    if (Array.isArray(rawItems)) {
        const defaultTimestamp = new Date().toISOString();
        for (const item of rawItems) {
            if (typeof item === 'string' && item) {
                // Legacy string data: migrate to object
                normalizedItems.push({ guid: item, readAt: defaultTimestamp });
                needsResave = true;
            } else if (typeof item === 'object' && item !== null && typeof item.guid === 'string' && item.guid) {
                // Modern object data: ensure timestamp exists
                const timestamp = item.readAt || item.timestamp;
                if (!item.readAt) {
                    item.readAt = timestamp || defaultTimestamp;
                    needsResave = true;
                }
                normalizedItems.push(item);
            }
        }
    }

    console.log(`[Pruning] Checking ${normalizedItems.length} read items against ${feedItems.length} feed items.`);
    const prunedItems = await pruneStaleRead(feedItems, normalizedItems, Date.now());

    if (prunedItems.length !== normalizedItems.length) {
        console.log(`[Pruning] ${normalizedItems.length - prunedItems.length} items pruned.`);
        needsResave = true;
    } else {
        console.log("[Pruning] No items were pruned.");
    }

    if (needsResave) {
        try {
            await saveArrayState('read', prunedItems);
            console.log(`Sanitized, pruned, or migrated read items. Original count: ${(rawItems as any[]).length}, New count: ${prunedItems.length}`);
        } catch (error) {
            console.error("Error saving pruned read items:", error);
        }
    }

    return prunedItems;
}

export async function loadCurrentDeck(): Promise<DeckItem[]> {
    const { value: storedObjects } = await loadArrayState('currentDeckGuids');
    
    // Handle migration for legacy string-based data
    if (storedObjects && storedObjects.length > 0 && typeof storedObjects[0] === 'string') {
        console.log('[loadCurrentDeck] Migrating legacy string-based deck data...');
        const defaultTimestamp = new Date().toISOString();
        const migratedObjects: DeckItem[] = storedObjects.map((guid: string) => ({ guid, addedAt: defaultTimestamp }));
        await saveArrayState('currentDeckGuids', migratedObjects); // Resave in the new format
        console.log(`[loadCurrentDeck] Migration complete. Loaded ${migratedObjects.length} objects.`);
        return migratedObjects;
    }

    const deckObjects: DeckItem[] = Array.isArray(storedObjects)
        ? storedObjects.filter((item: any) => 
            typeof item === 'object' && 
            item !== null && 
            typeof item.guid === 'string' && 
            item.guid.trim()
          )
        : [];
        
    console.log(`[loadCurrentDeck] Loaded ${deckObjects.length} deck objects.`);
    return deckObjects;
}

/**
 * Saves the current deck of items to local storage and syncs the changes.
 * @param {DeckItem[]} deckObjects Array of deck item objects.
 * @param {AppState | null} app Optional application state for side effects (sync).
 */
export async function saveCurrentDeck(deckObjects: DeckItem[], app: AppState | null = null): Promise<void> {
    if (!Array.isArray(deckObjects)) {
         console.error("[saveCurrentDeck] Invalid input: expected an array of objects.");
         return;
    }
    
    // Validate that we are working with objects that have a valid GUID.
    const validDeckObjects = deckObjects.filter(item => 
        typeof item === 'object' && 
        item !== null && 
        typeof item.guid === 'string' && 
        item.guid.trim()
    );

    if (validDeckObjects.length !== deckObjects.length) {
        console.warn("[saveCurrentDeck] Filtered out invalid items from the generated deck.");
    }

    console.log("[saveCurrentDeck] Saving", validDeckObjects.length, "deck objects.");

    try {
        // Sanitize the deck objects to remove any non-cloneable properties.
        const sanitizedDeckObjects = validDeckObjects.map(item => sanitizeForIndexedDB(item));

        // Overwrite the local database and queue the changes for synchronization.
        await overwriteArrayAndSyncChanges('currentDeckGuids', sanitizedDeckObjects, app);
    } catch (e) {
        console.error("[saveCurrentDeck] An error occurred while saving the deck:", e);
    }
}


// --- Unchanged Functions Below ---

export async function loadShuffleState(): Promise<{ shuffleCount: number; lastShuffleResetDate: string | null; }> {
    const { value: shuffleCount } = await loadSimpleState('shuffleCount');
    const { value: lastShuffleResetDate } = await loadSimpleState('lastShuffleResetDate');
    return {
        shuffleCount: typeof shuffleCount === 'number' ? shuffleCount : 2,
        lastShuffleResetDate: lastShuffleResetDate || null,
    };
}

export async function saveShuffleState(app: AppState, count: number, resetDate: string): Promise<void> {
    await saveSimpleState('shuffleCount', count);
    await saveSimpleState('lastShuffleResetDate', resetDate);
    await queueAndAttemptSyncOperation({ type: 'simpleUpdate', key: 'shuffleCount', value: count, timestamp: new Date().toISOString() } as PendingOperation, app);
    await queueAndAttemptSyncOperation({ type: 'simpleUpdate', key: 'lastShuffleResetDate', value: resetDate, timestamp: new Date().toISOString() } as PendingOperation, app);
}

export async function setFilterMode(app: AppState, mode: string): Promise<void> {
    app.filterMode = mode;
    await saveSimpleState('filterMode', mode);
    await queueAndAttemptSyncOperation({ type: 'simpleUpdate', key: 'filterMode', value: mode, timestamp: new Date().toISOString() } as PendingOperation, app);
}

export async function loadFilterMode(): Promise<string> {
    const { value: mode } = await loadSimpleState('filterMode');
    return mode || 'unread';
}