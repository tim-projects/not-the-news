# Patch 1: Merge and Update Imports in src/main.ts

This patch updates and merges the imports in `src/main.ts` to include all necessary modules from both `src/app.ts` and the existing `src/main.ts` to ensure no functionality is lost.

## Instructions

In `src/main.ts`, find the following block of code:

```typescript
import {
    updateCounts,
    scrollToTop,
    attachScrollToTopHandler,
    saveCurrentScrollPosition,
    createStatusBarMessage
} from './js/ui/uiUpdaters.ts';
import {
    initSyncToggle,
    initImagesToggle,
    initTheme,
    initConfigPanelListeners
} from './js/ui/uiInitializers.ts';
import { manageDailyDeck, processShuffle } from './js/helpers/deckManager.ts';
import { isOnline } from './js/utils/connectivity.ts';
import { MappedFeedItem, ReadItem, StarredItem, DeckItem, ShuffledOutItem, RssFeedsConfig, AppState } from '@/types/app.ts';
```

And replace it with this:

```typescript
import {
    updateCounts,
    manageSettingsPanelVisibility,
    scrollToTop,
    attachScrollToTopHandler,
    saveCurrentScrollPosition,
    createStatusBarMessage
} from './js/ui/uiUpdaters.ts';
import {
    initSyncToggle,
    initImagesToggle,
    initTheme,
    initScrollPosition,
    initConfigPanelListeners
} from './js/ui/uiInitializers.ts';
import { manageDailyDeck, processShuffle } from './js/helpers/deckManager.ts';
import { isOnline } from './js/utils/connectivity.ts';
import { MappedFeedItem, ReadItem, StarredItem, DeckItem, ShuffledOutItem, RssFeedsConfig, AppState } from './types/app.ts';
```
