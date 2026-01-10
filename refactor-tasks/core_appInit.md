# Refactor Task: Create `src/js/core/appInit.ts`

## Context
Extracting the massive initialization logic.

## Source File
- `src/main.ts`

## Target File
- `src/js/core/appInit.ts`

## Instructions
1.  **Read `src/main.ts`** to locate:
    - `initApp`
    - `_loadInitialState`
    - `_loadAndManageAllData`
    - `_setupWatchers`
    - `_setupEventListeners`
    - `_startPeriodicSync`
    - `_startWorkerFeedSync`

2.  **Create `src/js/core/appInit.ts`**.

3.  **Add Imports**:
    - `import { AppState } from '@/types/app.ts';`
    - `import { initDb } from '../data/dbCore.ts';`
    - `import { loadSimpleState, loadArrayState, loadCurrentDeck, loadShuffleState } from '../data/dbUserState.ts';`
    - `import { manageDailyDeck } from '../helpers/deckManager.ts';`
    - `import { performFeedSync } from '../data/sync/feed.ts';`
    - `import { processPendingOperations } from '../data/sync/queue.ts';`
    - `import { pullUserState } from '../data/sync/state.ts';`
    - `import { loadAndDisplayDeck } from '../controllers/deck.ts';`
    - `import { loadFeedItemsFromDB, computeFilteredEntries } from '../controllers/feed.ts';`
    - `import { initSyncToggle, initImagesToggle, etc } from '../ui/uiInitializers.ts';` (Check exact exports)
    - `import { handleKeyboardShortcuts } from '../helpers/keyboardManager.ts';`

4.  **Extract and Export Functions**:
    - `initApp(app: AppState)`
    - `_loadInitialState(app: AppState)`
    - `_loadAndManageAllData(app: AppState, skipLoad: boolean)`
    - `_setupWatchers(app: AppState)`
    - `_setupEventListeners(app: AppState)`
    - `_startPeriodicSync(app: AppState)`
    - `_startWorkerFeedSync(app: AppState)`

5.  **Refactor**: Replace `this` with `app`.
