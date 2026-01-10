# Refactor Task: Create `src/js/controllers/deck.ts`

## Context
Extracting deck management and display logic.

## Source File
- `src/main.ts`

## Target File
- `src/js/controllers/deck.ts`

## Instructions
1.  **Read `src/main.ts`** to locate:
    - `loadAndDisplayDeck`
    - `processShuffle`
    - `pregenerateDecks`
    - `_generateAndSavePregeneratedDeck`
    - `loadDemoDeck`

2.  **Create `src/js/controllers/deck.ts`**.

3.  **Add Imports**:
    - `import { AppState } from '@/types/app.ts';`
    - `import { mapRawItem } from '../helpers/dataUtils.ts';`
    - `import { formatDate } from '../helpers/dataUtils.ts';`
    - `import { _fetchItemsInBatches } from '../data/sync/feed.ts';` (Refactored path)
    - `import { withDb } from '../data/dbCore.ts';`
    - `import { generateNewDeck, processShuffle as helperProcessShuffle } from '../helpers/deckManager.ts';` (Renamed to avoid conflict)
    - `import { saveSimpleState } from '../data/dbUserState.ts';`
    - `import { displayTemporaryMessageInTitle, updateCounts } from '../ui/uiUpdaters.ts';`

4.  **Extract and Export Functions**:
    - `loadAndDisplayDeck(app: AppState)`
    - `processShuffle(app: AppState)`
    - `pregenerateDecks(app: AppState)`
    - `_generateAndSavePregeneratedDeck(app: AppState, isOnline: boolean)`
    - `loadDemoDeck(app: AppState)`

5.  **Refactor**: Replace `this` with `app`.
