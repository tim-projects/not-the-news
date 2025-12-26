//

import { withDb } from './dbCore.ts';
import { isOnline } from '../utils/connectivity.js'; // Will be converted later
import {
    loadSimpleState,
    loadArrayState,
    // NOTE: We no longer import writers like `saveSimpleState` or `updateArrayState`
    // to prevent accidental sync loops. This file manages its own local writes.
    USER_STATE_DEFS
} from './dbUserState.ts';

// Locally declare types that are not exported from their modules
type IDBPDatabase = any;
type SimpleStateValue = any;
type UserStateDef = any;

const API_BASE_URL: string = window.location.origin;

interface Operation {
    id?: number;
    type: string;
    key?: string;
    value?: any;
    guid?: string;
    action?: 'add' | 'remove';
    timestamp: string;
}

interface SyncResult {
    id: number;
    status: 'success' | 'failed';
    opType: string; // Original operation type
    reason?: string; // Failure reason
}

interface SyncResponse {
    results?: SyncResult[];
    serverTime?: string;
}

interface AppState { // Minimal AppState interface needed for performFeedSync
    loadFeedItemsFromDB?: () => Promise<void>;
    loadAndDisplayDeck?: () => Promise<void>;
    updateCounts?: () => void;
    progressMessage?: string;
}



/**
 * A private helper to save sync-related metadata directly to IndexedDB
 * without triggering the sync queue. This is critical to prevent infinite loops.
 * @param {string} key The key to save (e.g., 'lastStateSync').
 * @param {any} value The value to save.
 * @param {string} [timestamp] Optional timestamp to use. Defaults to current time.
 * @returns {Promise<void>}
 */
async function _saveSyncMetaState(key: string, value: any, timestamp?: string): Promise<void> {
    return withDb(async (db: IDBPDatabase) => {
        try {
            const lastModified = timestamp || new Date().toISOString();
            // Directly use `db.put` to bypass the queueing logic in dbUserState.js
            await db.put('userSettings', { key, value, lastModified });
        } catch (e: any) {
            console.error(`[DB] Failed to save sync metadata for key '${key}':`, e);
        }
    });
}

/**
 * A private helper to add a user operation to the pending buffer.
 * @param {object} operation The operation object to add.
 * @returns {Promise<number>} The ID of the buffered operation.
 */
async function _addPendingOperationToBuffer(operation: Operation): Promise<number> {
    return withDb(async (db: IDBPDatabase) => {
        // Ensure we don't try to store an existing primary key.
        const opToStore: Operation = { ...operation };
        if (opToStore.id) delete opToStore.id;
        try {
            const tx = db.transaction('pendingOperations', 'readwrite');
            const id = await tx.store.add(opToStore);
            await tx.done;
            return id;
        } catch (e: any) {
            console.error('[DB] Error buffering operation:', e);
            throw e;
        }
    });
}

/**
 * --- MODIFIED: Queues any user operation and attempts an immediate sync if online. ---
 * The logic is now generalized and not limited to specific operation types.
 * @param {object} operation The operation object to queue and sync.
 */
export async function queueAndAttemptSyncOperation(operation: Operation): Promise<void> {
    if (!operation || typeof operation.type !== 'string' || (operation.type === 'simpleUpdate' && (operation.value === null || operation.value === undefined))) {
        console.warn(`[DB] Skipping invalid or empty operation:`, operation);
        return;
    }

    try {
        const generatedId: number = await _addPendingOperationToBuffer(operation);
        console.log(`[DB] Operation buffered with ID: ${generatedId}`, operation);
        
        const { value: syncEnabled } = await loadSimpleState('syncEnabled') as SimpleStateValue;
        
        // Generalize the immediate sync check to apply to any operation type.
        if (isOnline() && syncEnabled) {
            console.log(`[DB] Attempting immediate sync for ${operation.type} (ID: ${generatedId}).`);
            const syncPayload: Operation[] = [{ ...operation, id: generatedId }];
            const response: Response = await fetch(`${API_BASE_URL}/api/user-state`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(syncPayload)
            });

            if (!response.ok) {
                const errorText: string = await response.text();
                throw new Error(`HTTP error ${response.status} for immediate sync. Details: ${errorText}`);
            }

            const responseData: SyncResponse = await response.json();
            const result: SyncResult | undefined = responseData.results?.find((res: SyncResult) => res.id === generatedId);

            if (result?.status === 'success') {
                await withDb((db: IDBPDatabase) => db.delete('pendingOperations', generatedId));
                console.log(`[DB] Successfully synced and removed immediate op ${generatedId} (${operation.type}).`);
                if (responseData.serverTime) await _saveSyncMetaState('lastStateSync', responseData.serverTime);

                // --- SOLUTION ---
                // After successfully pushing a change, pull the latest state to ensure consistency.
                pullUserState();
                // --- END SOLUTION ---

            } else {
                console.warn(`[DB] Immediate sync for op ${generatedId} reported non-success by server:`, result);
            }
        } else {
            console.log(`[DB] ${!isOnline() ? 'Offline.' : 'Sync is disabled.'} Buffering op ${generatedId} for later batch sync.`);
        }
    } catch (networkError: any) {
        console.error(`[DB] Network error during immediate sync for ${operation.type}. Will retry with batch sync.`, networkError);
    }
}

