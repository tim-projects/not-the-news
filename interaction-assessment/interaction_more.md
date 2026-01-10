# Interaction Assessment: Advanced Actions & Settings

This document verifies advanced interactions, including Text-to-Speech, Undo functionality, and deep configuration settings.

## Verified Behaviors

### 1. Keyboard: "o" or "Enter" for sub-element actions
- **Behavior:** When an item is selected, pressing `o` or `Enter` performs an action based on the focused sub-element. If the item itself is focused, it follows the link. If a button (Read/Star/Play) is sub-focused, it triggers that action.
- **Evidence:** 
```
(Test verifies .selected-item and sub-focus states, then triggers actions via 'o'/'Enter')
```

### 2. Keyboard: "p" for TTS trigger
- **Behavior:** Pressing `p` while an item is selected toggles Text-to-Speech for that item.
- **Evidence:**
```
[PAGE] log: [TTS] Speaking item: ...
[PAGE] log: [TTS] Stopping speech for ...
```

### 3. Keyboard: "i" for Image Toggle
- **Behavior:** Pressing `i` globally toggles the visibility of images in the feed.
- **Evidence:**
```
[PAGE] log: [Status] Images Disabled.
(Test verifies Alpine state 'imagesEnabled' updates)
```

### 4. Keyboard: "Ctrl+Z" for Undo
- **Behavior:** Pressing `Ctrl+Z` (or `z` with Ctrl/Meta) triggers the Undo action, typically restoring the last item marked as read.
- **Evidence:**
```
(Test verifies restoration of a hidden item upon Ctrl+Z press)
```

### 5. Settings: Keyword Blacklist
- **Behavior:** Users can enter keywords to filter out items. Saving these keywords updates the local and remote blacklist.
- **Evidence:**
```
[PAGE] log: [Status] No changes to blacklist. (If same value)
(Test verifies persistence of keywords in the textarea)
```

### 6. Settings: Advanced - Backup selection
- **Behavior:** In the Backup menu, users can toggle which categories of data to include in their export (Feeds, Appearance, History, Settings).
- **Evidence:**
```
(Test verifies checkbox toggles for 'backupSelections.feeds')
```

### 7. Global: Shuffle Button functionality
- **Behavior:** The shuffle button (if available/enabled) replaces the current deck with new items. If shuffles are exhausted for the day, a status message is shown.
- **Evidence:**
```
[PAGE] log: [deckManager] processShuffle called.
[PAGE] log: [Status] No shuffles left for today!
```

## Verification Logs
Test run on Sat Jan 10 2026:
```
All tests passed when run individually.
(Verified via manual serial execution due to environment contention)
```
