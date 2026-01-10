# Codebase Refactoring Plan

## Goal
Restructure the project to ensure no file exceeds 500 lines of code. The refactoring will focus on modularity, separation of concerns, and ease of navigation for both human developers and AI agents.

## Current High-Priority Targets
1.  **`src/main.ts`** (2468 lines) - The monolithic Alpine.js application logic.
2.  **`worker/src/index.ts`** (876 lines) - The Cloudflare Worker entry point handling all API routes and cron jobs.
3.  **`src/js/data/dbSyncOperations.ts`** (734 lines) - Complex synchronization logic for feeds and user state.

---

## 1. Frontend Structure (`src/`)

The `src/main.ts` file currently acts as a "God Object" for the Alpine.js component. We will break it down into functional controllers and managers.

### New Directory Structure
```
src/
├── main.ts (Entry point: assembles the AppState object)
├── types/
│   └── app.ts (AppState interface)
├── js/
│   ├── core/              # Core application lifecycle
│   │   ├── appInit.ts     # initApp logic, startup sequences
│   │   └── auth.ts        # logout, deleteAccount, password changes
│   ├── controllers/       # Business logic modules
│   │   ├── deck.ts        # loadAndDisplayDeck, processShuffle, pregenerateDecks
│   │   ├── feed.ts        # loadFeedItemsFromDB, saveRssFeeds, discovery
│   │   └── interaction.ts # toggleRead, toggleStar, selectItem, handleEntryLinks
│   ├── ui/                # UI-specific logic
│   │   ├── theme.ts       # Themes, fonts, CSS adjustments
│   │   ├── overlays.ts    # Modals, settings panels, search
│   │   └── observers.ts   # Scroll, image, and stale item observers
│   ├── data/              # Data layer (Refactored)
│   │   ├── db.ts          # Core DB connection (dbCore.ts)
│   │   ├── user.ts        # User state persistence (dbUserState.ts)
│   │   └── sync/          # Split from dbSyncOperations.ts
│   │       ├── index.ts   # Main sync entry points
│   │       ├── queue.ts   # Pending operations queue logic
│   │       ├── feed.ts    # Feed fetching and delta sync
│   │       └── state.ts   # User profile/state sync
│   └── helpers/           # Pure utility functions (keep existing, split if needed)
```

### Refactoring Strategy for `src/main.ts`
The `rssApp` function will import methods from these modules and spread them into the return object.
**Pattern:**
```typescript
import { toggleRead, toggleStar } from './js/controllers/interaction.ts';
import { applyThemeStyle } from './js/ui/theme.ts';

export function rssApp(): AppState {
    return {
        // ... state properties ...
        
        // Methods imported from modules
        toggleRead,
        toggleStar,
        applyThemeStyle,
        
        // ...
    };
}
```
*Note: Functions in modules will define `this: AppState` as their first parameter to access the state.*

---

## 2. Worker Structure (`worker/src/`)

The worker handles routing, authentication, and data fetching. We will separate these concerns.

### New Directory Structure
```
worker/src/
├── index.ts (Entry point: minimal request dispatching)
├── config.ts (Env interface and constants)
├── router.ts (URL routing logic)
├── middleware/
│   └── auth.ts (verifyFirebaseToken, getGoogleAccessToken)
├── handlers/
│   ├── api.ts (General API endpoints: /time, /keys)
│   ├── feed.ts (/api/refresh, /api/list, /api/lookup)
│   └── user.ts (/api/profile, /api/user-state)
├── services/
│   ├── storage.ts (The Storage class for KV/R2/D1 abstraction)
│   ├── feedFetcher.ts (Fetching and parsing RSS)
│   └── demoDeck.ts (Demo mode generation logic)
└── utils/
    └── response.ts (Helper for JSON responses)
```

### Refactoring Strategy for `worker/src/index.ts`
1.  Move `Storage` class to `services/storage.ts`.
2.  Move `fetch` handler logic into `router.ts`.
3.  Split the massive `if/else` routing block into dedicated handler functions in `handlers/`.
4.  Move cron job logic (`scheduled`) to a function in `handlers/cron.ts` or `services/feedFetcher.ts`.

---

## 3. Data Sync Refactoring (`src/js/data/`)

`dbSyncOperations.ts` mixes queue management, network requests, and complex merging logic.

### Splits
1.  **`src/js/data/sync/queue.ts`**: `queueAndAttemptSyncOperation`, `_addPendingOperationToBuffer`, `processPendingOperations` (queue processing logic).
2.  **`src/js/data/sync/feed.ts`**: `performFeedSync`, `_fetchItemsInBatches`.
3.  **`src/js/data/sync/state.ts`**: `pullUserState`, `_pullSingleStateKey`, `performFullSync`.

---

## Execution Steps

1.  **Setup**: Create the new folder structure.
2.  **Helpers & Utilities**: Move pure utility functions first (lowest risk).
3.  **Data Layer**: Refactor `dbSyncOperations` into `src/js/data/sync/`. Verify tests pass.
4.  **Worker**: Refactor `worker/src/index.ts` into handlers and services. Deploy to dev to verify API.
5.  **Frontend Logic**: Split `src/main.ts` one module at a time, starting with `ui/theme.ts` (least dependencies), then `controllers/interaction.ts`, and finally `core/appInit.ts`.
6.  **Cleanup**: Remove the original large files and update imports.

## Verification
After each major move (e.g., splitting `dbSyncOperations`), run the full test suite (`npm test`) and perform a manual sanity check on the dev environment (`dev-news`).