/**
 * Processes all pending operations in the buffer and syncs them with the server.
 */
export async function processPendingOperations(): Promise<void> {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled') as SimpleStateValue;
    if (!isOnline() || !syncEnabled) {
        console.log('[DB] Offline or sync is disabled. Skipping batch sync.');
        return;
    }
    
    const operations: Operation[] | null = await withDb((db: IDBPDatabase) => db.getAll('pendingOperations')).catch((e: any) => {
        console.error('[DB] Error fetching pending operations:', e);
        return null;
    });

    if (!operations || operations.length === 0) {
        if (operations) console.log('[DB] No pending operations.');
        return;
    }

    console.log(`[DB] Sending ${operations.length} batched operations to /api/user-state.`);

    try {
        const response: Response = await fetch(`${API_BASE_URL}/api/user-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operations)
        });

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}. Details: ${await response.text()}`);
        }

        const responseData: SyncResponse = await response.json();
        console.log('[DB] Batch sync successful. Server response:', responseData);

        if (responseData.results && Array.isArray(responseData.results)) {
            await withDb(async (db: IDBPDatabase) => {
                const tx = db.transaction('pendingOperations', 'readwrite');
                for (const result of responseData.results as SyncResult[]) {
                    if (result.status === 'success' && result.id !== undefined) {
                        await tx.store.delete(result.id);
                    } else {
                        console.warn(`[DB] Op ${result.id ?? 'N/A'} (${result.opType}) ${result.status}: ${result.reason || 'N/A'}`);
                    }
                }
                await tx.done;
            });
        } else {
            console.warn('[DB] Server response invalid; cannot clear buffered operations.');
        }

        if (responseData.serverTime) await _saveSyncMetaState('lastStateSync', responseData.serverTime);

        // --- SOLUTION ---
        // After a successful batch sync, pull the latest state.
        pullUserState();
        // --- END SOLUTION ---

    } catch (error: any) {
        console.error('[DB] Error during batch synchronization:', error);
    }
}

let _isPullingUserState = false;
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500;

/**
 * A private helper to pull a single user state key from the server.
 */
