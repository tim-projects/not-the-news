import { withDb } from '../dbCore.ts';
import { getAuthToken } from '../dbAuth.ts';
import { loadSimpleState } from '../dbUserState.ts';
import { _saveSyncMetaState } from './queue.ts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || window.location.origin;

export async function getAllFeedItems(): Promise<any[]> {
    return withDb((db: any) => db.getAll('feedItems'))
        .catch(e => {
            console.error("Failed to get all feed items:", e);
            return [];
        });
}

export async function _fetchItemsInBatches(guids: string[], app: any, total: number, fetchedSoFar: number): Promise<any[]> {
    const BATCH_SIZE = 50;
    const newItems: any[] = [];

    for (let i = 0; i < guids.length; i += BATCH_SIZE) {
        if (!navigator.onLine) {
            console.warn("[DB] Offline mid-sync. Aborting batch fetch.");
            return null as any;
        }

        const batch = guids.slice(i, i + BATCH_SIZE);
        const token = await getAuthToken();
        if (!token) {
            console.warn("[DB] No auth token available for batch fetch.");
            return null as any;
        }

        const itemsResponse = await fetch(`${API_BASE_URL}/api/list`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ guids: batch })
        });

        if (itemsResponse.ok) {
            const fetchedItems = await itemsResponse.json();
            newItems.push(...fetchedItems);
            
            // Update progress
            if (app) {
                const currentCount = fetchedSoFar + newItems.length;
                app.progressMessage = `Fetching feed content... (${currentCount}/${total})`;
            }
        } else {
            console.error(`[DB] Failed to fetch batch. Status: ${itemsResponse.status}`);
            return null as any;
        }
    }
    return newItems;
}

export async function performFeedSync(app: any = null): Promise<boolean> {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled');
    if (!navigator.onLine || !syncEnabled) {
        if (syncEnabled) console.log("[DB] Offline. Skipping feed sync.");
        return true; // Treat as success to avoid error messages
    }

    console.log("[DB] Fetching new feed items from worker (Delta Sync).");
    try {
        const token = await getAuthToken();
        if (!token) {
            console.warn("[DB] No auth token available for feed sync.");
            return false;
        }

        // Get latest timestamp
        let lastTimestamp = 0;
        await withDb(async (db: any) => {
            const items = await db.getAll('feedItems');
            if (items.length > 0) {
                lastTimestamp = Math.max(...items.map((i: any) => i.timestamp || 0));
            }
        });
        console.log(`[DB] Local newest item timestamp: ${lastTimestamp} (${new Date(lastTimestamp).toISOString()})`);

        const response = await fetch(`${API_BASE_URL}/api/refresh`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ since: lastTimestamp })
        });

        if (!response.ok) {
            if (response.status === 429) {
                console.warn("[DB] Sync throttled by server. Backing off.");
                // Update timestamp to avoid immediate retry loop
                const now = Date.now();
                await _saveSyncMetaState('lastFeedSync', now);
                if (app) app.lastFeedSync = now;
                return false;
            }
            const text = await response.text();
            console.error(`[DB] HTTP error ${response.status} for /api/refresh: ${text}`);
            throw new Error(`HTTP error ${response.status} for /api/refresh: ${text}`);
        }

        const data = await response.json();
        const deltaItems = data.items || [];
        console.log(`[DB] Received ${deltaItems.length} new items from worker (Delta).`);

        if (deltaItems.length > 0) {
            const guidsToFetch = deltaItems.map((i: any) => i.guid);
            console.log(`[DB] Fetching full content for ${guidsToFetch.length} delta items...`);
            
            const fullItems = await _fetchItemsInBatches(guidsToFetch, app, guidsToFetch.length, 0);
            
            if (fullItems && fullItems.length > 0) {
                // Deduplicate and merge
                const itemsMap = new Map();
                // We prefer full items, but delta items might have metadata? Usually full items are better.
                fullItems.forEach((item: any) => {
                    if (item.guid) {
                        const key = item.guid.toLowerCase();
                        itemsMap.set(key, { ...item, guid: key });
                    }
                });

                const finalItems = Array.from(itemsMap.values());

                await withDb(async (db: any) => {
                    const tx = db.transaction('feedItems', 'readwrite');
                    const store = tx.objectStore('feedItems');
                    const index = store.index('guid');

                    for (const item of finalItems) {
                        const existingKey = await index.getKey(item.guid);
                        if (existingKey) {
                            await store.put({ ...item, id: existingKey });
                        } else {
                            const newItem = { ...item };
                            delete newItem.id;
                            await store.put(newItem);
                        }
                    }
                    await tx.done;
                });

                // Refresh app state
                if (app) {
                    if (app.loadFeedItemsFromDB) await app.loadFeedItemsFromDB();
                    if (app.loadAndDisplayDeck) await app.loadAndDisplayDeck();
                    if (app.updateCounts) app.updateCounts();
                }
            } else {
                console.warn("[DB] Failed to fetch full content for delta items.");
            }
        }

        const now = Date.now();
        await _saveSyncMetaState('lastFeedSync', now);
        if (app) app.lastFeedSync = now;

        return true;
    } catch (e) {
        console.error("[DB] Failed to synchronize feed from worker:", e);
        return false;
    }
}
