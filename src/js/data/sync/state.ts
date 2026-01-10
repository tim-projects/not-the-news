import { withDb } from '../dbCore.ts';
import { getAuthToken } from '../dbAuth.ts';
import { loadSimpleState, loadArrayState, USER_STATE_DEFS } from '../dbUserState.ts';
import { _saveSyncMetaState, processPendingOperations } from './queue.ts';
import { performFeedSync } from './feed.ts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || window.location.origin;

// Flag to prevent overlapping pulls
let _isPullingUserState = false;
let _lastPullTime = 0;
const PULL_COOLDOWN_MS = 500;

async function _pullSingleStateKey(key: string, def: any, force: boolean = false): Promise<any> {
    // Check if we have pending operations for this key
    if (!force) {
        const pendingOps = await withDb(db => db.getAll('pendingOperations')).catch(() => []);
        const hasPending = pendingOps.some((op: any) => 
            op.key === key || 
            (op.type === 'starDelta' && key === 'starred') ||
            (op.type === 'readDelta' && key === 'read') ||
            (op.type === 'simpleUpdate' && op.key === 'currentDeckGuids')
        );
        
        if (hasPending) {
            console.log(`[DB] Skipping pull for '${key}' because local changes are pending synchronization.`);
            return { key, status: 'skipped_pending' };
        }
    }

    const { value: localData, lastModified } = def.type === 'array' 
        ? await loadArrayState(def.store) 
        : await loadSimpleState(key, def.store);
    
    const ifNoneMatch = lastModified || '';
    const token = await getAuthToken();
    
    if (!token) {
        console.warn(`[DB] No auth token available for ${key}, skipping pull.`);
        return { key, status: 'no_token' };
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    if (ifNoneMatch && !force) {
        headers['If-None-Match'] = ifNoneMatch;
    }

    // Optimization: For mergeable arrays (read/starred), send 'since' param to get delta
    let queryParams = '';
    if (def.type === 'array' && (def.syncMode || 'merge') === 'merge' && !force && Array.isArray(localData)) {
        // Find latest timestamp in local data
        const timeField = key === 'read' ? 'readAt' : (key === 'starred' ? 'starredAt' : 'timestamp');
        const maxTime = localData.reduce((max: number, item: any) => {
            const ts = new Date(item[timeField] || item.timestamp || 0).getTime();
            return ts > max ? ts : max;
        }, 0);
        
        if (maxTime > 0) {
            queryParams = `?since=${new Date(maxTime).toISOString()}`;
        }
    }

    let retries = 2;
    while (retries >= 0) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(`${API_BASE_URL}/api/profile/${key}${queryParams}`, {
                method: 'GET',
                headers: headers,
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (response.status === 304 && !force) {
                // Not Modified
                return { key, status: 304, timestamp: lastModified };
            }

            if (!response.ok) {
                const text = await response.text();
                console.error(`[DB] HTTP error for ${key}: ${response.status} - ${text}`);
                return { key, status: response.status };
            }

            const data = await response.json();
            const isPartial = data.partial === true;
            
            if (isPartial) {
                console.log(`[DB Sync] Received partial delta for ${key}.`);
            } else {
                console.log(`[DB Sync] Received full data for ${key}:`, data.value);
            }

            if (def.type === 'array') {
                const serverObjects = data.value || [];
                const localObjects = localData || [];

                if ((def.syncMode || 'merge') === 'replace' || force) {
                    console.log(`[DB Sync] Replacing local '${key}' with server snapshot.`);
                    await withDb(async (db) => {
                        const tx = db.transaction(def.store, 'readwrite');
                        await tx.store.clear();
                        for (const item of serverObjects) {
                            if (typeof item === 'object' && item !== null && typeof item.guid === 'string' && item.guid.trim()) {
                                const copy = { ...item };
                                if (copy.id) delete copy.id;
                                await tx.store.put(copy);
                            } else {
                                console.warn(`[DB Sync] Filtered out invalid item during ${key} replace:`, item);
                            }
                        }
                        await tx.done;
                    });
                } else {
                    // Merge strategy
                    const localGuids = new Set(localObjects.map((item: any) => item.guid));
                    const serverGuids = new Set(serverObjects.map((item: any) => item.guid));
                    
                    const objectsToAdd = serverObjects.filter((item: any) => !localGuids.has(item.guid));
                    
                    // Deduplicate adds (server list might have dupes if not sanitized)
                    const uniqueAdds = Array.from(objectsToAdd.reduce((map: Map<string, any>, item: any) => {
                        if (item.guid) {
                            const g = item.guid.toLowerCase();
                            map.set(g, { ...item, guid: g });
                        }
                        return map;
                    }, new Map()).values());

                    const objectsToRemove = isPartial ? [] : localObjects.filter((item: any) => !serverGuids.has(item.guid));

                    if (uniqueAdds.length > 0 || objectsToRemove.length > 0) {
                        console.log(`[DB Sync] Merging '${key}': ${uniqueAdds.length} added, ${objectsToRemove.length} removed.`);
                        await withDb(async (db) => {
                            const tx = db.transaction(def.store, 'readwrite');
                            const store = tx.objectStore(def.store);
                            const index = store.index('guid');

                            // Add new items
                            for (const item of uniqueAdds) {
                                // Double check inside transaction
                                const existingKey = await index.getKey((item as any).guid);
                                if (existingKey) {
                                    await store.put({ ...item, id: existingKey });
                                } else {
                                    const copy = { ...item };
                                    delete copy.id;
                                    await store.put(copy);
                                }
                            }

                            // Remove deleted items
                            for (const item of objectsToRemove) {
                                if (item.id !== undefined) {
                                    await store.delete(item.id);
                                }
                            }
                            await tx.done;
                        });
                    }
                }
            } else {
                // Simple state
                await _saveSyncMetaState(key, data.value, data.lastModified);
            }

            return { key, status: 200, timestamp: data.lastModified };

        } catch (e: any) {
            const isTimeout = e.name === 'AbortError';
            if (retries > 0) {
                console.warn(`[DB] Pull failed for ${key} (${isTimeout ? 'Timeout' : e.message}), retrying... (${retries} left)`);
                retries--;
                await new Promise(r => setTimeout(r, (2 - retries) * 1000)); // Backoff
                continue;
            }
            console.error(`[DB] Failed to pull ${key} after retries:`, e);
            return { key, status: 'error' };
        }
    }
    return { key, status: 'error' };
}

export async function pullUserState(force: boolean = false, skipKeys: string[] = [], app: any = null): Promise<void> {
    if (!navigator.onLine) return;

    let { value: syncEnabled } = await loadSimpleState('syncEnabled');
    if (!syncEnabled && !force) {
        // Double check remote status if local says disabled (maybe new device)
        console.log('[DB] Sync is disabled locally. Checking for remote status...');
        const syncEnabledDef = USER_STATE_DEFS['syncEnabled'];
        const result = await _pullSingleStateKey('syncEnabled', syncEnabledDef, false);
        if (result.status === 200) {
            const state = await loadSimpleState('syncEnabled');
            syncEnabled = state.value;
        }
    }

    if ((!syncEnabled && !force) || (_isPullingUserState && !force)) return;

    const now = Date.now();
    if (!force && (now - _lastPullTime < PULL_COOLDOWN_MS)) {
        return; // Debounce
    }
    
    _lastPullTime = now;
    _isPullingUserState = true;
    console.log(`[DB] Pulling user state (force=${force}, skip=${skipKeys.join(',')})...`);

    try {
        let keysToPull = [...skipKeys];
        
        // --- Special Theme Check ---
        const localTheme = localStorage.getItem('theme');
        if (skipKeys.length > 0 && !force && localTheme) {
            // If we are skipping (e.g. initial load), check theme consistency first.
            // If server theme differs from local, we shouldn't skip.
            console.log('[DB Sync] Verifying theme consistency before deferring heavy keys...');
            const themeDef = USER_STATE_DEFS['theme'];
            const res = await _pullSingleStateKey('theme', themeDef, false);
            if (res.status === 200) {
                const { value: serverTheme } = await loadSimpleState('theme');
                if (serverTheme !== localTheme) {
                    console.log(`[DB Sync] Theme mismatch detected (Local: ${localTheme}, Server: ${serverTheme}). Aborting skip and pulling all state.`);
                    keysToPull = [];
                } else {
                    console.log('[DB Sync] Theme is consistent, proceeding with deferred sync.');
                }
            }
        }

        const defs = Object.entries(USER_STATE_DEFS)
            .filter(([key, def]: [string, any]) => !def.localOnly && key !== 'syncEnabled' && !keysToPull.includes(key));

        const promises = defs.map(([key, def]) => _pullSingleStateKey(key, def, force));
        
        const results = await Promise.allSettled(promises);
        
        // Find latest timestamp
        const timestamps = results
            .filter(r => r.status === 'fulfilled')
            .map(r => (r as PromiseFulfilledResult<any>).value)
            .reduce((max: string, res: any) => {
                if (res?.timestamp && res.timestamp > max) return res.timestamp;
                return max;
            }, '');

        if (timestamps) {
            await _saveSyncMetaState('lastStateSync', timestamps);
        }

        // Trigger UI update if provided
        if (app && app.loadFeedItemsFromDB) {
            console.log('[DB Sync] State pull complete, triggering app data reload.');
            // Small delay to let DB writes settle
            setTimeout(() => {
                if (app._loadAndManageAllData) {
                    app._loadAndManageAllData(); // Reload deck/state
                }
            }, 100);
        }

    } catch (e) {
        console.error('[DB] User state pull failed:', e);
    } finally {
        _isPullingUserState = false;
        console.log('[DB] User state pull completed.');
    }
}

export async function performFullSync(app: any): Promise<boolean> {
    if (!navigator.onLine) {
        console.log("[DB] Skipping full sync: Offline.");
        return true;
    }
    const { value: syncEnabled } = await loadSimpleState('syncEnabled');
    if (!syncEnabled) return true;

    console.log("[DB] Full sync initiated.");
    try {
        await processPendingOperations(app);
        await pullUserState(false, [], app);
        await performFeedSync(app);
        return true;
    } catch (e) {
        console.error("[DB] Full sync failed:", e);
        return false;
    }
}