async function _pullSingleStateKey(key: string, def: UserStateDef, force: boolean = false): Promise<{ key: string, status: string | number, timestamp?: string }> {
    // ✅ --- START: RACE CONDITION FIX ---
    // Before fetching from the server, check if there are local changes for this key
    // that are waiting to be synced. If so, we must not overwrite them.
    // We only skip if NOT in force mode.
    if (!force) {
        const allPendingOps: Operation[] = await withDb((db: IDBPDatabase) => db.getAll('pendingOperations')).catch(() => []);
        
        // Check for operations that match the key directly (e.g., 'simpleUpdate' for 'syncEnabled')
        // or match the operation type related to the key (e.g., 'starDelta' for the 'starred' key).
        const hasPendingOperations = allPendingOps.some((op: Operation) => 
            op.key === key || 
            (op.type === 'starDelta' && key === 'starred') ||
            (op.type === 'readDelta' && key === 'read') ||
            (op.type === 'simpleUpdate' && op.key === 'currentDeckGuids')
        );

        if (hasPendingOperations) {
            console.log(`[DB] Skipping pull for '${key}' because local changes are pending synchronization.`);
            return { key, status: 'skipped_pending' };
        }
    }
    // ✅ --- END: RACE CONDITION FIX ---

    const { value: localData, lastModified } = def.type === 'array' ? await loadArrayState(def.store) : await loadSimpleState(key, def.store) as SimpleStateValue;
    const localTimestamp: string = lastModified || '';
    
    const headers: { [key: string]: string } = { 'Content-Type': 'application/json' };
    if (localTimestamp && !force) headers['If-None-Match'] = localTimestamp;

    try {
        const response: Response = await fetch(`${API_BASE_URL}/api/user-state/${key}`, { method: 'GET', headers });

        if (response.status === 304 && !force) {
            return { key, status: 304, timestamp: localTimestamp };
        }
        if (!response.ok) {
            console.error(`[DB] HTTP error for ${key}: ${response.status}`);
            return { key, status: response.status };
        }
        const data: { value: any, lastModified: string } = await response.json();
        console.log(`[DB Sync] Received data for ${key}:`, data.value);

        if (def.type === 'array') {
            const serverObjects: any[] = data.value || [];
            const localObjects: any[] = localData || [];
            const serverGuids = new Set(serverObjects.map((item: any) => item.guid));
            const localGuids = new Set(localObjects.map((item: any) => item.guid));

            const objectsToAdd = force ? serverObjects : serverObjects.filter((item: any) => !localGuids.has(item.guid));
            const objectsToRemove = force ? [] : localObjects.filter((item: any) => !serverGuids.has(item.guid));

            if (objectsToAdd.length > 0 || objectsToRemove.length > 0 || force) {
                 await withDb(async (db: IDBPDatabase) => {
                    const tx = db.transaction(def.store, 'readwrite');
                    if (force) await tx.store.clear(); // Clear local store if forcing
                    for (const item of objectsToAdd) await tx.store.put(item);
                    for (const item of objectsToRemove) {
                        if (!force) await tx.store.delete(item.id);
                    }
                    await tx.done;
                });
            }
        } else {
            // Use the internal save function to prevent re-queuing this change.
            await _saveSyncMetaState(key, data.value, data.lastModified);
        }
        
        return { key, status: 200, timestamp: data.lastModified };
    } catch (error: any) {
        console.error(`[DB] Failed to pull ${key}:`, error);
        return { key, status: 'error' };
    }
}

/**
 * Pulls the user state from the server.
 */
export async function pullUserState(force: boolean = false): Promise<void> {
    if (!isOnline()) return;

    let { value: syncEnabled } = await loadSimpleState('syncEnabled') as SimpleStateValue;
    
    // If sync is disabled locally, we should still pull the 'syncEnabled' key
    // to see if it was enabled on another device.
    if (!syncEnabled && !force) {
        console.log('[DB] Sync is disabled locally. Checking for remote status...');
        const syncEnabledDef = USER_STATE_DEFS['syncEnabled'];
        const result = await _pullSingleStateKey('syncEnabled', syncEnabledDef, false);
        if (result.status === 200) {
             const state = await loadSimpleState('syncEnabled') as SimpleStateValue;
             syncEnabled = state.value;
        }
    }

    if (!syncEnabled && !force) {
        return;
    }
    
    if (_isPullingUserState && !force) return;
    const now: number = Date.now();
    if (!force && now - _lastPullAttemptTime < PULL_DEBOUNCE_MS) return;

    _lastPullAttemptTime = now;
    _isPullingUserState = true;
    console.log(`[DB] Pulling user state (force=${force})...`);
    
    try {
        const keysToPull: [string, UserStateDef][] = Object.entries(USER_STATE_DEFS).filter(([key, def]) => !def.localOnly && key !== 'syncEnabled') as [string, UserStateDef][];
        const results: { key: string, status: string | number, timestamp?: string }[] = await Promise.all(keysToPull.map(([key, def]) => _pullSingleStateKey(key, def, force)));
        
        const newestOverallTimestamp: string = results.reduce((newest: string, result: { key: string, status: string | number, timestamp?: string }) => {
            return (result?.timestamp && result.timestamp > newest) ? result.timestamp : newest;
        }, '');

        if (newestOverallTimestamp) await _saveSyncMetaState('lastStateSync', newestOverallTimestamp);
    } catch (error: any) {
        console.error('[DB] User state pull failed:', error);
    } finally {
        _isPullingUserState = false;
        console.log('[DB] User state pull completed.');
    }
}

interface FeedItem {
    guid: string;
    // Add other properties if they exist in the feed item
}

/**
 * Retrieves all items from the feedItems store.
 */
export async function getAllFeedItems(): Promise<FeedItem[]> {
    return withDb((db: IDBPDatabase) => db.getAll('feedItems')).catch((e: any) => {
        console.error('Failed to get all feed items:', e);
        return [];
    });
}

