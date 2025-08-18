// dbUserState.js This file contains all logic for managing local user state in the database.

import { withDb } from './dbCore.js';

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
            const value = await db.get(storeName, key);
            return {
                value: value ? value.value : USER_STATE_DEFS[key]?.default || null,
                lastModified: value?.lastModified || null // Return lastModified for sync
            };
        } catch (e) {
            console.error(`Failed to load simple state for key '${key}':`, e);
            return { value: USER_STATE_DEFS[key]?.default || null, lastModified: null };
        }
    });
}

/**
 * Saves a simple key-value state to the specified store.
 * @param {string} key The key to save.
 * @param {any} value The value to save.
 * @param {string} storeName The object store to use (e.g., 'userSettings').
 * @returns {Promise<void>}
 */
export async function saveSimpleState(key, value, storeName = 'userSettings') {
    return withDb(async (db) => {
        try {
            await db.put(storeName, { key, value, lastModified: new Date().toISOString() }); // Add lastModified timestamp
        } catch (e) {
            console.error(`Failed to save simple state for key '${key}':`, e);
        }
    });
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
                console.log(`Migration required for '${storeName}'. Converting string GUIDs to objects.`);
                const timestampKey = getTimestampKey(storeName);
                const now = new Date().toISOString();

                const migratedItems = allItems.map(item => {
                    const guid = typeof item === 'string' ? item : item.guid;
                    return { guid, [timestampKey]: now };
                });

                // Overwrite the store with the newly structured objects
                const tx = db.transaction(storeName, 'readwrite');
                await tx.store.clear();
                for (const item of migratedItems) {
                    await tx.store.put(item); // New IDs will be auto-generated
                }
                await tx.done;

                console.log(`Migration complete for '${storeName}'.`);
                // Re-fetch the data to get the newly assigned IDs
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
 * Note: This requires a 'guid' index on the specified store, which will be defined in dbCore.js.
 * @param {string} storeName The name of the object store.
 * @param {string} guid The GUID to find.
 * @returns {Promise<object|undefined>} The found object (including its auto-incrementing id) or undefined.
 */
export async function findByGuid(storeName, guid) {
    return withDb(async (db) => {
        try {
            // Uses an index for an efficient lookup.
            return await db.getFromIndex(storeName, 'guid', guid);
        } catch (e) {
            console.error(`Error finding item by GUID '${guid}' in store '${storeName}':`, e);
            return undefined;
        }
    });
}

/**
 * Adds or removes a single object from an array-based store.
 * @param {string} storeName The name of the object store.
 * @param {object} item The object to add or remove. Must contain a 'guid' property.
 * @param {boolean} add true to add, false to remove.
 * @returns {Promise<void>}
 */
export async function updateArrayState(storeName, item, add) {
    return withDb(async (db) => {
        try {
            if (!item || !item.guid) {
                console.error("updateArrayState requires an item with a guid property.", item);
                return;
            }

            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);

            if (add) {
                // 'put' adds the new object. The 'id' is auto-generated by IndexedDB.
                await store.put(item);
            } else {
                // To delete, we must find the item by its business key (guid)
                // to get its database primary key (id).
                const index = store.index('guid');
                const existingItem = await index.get(item.guid);

                if (existingItem && typeof existingItem.id !== 'undefined') {
                    // Once we have the primary key (id), we can perform the delete.
                    await store.delete(existingItem.id);
                } else {
                    console.warn(`Attempted to delete item with guid '${item.guid}' but it was not found in '${storeName}'.`);
                }
            }
            await tx.done;
        } catch (e) {
            console.error(`Failed to update array state in store '${storeName}' for guid '${item.guid}':`, e);
        }
    });
}

/**
 * Overwrites an entire store with a new array of objects.
 * @param {string} storeName The name of the object store.
 * @param {Array<object>} objects The array of objects to save into the store.
 * @returns {Promise<void>}
 */
export async function saveArrayState(storeName, objects) {
    return withDb(async (db) => {
        try {
            if (!Array.isArray(objects)) {
                console.error(`saveArrayState expects an array of objects, but received:`, objects);
                return;
            }
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            await store.clear(); // Clear all existing data first.

            // Put each new object into the store. The auto-incrementing 'id' will be generated.
            for (const item of objects) {
                // FIX: Sanitize the object to remove any reactivity/proxies before storing.
                // This prevents the DataCloneError by ensuring we only store plain objects.
                const sanitizedItem = JSON.parse(JSON.stringify(item));
                
                // Defensively remove the 'id' property. Since the store is cleared and
                // we are adding new items, we want to ensure IndexedDB's autoIncrement
                // feature generates a fresh ID for each object.
                delete sanitizedItem.id; 
                
                await store.put(sanitizedItem);
            }
            
            await tx.done;
        } catch (e) {
            console.error(`Failed to save array state to store '${storeName}':`, e);
            // Re-throw the error to make upstream logic aware of the failure.
            throw e;
        }
    });
}