// @filepath: src/js/data/database.js

// Refactored JS: concise, modern, functional, same output.

// This file acts as a central point for re-exporting all
// database-related functions, simplifying imports for the rest of the application.

import { getDb } from './dbCore.js';

// Re-export a backward-compatible alias for getDb().
export { getDb as initDb } from './dbCore.js';

// Re-export all public functions from the dbUserState module.
export * from './dbUserState.js';

// Re-export all public functions from the dbSyncOperations module.
export * from './dbSyncOperations.js';

/**
 * Retrieves all items from the 'feedItems' object store.
 * This is a high-level, store-specific access method that wraps a common database operation.
 * @returns {Promise<Array<object>>} An array of feed item objects.
 */
export async function getAllFeedItems() {
    const db = await getDb();
    return db.getAll('feedItems');
}