// @filepath: src/js/data/dbSyncOperations.js

import { withDb } from './dbCore.js';
import { isOnline } from '../utils/connectivity.js';
import {
    loadSimpleState,
    saveSimpleState,
    loadArrayState,
    USER_STATE_DEFS
} from './dbUserState.js';

const API_BASE_URL = window.location.origin;

// --- Functions without changes ---
async function _addPendingOperationToBuffer(operation) { /* ... no changes ... */ }
export async function queueAndAttemptSyncOperation(operation) { /* ... no changes ... */ }
export async function processPendingOperations() { /* ... no changes ... */ }


let _isPullingUserState = false;
let _lastPullAttemptTime = 0;
const PULL_DEBOUNCE_MS = 500;

/**
 * A private helper to pull a single user state key from the server.
 */
async function _pullSingleStateKey(key, def) {
    let localTimestamp = '';
    let isLocalStateEmpty = false;

    const { value, lastModified } = def.type === 'array' ? await loadArrayState(def.store) : await loadSimpleState(key, def.store);
    const hasValidData = Array.isArray(value) && value.length > 0;
    isLocalStateEmpty = !hasValidData;
    if (hasValidData) localTimestamp = lastModified || '';
    
    const headers = { 'Content-Type': 'application/json' };
    if (!isLocalStateEmpty && localTimestamp) headers['If-None-Match'] = localTimestamp;

    try {
        const response = await fetch(`${API_BASE_URL}/api/user-state/${key}`, { method: 'GET', headers });

        if (response.status === 304) {
            console.log(`[DB] State for ${key}: 304 Not Modified.`);
            return { key, status: 304, timestamp: localTimestamp };
        }
        if (!response.ok) {
            console.error(`[DB] HTTP error for ${key}: ${response.status}`);
            return { key, status: response.status };
        }
        const data = await response.json();
        console.log(`[DB] New data received for ${key}.`);

        if (def.type === 'array') {
            // Correctly parse SERVER data into a Set of strings (GUIDs)
            const guidsFromServer = new Set(
                (data.value || []).map(item => item.guid).filter(Boolean)
            );
            
            // FIX: Correctly parse LOCAL data into a Set of strings (GUIDs) for accurate comparison
            const guidsLocally = new Set(
                (value || []).map(item => item.guid).filter(Boolean)
            );

            // Now, the comparison will work correctly as we are comparing strings to strings.
            const guidsToAdd = [...guidsFromServer].filter(guid => !guidsLocally.has(guid));
            const guidsToRemove = [...guidsLocally].filter(guid => !guidsFromServer.has(guid));

            if (guidsToAdd.length > 0 || guidsToRemove.length > 0) {
                 await withDb(async (db) => {
                    const tx = db.transaction(def.store, 'readwrite');
                    const store = tx.objectStore(def.store);
                    for (const guid of guidsToAdd) await store.put({ guid });
                    for (const guid of guidsToRemove) await store.delete(guid);
                    await tx.done;
                });
            }
        } else {
            await saveSimpleState(key, data.value, def.store);
        }
        
        return { key, status: 200, timestamp: data.lastModified };
    } catch (error) {
        console.error(`[DB] Failed to pull ${key}:`, error);
        return { key, status: 'error' };
    }
}

/**
 * Pulls the user state from the server.
 */
export async function pullUserState() {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled');
    if (!isOnline() || !syncEnabled) {
        console.log('[DB] Offline or sync is disabled. Skipping user state pull.');
        return;
    }
    
    if (_isPullingUserState) return console.log('[DB] Already pulling state. Skipping.');
    const now = Date.now();
    if (now - _lastPullAttemptTime < PULL_DEBOUNCE_MS) return console.log('[DB] Debouncing pull.');

    _lastPullAttemptTime = now;
    _isPullingUserState = true;
    console.log('[DB] Pulling user state...');
    let newestOverallTimestamp = null;

    const keysToPull = Object.entries(USER_STATE_DEFS).filter(([key, def]) => !def.localOnly);

    const results = [];
    for (const [key, def] of keysToPull) {
        const result = await _pullSingleStateKey(key, def);
        results.push(result);
    }
    
    for (const result of results) {
        if (result.timestamp && (!newestOverallTimestamp || result.timestamp > newestOverallTimestamp)) {
            newestOverallTimestamp = result.timestamp;
        }
    }

    if (newestOverallTimestamp) await saveSimpleState('lastStateSync', newestOverallTimestamp);

    _isPullingUserState = false;
    console.log('[DB] User state pull completed.');
}