/**
 * Performs a feed synchronization, fetching new or updated items.
 * @returns {Promise<boolean>} True if sync was successful, false otherwise.
 */
export async function performFeedSync(app: AppState): Promise<boolean> {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled') as SimpleStateValue;
    if (!isOnline() || !syncEnabled) {
        if (syncEnabled) console.log('[DB] Offline. Skipping feed sync.');
        return true; // Not an error
    }
    
    console.log('[DB] Fetching feed items from server.');

    try {
        const { value: lastFeedSyncTime } = await loadSimpleState('lastFeedSync') as SimpleStateValue;
        const response: Response = await fetch(`${API_BASE_URL}/api/feed-guids?since=${lastFeedSyncTime || ''}`);

        if (response.status === 304) {
            console.log('[DB] Feed not modified.');
            return true;
        }
        if (!response.ok) throw new Error(`HTTP error ${response.status} for /api/feed-guids`);

        const responseData: { guids: string[], serverTime: string } = await response.json();
        console.log('[DB] /api/feed-guids response:', responseData);
        const { guids: serverGuidsList, serverTime } = responseData;
        const serverGuids = new Set(serverGuidsList);
        const localItems: FeedItem[] = await getAllFeedItems();
        const localGuids = new Set(localItems.map(item => item.guid));

        const guidsToFetch = [...serverGuids].filter(guid => !localGuids.has(guid));
        console.log(`[DB] GUIDs to fetch: ${guidsToFetch.length}`, guidsToFetch);
        const guidsToDelete = [...localGuids].filter(guid => !serverGuids.has(guid));

        console.log(`[DB] New GUIDs: ${guidsToFetch.length}, Deleting: ${guidsToDelete.length}`);

        const totalToFetch = guidsToFetch.length;
        let fetchedSoFar = 0;

        if (guidsToFetch.length > 0) {
            // ✅ STABILITY FIX: Re-introduce batching for fetching item bodies to avoid network errors on large updates.
            const BATCH_SIZE: number = 50;
            const newItems: FeedItem[] = [];
            for (let i = 0; i < guidsToFetch.length; i += BATCH_SIZE) {
                const batch = guidsToFetch.slice(i, i + BATCH_SIZE);
                const itemsResponse: Response = await fetch(`${API_BASE_URL}/api/feed-items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ guids: batch })
                });

                if (itemsResponse.ok) {
                    const fetchedItems: FeedItem[] = await itemsResponse.json();
                    console.log(`[DB] Fetched batch of ${fetchedItems.length} items:`, fetchedItems);
                    newItems.push(...fetchedItems);
                    
                    fetchedSoFar += fetchedItems.length;
                    if (app) {
                        app.progressMessage = `Fetching feed content... (${fetchedSoFar}/${totalToFetch})`;
                    }
                } else {
                    console.error(`[DB] Failed to fetch a batch of feed items. Status: ${itemsResponse.status}`);
                    return false;
                }
            }
            
            await withDb(async (db: IDBPDatabase) => {
                const tx = db.transaction('feedItems', 'readwrite');
                for (const item of newItems) if (item.guid) await tx.store.put(item);
                await tx.done;
            });
        }
        
        if (guidsToDelete.length > 0) {
            const guidToIdMap = new Map<string, number>(localItems.map(item => [item.guid, (item as any).id])); // Assuming item.id exists and is number
            await withDb(async (db: IDBPDatabase) => {
                const tx = db.transaction('feedItems', 'readwrite');
                for (const guid of guidsToDelete) {
                    const id = guidToIdMap.get(guid);
                    if (id !== undefined) await tx.store.delete(id);
                }
                await tx.done;
            });
        }

        if (serverTime) await _saveSyncMetaState('lastFeedSync', serverTime);
        
        return true;

    } catch (error: any) {
        console.error('[DB] Failed to synchronize feed:', error);
        return false;
    }
}

/**
 * Performs a full synchronization, pulling user state and feed items.
 * @returns {Promise<boolean>} True if sync was successful, false otherwise.
 */
export async function performFullSync(app: AppState): Promise<boolean> {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled') as SimpleStateValue;
    if (!isOnline() || !syncEnabled) return true;
    
    console.log('[DB] Full sync initiated.');
    try {
        // Run push first, then pulls.
        await processPendingOperations(); // Process any items that were queued while offline.
        await pullUserState();
        const syncSuccess = await performFeedSync(app);
        return syncSuccess;
    } catch (error: any) {
        console.error('[DB] Full sync failed:', error);
        return false;
    }
}