// @filepath: src/js/data/database.js

// @refactor-directive
// Refactor JS: concise, modern, functional, same output.

import { getDb } from './dbCore.js';
export {
    loadSimpleState,
    saveSimpleState,
    loadArrayState,
    saveArrayState,
    USER_STATE_DEFS
} from './dbUserState.js';
export {
    addPendingOperation,
    processPendingOperations,
    queueAndAttemptSyncOperation,
    performFeedSync,
    performFullSync,
    pullUserState,
    getBufferedChangesCount
} from './dbSyncOperations.js';


/**
 * Initializes and returns a singleton database instance.
 * This is a wrapper for `getDb` to maintain backward compatibility.
 * @returns {Promise<IDBPDatabase>} The IndexedDB database instance.
 */
export async function initDb() {
    return getDb();
}

/**
 * Retrieves all items from the 'feedItems' object store.
 * This is a wrapper function to maintain backward compatibility.
 * @returns {Promise<Array<object>>} An array of feed item objects.
 */
export async function getAllFeedItems() {
    const db = await getDb();
    return db.getAll('feedItems');
}