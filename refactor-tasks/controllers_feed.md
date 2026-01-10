# Refactor Task: Create `src/js/controllers/feed.ts`

## Context
Extracting feed configuration and loading logic.

## Source File
- `src/main.ts`

## Target File
- `src/js/controllers/feed.ts`

## Instructions
1.  **Read `src/main.ts`** to locate:
    - `loadFeedItemsFromDB`
    - `filteredEntries` (This is a getter in Alpine. We might need to export a function `getFilteredEntries(app)` or keep it in main if it relies heavily on reactive state access patterns. Let's make it a function `computeFilteredEntries(app)`).
    - `loadRssFeeds`
    - `saveRssFeeds`
    - `loadKeywordBlacklist`
    - `saveKeywordBlacklist`
    - `discoverFeed`

2.  **Create `src/js/controllers/feed.ts`**.

3.  **Add Imports**:
    - `import { AppState } from '@/types/app.ts';`
    - `import { getAllFeedItems } from '../data/sync/feed.ts';` (Refactored path)
    - `import { mapRawItems, parseRssFeedsConfig, formatDate } from '../helpers/dataUtils.ts';`
    - `import { loadSimpleState, saveSimpleState } from '../data/dbUserState.ts';`
    - `import { createStatusBarMessage } from '../ui/uiUpdaters.ts';`
    - `import { performFullSync } from '../data/sync/state.ts';` (Refactored path)
    - `import { manageDailyDeck } from '../helpers/deckManager.ts';`
    - `import { discoverFeed as helperDiscover } from '../helpers/discoveryManager.ts';`

4.  **Extract and Export Functions**:
    - `loadFeedItemsFromDB(app: AppState)`
    - `computeFilteredEntries(app: AppState)`: Logic from the getter.
    - `loadRssFeeds(app: AppState)`
    - `saveRssFeeds(app: AppState)`
    - `loadKeywordBlacklist(app: AppState)`
    - `saveKeywordBlacklist(app: AppState)`
    - `discoverFeed(app: AppState)`

5.  **Refactor**: Replace `this` with `app`.