/**
 * Retrieves all items from the feedItems store.
 */
export async function getAllFeedItems() {
    return withDb(async (db) => {
        try {
            const items = await db.getAll('feedItems');
            return items;
        } catch (e) {
            console.error('Failed to get all feed items:', e);
            return [];
        }
    });
}

/**
 * Performs a feed synchronization, fetching new or updated items.
 */
export async function performFeedSync(app) {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled');
    if (!isOnline() || !syncEnabled) {
        return console.log('[DB] Offline or sync is disabled. Skipping feed sync.');
    }
    
    console.log('[DB] Fetching feed items from server.');

    try {
        const { value: lastFeedSyncTime } = await loadSimpleState('lastFeedSync');
        const sinceTimestamp = lastFeedSyncTime || '';
        const guidsResponse = await fetch(`${API_BASE_URL}/api/feed-guids?since=${sinceTimestamp}`);

        if (guidsResponse.status === 304) {
            console.log('[DB] Feed not modified. Skipping update.');
            return;
        }

        if (!guidsResponse.ok) throw new Error(`HTTP error! status: ${guidsResponse.status} for /api/feed-guids`);

        const guidsData = await guidsResponse.json();
        const serverGuids = new Set(guidsData.guids);
        const serverTime = guidsData.serverTime;

        const localItems = await getAllFeedItems();
        const localGuids = new Set(localItems.map(item => item.guid));

        const guidsToFetch = [...serverGuids].filter(guid => !localGuids.has(guid));
        const guidsToDelete = [...localGuids].filter(guid => !serverGuids.has(guid));

        console.log(`[DB] New/updated GUIDs: ${guidsToFetch.length}, Deleting: ${guidsToDelete.length}`);

        if (guidsToFetch.length > 0) {
            const BATCH_SIZE = 50;
            const newItems = [];
            for (let i = 0; i < guidsToFetch.length; i += BATCH_SIZE) {
                const batch = guidsToFetch.slice(i, i + BATCH_SIZE);
                const itemsResponse = await fetch(`${API_BASE_URL}/api/feed-items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ guids: batch })
                });

                if (itemsResponse.ok) {
                    newItems.push(...await itemsResponse.json());
                }
            }
            await withDb(async (db) => {
                const tx = db.transaction('feedItems', 'readwrite');
                for (const item of newItems) {
                    if (item.guid) await tx.store.put(item);
                }
                await tx.done;
            });
        }
        
        if (guidsToDelete.length > 0) {
            await withDb(async (db) => {
                const tx = db.transaction('feedItems', 'readwrite');
                for (const guid of guidsToDelete) {
                    await tx.store.delete(guid);
                }
                await tx.done;
            });
        }

        if (serverTime) await saveSimpleState('lastFeedSync', serverTime);
        if (app?.loadFeedItemsFromDB) await app.loadFeedItemsFromDB();
        if (app?.loadAndDisplayDeck) await app.loadAndDisplayDeck();
        if (app?.updateCounts) app.updateCounts();

    } catch (error) {
        console.error('[DB] Failed to synchronize feed:', error);
    }
}

/**
 * Performs a full synchronization, pulling user state and feed items.
 */
export async function performFullSync(app) {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled');
    if (!isOnline() || !syncEnabled) {
        return;
    }
    
    console.log('[DB] Full sync initiated.');
    try {
        await pullUserState();
        await performFeedSync(app);
    } catch (error) {
        console.error('[DB] Full sync failed:', error);
    }
}