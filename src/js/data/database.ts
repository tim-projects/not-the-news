// @filepath: src/js/data/database.js

// This file acts as a central point for re-exporting all
// database-related functions, simplifying imports for the rest of the application.

export { initDb, withDb } from './dbCore.ts';
export * from './dbUserState.ts';
export * from './dbSyncOperations.ts';

// An additional utility function re-exported for convenience
import { getAllFeedItems } from './dbSyncOperations.ts';
export { getAllFeedItems };
