# Refactor Task: Create `src/js/data/sync/state.ts`

## Context
Splitting `dbSyncOperations.ts`: User state synchronization.

## Source File
- `src/js/data/dbSyncOperations.ts`

## Target File
- `src/js/data/sync/state.ts`

## Instructions
1.  **Read `src/js/data/dbSyncOperations.ts`** to locate:
    - `_pullSingleStateKey`
    - `pullUserState`
    - `performFullSync`

2.  **Create `src/js/data/sync/state.ts`**.

3.  **Add Imports**:
    - `import { withDb } from '../dbCore.ts';`
    - `import { getAuthToken } from '../dbAuth.ts';`
    - `import { loadSimpleState, USER_STATE_DEFS } from '../dbUserState.ts';`
    - `import { _saveSyncMetaState, processPendingOperations } from './queue.ts';`
    - `import { performFeedSync } from './feed.ts';`

4.  **Extract and Export Functions**:
    - Copy the functions.
    - Ensure `API_BASE_URL` is defined or imported.

5.  **Refactor**: `performFullSync` orchestrates everything. Ensure imports are correct.
