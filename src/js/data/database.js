// @filepath: src/js/data/database.js

// @refactor-directive
// Refactor JS: concise, modern, functional, same output.

// This file acts as the public API for all database-related operations.
// It re-exports functions from other modules to provide a single, consistent interface.

export { initDb, getDb, getAllFeedItems } from './dbCore.js';
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