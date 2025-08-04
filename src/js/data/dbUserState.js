// @filepath: src/js/data/dbUserState.js

// This file contains all logic for managing local user state in the database.

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

/**
 * Loads all items from a store that is expected to be an array.
 * @param {string} storeName The name of the object store.
 * @returns {Promise<{value: Array<any>}>} An object containing the array of items.
 */
export async function loadArrayState(storeName) {
    return withDb(async (db) => {
        try {
            const allItems = await db.getAll(storeName);
            // This is the key change: map the objects to just their GUIDs
            const guids = allItems.map(item => item.guid);
            return { value: guids || USER_STATE_DEFS[storeName]?.default || [] };
        } catch (e) {
            console.error(`Failed to load array state from store '${storeName}':`, e);
            return { value: USER_STATE_DEFS[storeName]?.default || [] };
        }
    });
}

/**
 * Puts an array of items (assumed to be GUIDs) into a store, overwriting existing data.
 * @param {string} storeName The name of the object store.
 * @param {Array<string>} guids The array of GUIDs to put into the store.
 * @returns {Promise<void>}
 */
export async function saveArrayState(storeName, guids) {
    return withDb(async (db) => {
        try {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            await store.clear();
            
            // This is the key change: map the GUIDs to objects before adding
            const objectsToSave = guids.map(guid => ({ guid: guid }));
            
            await Promise.all(objectsToSave.map(item => store.put(item)));
            await tx.done;
        } catch (e) {
            console.error(`Failed to save array state to store '${storeName}':`, e);
        }
    });
}