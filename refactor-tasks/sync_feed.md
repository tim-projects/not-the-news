# Refactor Task: Create `src/js/data/sync/feed.ts`

## Context
Splitting `dbSyncOperations.ts`: Feed fetching logic.

## Source File
- `src/js/data/dbSyncOperations.ts`

## Target File
- `src/js/data/sync/feed.ts`

## Instructions
1.  **Read `src/js/data/dbSyncOperations.ts`** to locate:
    - `getAllFeedItems`
    - `_fetchItemsInBatches`
    - `performFeedSync`

2.  **Create `src/js/data/sync/feed.ts`**.

3.  **Add Imports**:
    - `import { withDb } from '../dbCore.ts';`
    - `import { getAuthToken } from '../dbAuth.ts';`
    - `import { loadSimpleState } from '../dbUserState.ts';`
    - `import { _saveSyncMetaState } from './queue.ts';`

4.  **Extract and Export Functions**:
    - Copy the functions.
    - Ensure `API_BASE_URL` is defined or imported.

5.  **Refactor**: `performFeedSync` often updates `app` state. Ensure it accepts `app: AppState` as an optional argument.
