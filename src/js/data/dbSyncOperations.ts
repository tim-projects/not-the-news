//

import { withDb } from './dbCore.ts';
import { isOnline } from '../utils/connectivity.ts';
import {
    loadSimpleState,
    loadArrayState,
    USER_STATE_DEFS,
    UserStateDef,
    SimpleStateValue
} from './dbStateDefs.ts';
import { getAuthToken } from './dbAuth.ts';
import { compressJson } from '../utils/compression.ts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || window.location.origin;
const COMPRESSIBLE_KEYS = ['read', 'starred', 'currentDeckGuids', 'shuffledOutGuids'];

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
    currentDeckGuids?: { guid: string }[];
    lastFeedSync?: number;
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

import { auth } from '../firebase';

/**
 * --- MODIFIED: Queues any user operation and attempts an immediate sync if online. ---
 * The logic is now generalized and not limited to specific operation types.
 * @param {object} operation The operation object to queue and sync.
 * @param {AppState} [app] The main application object.
 */
export async function queueAndAttemptSyncOperation(operation: Operation, app: AppState | null = null): Promise<void> {
    if (!operation || typeof operation.type !== 'string' || (operation.type === 'simpleUpdate' && (operation.value === null || operation.value === undefined))) {
        console.warn(`[DB] Skipping invalid or empty operation:`, operation);
        return;
    }

    // Client-side Compression
    if (operation.type === 'simpleUpdate' && operation.key && COMPRESSIBLE_KEYS.includes(operation.key) && typeof operation.value !== 'string') {
        try {
            operation.value = await compressJson(operation.value);
        } catch (e) {
            console.error(`[DB] Compression failed for ${operation.key}, sending raw.`, e);
        }
    }

    try {
        const generatedId: number = await _addPendingOperationToBuffer(operation);
        console.log(`[DB] Operation buffered with ID: ${generatedId}`, operation);
        
        const { value: syncEnabled } = await loadSimpleState('syncEnabled') as SimpleStateValue;
        
        // Generalize the immediate sync check to apply to any operation type.
        if (isOnline() && syncEnabled) {
            console.log(`[DB] Attempting immediate sync for ${operation.type} (ID: ${generatedId}).`);
            const syncPayload: Operation[] = [{ ...operation, id: generatedId }];
            const token = await getAuthToken();
            if (!token) {
                console.warn(`[DB] No auth token available for immediate sync, buffering op ${generatedId}.`);
                return;
            }

            const response: Response = await fetch(`${API_BASE_URL}/api/profile`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    "Authorization": `Bearer ${token}`
                },
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
                // After successfully pushing a change, pull the latest state to ensure consistency,
                // BUT skip the key we just updated to avoid immediate overwrite if server is lagging.
                let skipKey: string | null = null;
                if (operation.key) {
                    skipKey = operation.key;
                } else if (operation.type === 'readDelta') {
                    skipKey = 'read';
                } else if (operation.type === 'starDelta') {
                    skipKey = 'starred';
                }
                
                pullUserState(false, skipKey ? [skipKey] : [], app);
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
 * @param {AppState} [app] The main application object.
 */
export async function processPendingOperations(app: AppState | null = null): Promise<void> {
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

    console.log(`[DB] Processing ${operations.length} pending operations...`);
    
    const MAX_BATCH_SIZE = 10;
    const allSkipKeys = new Set<string>();
    
    // Process in chunks to respect server limit
    for (let i = 0; i < operations.length; i += MAX_BATCH_SIZE) {
        const batch = operations.slice(i, i + MAX_BATCH_SIZE);
        console.log(`[DB] Sending batch ${i / MAX_BATCH_SIZE + 1} (${batch.length} ops) to /api/user-state.`);

        try {
            const token = await getAuthToken();
            if (!token) {
                console.warn('[DB] No auth token available for batch sync.');
                return;
            }

            const response: Response = await fetch(`${API_BASE_URL}/api/profile`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify(batch)
            });

            if (!response.ok) {
                throw new Error(`HTTP error ${response.status} for batch sync. Details: ${await response.text()}`);
            }

            const responseData: SyncResponse = await response.json();
            console.log(`[DB] Batch ${i / MAX_BATCH_SIZE + 1} sync successful. Server response:`, responseData);

            if (responseData.results && Array.isArray(responseData.results)) {
                await withDb(async (db: IDBPDatabase) => {
                    const tx = db.transaction('pendingOperations', 'readwrite');
                    for (const result of responseData.results as SyncResult[]) {
                        if (result.status === 'success' && result.id !== undefined) {
                            await tx.store.delete(result.id);
                            
                            // Identify key to skip to prevent race condition on immediate pull
                            const originalOp = batch.find(op => op.id === result.id);
                            if (originalOp) {
                                if (originalOp.key) allSkipKeys.add(originalOp.key);
                                else if (originalOp.type === 'readDelta') allSkipKeys.add('read');
                                else if (originalOp.type === 'starDelta') allSkipKeys.add('starred');
                            }
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

        } catch (error: any) {
            console.error('[DB] Error during batch synchronization:', error);
            // We continue to the next batch even if one fails
        }
    }

    // After ALL batches are processed, perform a single pull to sync state,
    // skipping all keys we just pushed to the server.
    if (allSkipKeys.size > 0) {
        console.log(`[DB] Post-batch sync: Triggering single pull for ${allSkipKeys.size} unique keys.`);
        pullUserState(false, Array.from(allSkipKeys), app);
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
    
    const token = await getAuthToken();
    if (!token) {
        console.warn(`[DB] No auth token available for ${key}, skipping pull.`);
        return { key, status: 'no_token' };
    }

    const headers: { [key: string]: string } = { 
        'Content-Type': 'application/json',
        "Authorization": `Bearer ${token}`
    };
    if (localTimestamp && !force) headers['If-None-Match'] = localTimestamp;

    // Calculate 'since' for delta sync
    let queryParams = '';
    if (def.type === 'array' && (def.syncMode || 'merge') === 'merge' && !force && Array.isArray(localData)) {
        const timeField = key === 'read' ? 'readAt' : (key === 'starred' ? 'starredAt' : 'timestamp');
        const maxTime = localData.reduce((max, item) => {
            const t = new Date(item[timeField] || item.timestamp || 0).getTime();
            return t > max ? t : max;
        }, 0);
        if (maxTime > 0) {
            queryParams = `?since=${new Date(maxTime).toISOString()}`;
        }
    }

    let retries = 2;
    while (retries >= 0) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout per key

            const response: Response = await fetch(`${API_BASE_URL}/api/profile/${key}${queryParams}`, { 
                method: 'GET', 
                headers,
                signal: controller.signal 
            });
            clearTimeout(timeoutId);

            if (response.status === 304 && !force) {
                return { key, status: 304, timestamp: localTimestamp };
            }
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[DB] HTTP error for ${key}: ${response.status} - ${errorText}`);
                return { key, status: response.status };
            }
            const data: { value: any, lastModified: string, partial?: boolean } = await response.json();
            const isPartial = data.partial === true;
            if (isPartial) console.log(`[DB Sync] Received partial delta for ${key}.`);
            else console.log(`[DB Sync] Received full data for ${key}:`, data.value);

            if (def.type === 'array') {
                const serverObjects: any[] = data.value || [];
                const localDataRaw: any[] = localData || [];
                const syncMode = def.syncMode || 'merge';

                if (syncMode === 'replace' || force) {
                    console.log(`[DB Sync] Replacing local '${key}' with server snapshot.`);
                    await withDb(async (db: IDBPDatabase) => {
                        const tx = db.transaction(def.store, 'readwrite');
                        await tx.store.clear();
                        for (const item of serverObjects) {
                            if (typeof item === 'object' && item !== null && typeof item.guid === 'string' && item.guid.trim()) {
                                const toStore = { ...item };
                                delete toStore.id; // Let IndexedDB generate new local IDs
                                await tx.store.put(toStore);
                            } else {
                                console.warn(`[DB Sync] Filtered out invalid item during ${key} replace:`, item);
                            }
                        }
                        await tx.done;
                    });
                } else {
                    // Merge mode (default for arrays)
                    const localGuids = new Set(localDataRaw.map((item: any) => item.guid));
                    const serverGuids = new Set(serverObjects.map((item: any) => item.guid));

                    const objectsToAdd = serverObjects.filter((item: any) => !localGuids.has(item.guid));
                    
                    // Deduplicate objectsToAdd by GUID to prevent ConstraintError on unique index
                    const uniqueObjectsToAdd = Array.from(
                        objectsToAdd.reduce((map, item) => {
                            if (item.guid) {
                                const g = item.guid.toLowerCase();
                                map.set(g, { ...item, guid: g });
                            }
                            return map;
                        }, new Map<string, any>()).values()
                    );

                    // If partial (delta), we CANNOT determine deletions, so we skip removal logic.
                    // Removals will only be processed during a full sync (force=true or no 'since' param).
                    const objectsToRemove = isPartial ? [] : localDataRaw.filter((item: any) => !serverGuids.has(item.guid));

                    if (uniqueObjectsToAdd.length > 0 || objectsToRemove.length > 0) {
                        console.log(`[DB Sync] Merging '${key}': ${uniqueObjectsToAdd.length} added, ${objectsToRemove.length} removed.`);
                        await withDb(async (db: IDBPDatabase) => {
                            const tx = db.transaction(def.store, 'readwrite');
                            const store = tx.objectStore(def.store);
                            const index = store.index('guid');

                            for (const item of uniqueObjectsToAdd) {
                                const existingId = await index.getKey(item.guid);
                                if (existingId) {
                                    await store.put({ ...item, id: existingId });
                                } else {
                                    const toAdd = { ...item };
                                    delete toAdd.id;
                                    await store.put(toAdd);
                                }
                            }
                            for (const item of objectsToRemove) {
                                await store.delete(item.id);
                            }
                            await tx.done;
                        });
                    }
                }
            } else {
                // Use the internal save function to prevent re-queuing this change.
                await _saveSyncMetaState(key, data.value, data.lastModified);
            }
            
            return { key, status: 200, timestamp: data.lastModified };
        } catch (error: any) {
            const isAbort = error.name === 'AbortError';
            if (retries > 0) {
                console.warn(`[DB] Pull failed for ${key} (${isAbort ? 'Timeout' : error.message}), retrying... (${retries} left)`);
                retries--;
                // Exponential-ish backoff: 1s then 2s
                await new Promise(resolve => setTimeout(resolve, (2 - retries) * 1000));
                continue;
            }
            console.error(`[DB] Failed to pull ${key} after retries:`, error);
            return { key, status: 'error' };
        }
    }
    return { key, status: 'error' };
}

/**
 * Pulls the user state from the server.
 */
export async function pullUserState(force: boolean = false, skipKeys: string[] = [], app: AppState | null = null): Promise<void> {
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
    console.log(`[DB] Pulling user state (force=${force}, skip=${skipKeys.join(',')})...`);
    
    try {
        // --- SOLUTION: Efficient Theme Check ---
        let finalSkipKeys = [...skipKeys];
        const localTheme = localStorage.getItem('theme');
        
        // If we are trying to skip keys (during fast init), we must verify theme first
        if (skipKeys.length > 0 && !force && localTheme) {
            console.log('[DB Sync] Verifying theme consistency before deferring heavy keys...');
            const themeDef = USER_STATE_DEFS['theme'];
            const themeResult = await _pullSingleStateKey('theme', themeDef, false);
            
            if (themeResult.status === 200) {
                const { value: serverTheme } = await loadSimpleState('theme');
                if (serverTheme !== localTheme) {
                    console.log(`[DB Sync] Theme mismatch detected (Local: ${localTheme}, Server: ${serverTheme}). Aborting skip and pulling all state.`);
                    finalSkipKeys = []; // Force full pull due to inconsistency
                } else {
                    console.log('[DB Sync] Theme is consistent, proceeding with deferred sync.');
                }
            }
        }
        // --- END SOLUTION ---

        const keysToPull: [string, UserStateDef][] = Object.entries(USER_STATE_DEFS)
            .filter(([key, def]) => !def.localOnly && key !== 'syncEnabled' && !finalSkipKeys.includes(key)) as [string, UserStateDef][];
        
        const resultsSettled = await Promise.allSettled(keysToPull.map(([key, def]) => _pullSingleStateKey(key, def, force)));
        
        const results = resultsSettled
            .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
            .map(r => r.value);

        const newestOverallTimestamp: string = results.reduce((newest: string, result: { key: string, status: string | number, timestamp?: string }) => {
            return (result?.timestamp && result.timestamp > newest) ? result.timestamp : newest;
        }, '');

        if (newestOverallTimestamp) await _saveSyncMetaState('lastStateSync', newestOverallTimestamp);

        // Notify app to reload from IndexedDB if provided
        if (app && app.loadFeedItemsFromDB) {
            console.log('[DB Sync] State pull complete, triggering app data reload.');
            // We use a small delay to ensure all async IndexedDB operations from results settle
            setTimeout(() => {
                // @ts-ignore - _loadAndManageAllData is private in the type but accessible here
                if (app._loadAndManageAllData) app._loadAndManageAllData();
            }, 100);
        }
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
 * Helper to fetch a list of GUIDs from the server in batches.
 */
export async function _fetchItemsInBatches(guids: string[], app: AppState | null, totalOverall: number, currentOverallOffset: number): Promise<FeedItem[] | null> {
    const BATCH_SIZE = 50;
    const items: FeedItem[] = [];
    
    for (let i = 0; i < guids.length; i += BATCH_SIZE) {
        if (!isOnline()) {
            console.warn('[DB] Offline mid-sync. Aborting batch fetch.');
            return null;
        }
        const batch = guids.slice(i, i + BATCH_SIZE);
        const token = await getAuthToken();
        if (!token) {
            console.warn('[DB] No auth token available for batch fetch.');
            return null;
        }

        const response = await fetch(`${API_BASE_URL}/api/list`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ guids: batch })
        });

        if (response.ok) {
            const fetched: FeedItem[] = await response.json();
            items.push(...fetched);
            
            if (app) {
                const totalFetchedSoFar = currentOverallOffset + items.length;
                app.progressMessage = `Fetching feed content... (${totalFetchedSoFar}/${totalOverall})`;
            }
        } else {
            console.error(`[DB] Failed to fetch batch. Status: ${response.status}`);
            return null;
        }
    }
    return items;
}

/**
 * Performs a feed synchronization, fetching new or updated items.
 * @returns {Promise<boolean>} True if sync was successful, false otherwise.
 */
export async function performFeedSync(app: AppState): Promise<boolean> {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled') as SimpleStateValue;
    if (!isOnline() || !syncEnabled) {
        if (syncEnabled) console.log('[DB] Offline. Skipping feed sync.');
        return true;
    }
    
    console.log('[DB] Fetching new feed items from worker (Delta Sync).');

    try {
        const token = await getAuthToken();
        if (!token) {
            console.warn('[DB] No auth token available for feed sync.');
            return false;
        }

        // DELTA SYNC: Find the timestamp of the newest item we have locally
        let newestTimestamp = 0;
        await withDb(async (db: IDBPDatabase) => {
            const items = await db.getAll('feedItems');
            if (items.length > 0) {
                newestTimestamp = Math.max(...items.map((i: any) => i.timestamp || 0));
            }
        });
        console.log(`[DB] Local newest item timestamp: ${newestTimestamp} (${new Date(newestTimestamp).toISOString()})`);

        // Trigger worker refresh with delta parameter
        const response: Response = await fetch(`${API_BASE_URL}/api/refresh`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ since: newestTimestamp })
        });

        if (!response.ok) {
            if (response.status === 429) {
                console.warn('[DB] Sync throttled by server. Backing off.');
                const now = Date.now();
                await _saveSyncMetaState('lastFeedSync', now);
                if (app) app.lastFeedSync = now;
                return false;
            }
            const errText = await response.text();
            console.error(`[DB] HTTP error ${response.status} for /api/refresh: ${errText}`);
            throw new Error(`HTTP error ${response.status} for /api/refresh: ${errText}`);
        }

        const data: any = await response.json();
        const deltaItems: any[] = data.items || [];
        console.log(`[DB] Received ${deltaItems.length} new items from worker (Delta).`);

        if (deltaItems.length > 0) {
            // The worker returns minimized items (GUID + flags only). We must fetch full content.
            const guids = deltaItems.map(i => i.guid);
            console.log(`[DB] Fetching full content for ${guids.length} delta items...`);
            
            const fullItems = await _fetchItemsInBatches(guids, app, guids.length, 0);

            if (fullItems && fullItems.length > 0) {
                // Deduplicate fullItems by GUID to prevent ConstraintError
                // and normalize to lowercase for consistency
                const uniqueFullItems = Array.from(
                    fullItems.reduce((map, item) => {
                        if (item.guid) {
                            const g = item.guid.toLowerCase();
                            map.set(g, { ...item, guid: g });
                        }
                        return map;
                    }, new Map<string, any>()).values()
                );

                await withDb(async (db: IDBPDatabase) => {
                    const tx = db.transaction('feedItems', 'readwrite');
                    const store = tx.objectStore('feedItems');
                    const index = store.index('guid');

                    for (const item of uniqueFullItems) {
                        // Check for existing item by GUID to get its local numeric ID
                        const existingId = await index.getKey(item.guid);
                        if (existingId) {
                            await store.put({ ...item, id: existingId });
                        } else {
                            const toAdd = { ...item };
                            delete toAdd.id;
                            await store.put(toAdd);
                        }
                    }
                    await tx.done;
                });

                // Trigger immediate refresh in UI
                if (app && app.loadFeedItemsFromDB) await app.loadFeedItemsFromDB();
                if (app && app.loadAndDisplayDeck) await app.loadAndDisplayDeck();
                if (app && app.updateCounts) app.updateCounts();
            } else {
                console.warn('[DB] Failed to fetch full content for delta items.');
            }
        }
        
        // Update last sync time locally after success (even if 0 items)
        const now = Date.now();
        await _saveSyncMetaState('lastFeedSync', now);
        if (app) app.lastFeedSync = now;
        
        return true;

    } catch (error: any) {
        console.error('[DB] Failed to synchronize feed from worker:', error);
        return false;
    }
}

/**
 * Performs a full synchronization, pulling user state and feed items.
 * @returns {Promise<boolean>} True if sync was successful, false otherwise.
 */
export async function performFullSync(app: AppState): Promise<boolean> {
    if (!isOnline()) {
        console.log('[DB] Skipping full sync: Offline.');
        return true;
    }
    const { value: syncEnabled } = await loadSimpleState('syncEnabled') as SimpleStateValue;
    if (!syncEnabled) return true;
    
    console.log('[DB] Full sync initiated.');
    try {
        // Run push first, then pulls.
        await processPendingOperations(app); // Process any items that were queued while offline.
        await pullUserState(false, [], app);
        const syncSuccess = await performFeedSync(app);
        return syncSuccess;
    } catch (error: any) {
        console.error('[DB] Full sync failed:', error);
        return false;
    }
}