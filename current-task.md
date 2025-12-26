# Current Tasks - COMPLETED

## 1. Improve Empty Feed State - DONE
- **Change:** Updated `src/index.html` empty state to show "You ran out of content. Add another feed.." and an "Add feed" button when the feed is truly exhausted.
- **Logic:** Checks `allCount === 0 || (filterMode === 'unread' && entries.every(e => isRead(e.guid)))`.

## 2. Fix Undo Button Bug - DONE
- **Change:**
    - Updated `src/index.html` to hide the undo notification if `openSettings` or `openShortcuts` is true.
    - Updated `src/main.ts` to explicitly set `showUndo = false` when opening settings or starting a backup.
- **Goal:** Ensure the undo button is ONLY shown when appropriate and never on top of the settings modal.

## 3. Fix Settings Modal Close Button - DONE
- **Change:**
    - Refactored `src/index.html` settings modal to use a fixed `.modal-header` and a scrollable `.modal-body`.
    - Updated `src/css/modal.css` to support this layout using Flexbox and `overflow: hidden` on the container.
- **Result:** The close and back buttons now remain visible at the top of the modal even when the content is scrolled.

## 4. Optimize Deck Refresh UX - DONE
- **Change:** 
    - In `toggleRead`, background work (pre-generating next deck and refreshing item cache) now starts immediately when the last item is read, while the undo button is still visible.
    - The "Generating new deck..." loading screen is now skipped if a pre-generated deck is ready when the undo period ends.
- **Result:** Seamless transition to the next deck without an intermediary loading screen in most cases.

## 5. Fix Item Button Overlap - DONE
- **Change:** Increased `min-height` of `.itemtitle` from 120px to 130px in `src/css/layout.css`.
- **Result:** Prevents vertical overlap of the top-right "read" button and bottom-right "star" button on mobile when the title is only one line long.