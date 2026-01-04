# FUNCTIONS-MAP.md

This document maps the project's codebase to help identify large files and plan refactoring. The goal is to keep files under 300 lines of code.

## Summary of Large Files (> 300 lines)
- **`src/main.ts`** (2083 lines) - **CRITICAL**
- **`worker/src/index.ts`** (~460 lines) - **CRITICAL**
- **`src/js/data/dbSyncOperations.ts`** (~450 lines) - **CRITICAL**
- **`src/js/helpers/dataUtils.ts`** (~350 lines)
- **`src/js/helpers/keyboardManager.ts`** (~320 lines)

---

## Directory: `src/`

### `src/main.ts` (!!! EXCEEDS 300 LINES !!!)
- **Total Lines:** 2083
- **Functions (Methods in `rssApp`):**
  - `initApp`: ~120 lines
  - `performBackgroundSync`: ~25 lines
  - `updateSyncStatusMessage`: ~15 lines
  - `logout`: ~10 lines
  - `changePassword`: ~5 lines
  - `submitPasswordChange`: ~20 lines
  - `deleteAccount`: ~35 lines
  - `loadAndDisplayDeck`: ~55 lines
  - `loadFeedItemsFromDB`: ~20 lines
  - `filteredEntries` (getter): ~65 lines
  - `toggleStar`: ~15 lines
  - `toggleRead`: ~160 lines
  - `undoMarkRead`: ~25 lines
  - `selectItem`: ~15 lines
  - `processShuffle`: ~10 lines
  - `loadRssFeeds`: ~10 lines
  - `loadKeywordBlacklist`: ~10 lines
  - `loadCustomCss`: ~10 lines
  - `saveRssFeeds`: ~85 lines
  - `saveKeywordBlacklist`: ~15 lines
  - `saveCustomCss`: ~10 lines
  - `resetCustomCss`: ~10 lines
  - `generateCustomCssTemplate`: ~15 lines
  - `applyCustomCss`: ~10 lines
  - `loadThemeStyle`: ~20 lines
  - `updateThemeAndStyle`: ~30 lines
  - `saveThemeStyle`: ~15 lines
  - `applyThemeStyle`: ~15 lines
  - `loadFontSize`: ~10 lines
  - `saveFontSize`: ~10 lines
  - `applyFontSize`: ~5 lines
  - `loadFeedWidth`: ~10 lines
  - `saveFeedWidth`: ~10 lines
  - `applyFeedWidth`: ~5 lines
  - `updateCounts`: ~5 lines
  - `scrollToTop`: ~5 lines
  - `observeImage`: ~5 lines
  - `_initImageObserver`: ~20 lines
  - `resetApplicationData`: ~110 lines
  - `backupConfig`: ~90 lines
  - `restoreConfig`: ~60 lines
  - `confirmRestore`: ~90 lines
  - `_loadInitialState`: ~70 lines
  - `_loadAndManageAllData`: ~110 lines
  - `updateAllUI`: ~5 lines
  - `_reconcileAndRefreshUI`: ~15 lines
  - `_initObservers`: ~15 lines
  - `_setupWatchers`: ~160 lines
  - `_setupEventListeners`: ~60 lines
  - `_setupFlickToSelectListeners`: ~110 lines
  - `_startPeriodicSync`: ~35 lines
  - `_startWorkerFeedSync`: ~45 lines
  - `_initScrollObserver`: ~30 lines
  - `handleEntryLinks`: ~15 lines
  - `toggleSearch`: ~5 lines
  - `discoverFeed`: ~5 lines
  - `preloadThemes`: ~35 lines
  - `pregenerateDecks`: ~20 lines
  - `_generateAndSavePregeneratedDeck`: ~35 lines

### `src/sw.ts`
- **Total Lines:** ~110
- **Functions:**
  - `handler` (async): ~12 lines
  - `registerRoute` (anonymous callbacks): ~10-30 lines each

---

## Directory: `src/js/`

### `src/js/login.ts`
- **Total Lines:** ~160
- **Functions:**
  - `showMessage`: ~10 lines
  - `clearMessage`: ~7 lines
  - `onAuthStateChanged` (callback): ~10 lines
  - `forgotPwLink` (event listener): ~20 lines
  - `loginForm` (event listener): ~60 lines
  - `signupBtn` (event listener): ~20 lines
  - `googleBtn` (event listener): ~15 lines

---

## Directory: `src/js/data/`

### `src/js/data/dbSyncOperations.ts` (!!! EXCEEDS 300 LINES !!!)
- **Total Lines:** ~450
- **Functions:**
  - `_saveSyncMetaState`: ~12 lines
  - `_addPendingOperationToBuffer`: ~18 lines
  - `queueAndAttemptSyncOperation`: ~65 lines
  - `processPendingOperations`: ~75 lines
  - `_pullSingleStateKey`: ~110 lines
  - `pullUserState`: ~65 lines
  - `getAllFeedItems`: ~10 lines
  - `_fetchItemsInBatches`: ~45 lines
  - `performFeedSync`: ~65 lines
  - `performFullSync`: ~20 lines

### `src/js/data/dbCore.ts`
- **Total Lines:** ~110
- **Functions:**
  - `getDb`: ~50 lines
  - `closeDb`: ~10 lines
  - `withDb`: ~5 lines

