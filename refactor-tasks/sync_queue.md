# Refactor Task: Create `src/js/data/sync/queue.ts`

## Context
Splitting `dbSyncOperations.ts`: Queue management logic.

## Source File
- `src/js/data/dbSyncOperations.ts`

## Target File
- `src/js/data/sync/queue.ts`

## Instructions
1.  **Read `src/js/data/dbSyncOperations.ts`** to locate:
    - `_saveSyncMetaState`
    - `_addPendingOperationToBuffer`
    - `queueAndAttemptSyncOperation`
    - `processPendingOperations`

2.  **Create `src/js/data/sync/queue.ts`**.

3.  **Add Imports**:
    - `import { withDb } from '../dbCore.ts';`
    - `import { getAuthToken } from '../dbAuth.ts';`
    - `import { loadSimpleState } from '../dbUserState.ts';`
    - `import { pullUserState } from './state.ts';` (Circular check needed later)

4.  **Extract and Export Functions**:
    - Copy the functions.
    - Ensure `API_BASE_URL` is defined or imported.

5.  **Verify**: Check for dependencies on `performFeedSync` or others. If `queueAndAttemptSyncOperation` calls `pullUserState`, ensure it's imported.
