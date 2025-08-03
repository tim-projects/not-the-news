// @filepath: src/js/data/database.js

// This file acts as a central point for re-exporting all
// database-related functions, simplifying imports for the rest of the application.

export { initDb, withDb } from './dbCore.js';
export * from './dbUserState.js';
export * from './dbSyncOperations.js';

// An additional utility function re-exported for convenience
import { getAllFeedItems } from './dbSyncOperations.js';
export { getAllFeedItems };