### `src/js/data/dbStateDefs.ts`
- **Total Lines:** ~110
- **Functions:**
  - `loadSimpleState`: ~15 lines
  - `loadArrayState`: ~40 lines
  - `getTimestampKey`: ~8 lines

### `src/js/data/dbUserState.ts`
- **Total Lines:** ~194
- **Functions:**
  - `saveSimpleState`: ~15 lines
  - `findByGuid`: ~5 lines
  - `updateArrayState`: ~30 lines
  - `overwriteArrayAndSyncChanges`: ~40 lines
  - `pruneStaleReadItems`: ~30 lines
  - `saveArrayState`: ~15 lines

### `src/js/data/dbAuth.ts`
- **Total Lines:** ~25
- **Functions:**
  - `getAuthToken`: ~20 lines

---

## Directory: `src/js/helpers/`

### `src/js/helpers/dataUtils.ts` (!!! EXCEEDS 300 LINES !!!)
- **Total Lines:** ~350
- **Functions:**
  - `formatDate`: ~20 lines
  - `shuffleArray`: ~5 lines
  - `parseRssFeedsConfig`: ~30 lines
  - `mapRawItem`: ~40 lines
  - `mapRawItems`: ~15 lines
  - `generateNewDeck`: ~180 lines (Candidate for splitting)

### `src/js/helpers/keyboardManager.ts` (!!! EXCEEDS 300 LINES !!!)
- **Total Lines:** ~320
- **Functions:**
  - `handleVerticalNavigation`: ~20 lines
  - `handleKeyboardShortcuts`: ~230 lines (Complex switch statement)
  - `moveSelection`: ~25 lines
  - `scrollSelectedIntoView`: ~20 lines

### `src/js/helpers/deckManager.ts`
- **Total Lines:** ~180
- **Functions:**
  - `getGuid`: ~5 lines
  - `manageDailyDeck`: ~100 lines
  - `processShuffle`: ~60 lines

### `src/js/helpers/ttsManager.ts`
- **Total Lines:** ~130
- **Functions:**
  - `getCleanText`: ~5 lines
  - `wrapWordsInSpans`: ~25 lines
  - `speakItem`: ~75 lines
  - `stopSpeech`: ~10 lines
  - `finalizeSpeech`: ~10 lines

### `src/js/helpers/userStateUtils.ts`
- **Total Lines:** ~160
- **Functions:**
  - `sanitizeForIndexedDB`: ~20 lines
  - `toggleItemStateAndSync`: ~35 lines
  - `pruneStaleRead`: ~25 lines
  - `loadAndPruneReadItems`: ~35 lines
  - `loadCurrentDeck`: ~15 lines
  - `saveCurrentDeck`: ~20 lines

### `src/js/helpers/apiUtils.ts`
- **Total Lines:** ~100
- **Functions:**
  - `getAuthToken`, `handleResponse`, `buildConfigUrl`: ~20 lines total
  - `loadConfigFile`, `saveConfigFile`: ~15 lines total
  - `loadUserState`, `saveUserState`: ~25 lines total

### `src/js/helpers/discoveryManager.ts`
- **Total Lines:** ~30
- **Functions:**
  - `discoverFeedFromUrl`: ~10 lines
  - `discoverFeed`: ~20 lines

### `src/js/helpers/searchManager.ts`
- **Total Lines:** ~40
- **Functions:**
  - `filterEntriesByQuery`: ~15 lines
  - `toggleSearch`: ~15 lines

---

## Directory: `src/js/ui/`

### `src/js/ui/uiUpdaters.ts`
- **Total Lines:** ~250
- **Functions:**
  - `splitMessageIntoLines`: ~15 lines
  - `displayTemporaryMessageInTitle`: ~25 lines
  - `createStatusBarMessage`: ~25 lines
  - `showUndoNotification`: ~35 lines
  - `manageSettingsPanelVisibility`: ~50 lines
  - `updateCounts`, `scrollToTop`, `setKeyboardScrolling`: ~20 lines total
  - `attachScrollToTopHandler`: ~25 lines
  - `saveCurrentScrollPosition`: ~20 lines

### `src/js/ui/uiInitializers.ts`
- **Total Lines:** ~140
- **Functions:**
  - `setupBooleanToggle`: ~20 lines
  - `initSyncToggle`, `initImagesToggle`, etc.: ~50 lines total
  - `initScrollPosition`: ~25 lines
  - PWA logic: ~20 lines

### `src/js/ui/uiElements.ts`
- **Total Lines:** ~40
- **Functions:**
  - Collection of ~20 one-line getter functions.

---

## Directory: `worker/src/`

### `worker/src/index.ts` (!!! EXCEEDS 300 LINES !!!)
- **Total Lines:** ~460
- **Functions:**
  - `getGoogleAccessToken`: ~40 lines
  - `Storage` (class): ~100 lines
  - `verifyFirebaseToken`: ~10 lines
  - `syncFeeds`: ~50 lines
  - `discoverFeeds`: ~40 lines
  - `default.fetch` (Request Handler): ~150 lines (Complex switch/routing)

### `worker/src/rss.ts`
- **Total Lines:** ~130
- **Functions:**
  - `prettifyItem`: ~30 lines
  - `processFeeds`: ~70 lines
  - Helper functions (`cleanHtml`, `extractDomain`, `wrapTitle`): ~25 lines
