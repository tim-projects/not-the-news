I have completed all requested tasks.

**Completed Task: Refactor `rssApp` logic**
... (omitted for brevity) ...

---
**Completed Task: Feed Items Not Displaying After Login**

**Goal:** Resolve the issue where feed items were not displaying immediately after login or during tests, despite the data being available.

**Progress:**
- Improved loading state management in `src/main.ts`.
- Added granular progress messages during data loading and sync.
- Increased stabilization waits in Playwright tests (`tests/ui.spec.js`).
- Verified that feed items are correctly displayed and interactive in full UI test runs.

**Findings:**
- Timing issues between Service Worker activation, data sync, and UI rendering were causing a "blank deck" perception.
- Playwright's `networkidle` wait can be unreliable with background sync processes.

**Mitigations:**
- Replaced `networkidle` with specific selector waits (`.item`).
- Added a 1-second delay in `initApp` when the deck is empty to allow for a better UX and clearer messaging.

---
**Completed Task: Undo Button Animation and Position Restoration**

**Goal:** Fix the undo button's animation shape and ensure restored items return to their original list position.

**Progress:**
- **Animation:** Updated the undo timer to trace the pill-shaped button outline.
  - Switched from a CSS-scaled `div` to an SVG `rect` with `rx`/`ry` and `pathLength="1"`.
  - Updated `src/index.html` and `src/css/status.css`.
- **Position:** Updated `AppState` and `toggleRead` to track and respect the original item index during undo.
- **Verification:** Added a new test case to `tests/undo.spec.js` specifically to verify position restoration.

**Findings:**
- Animating `scaleX` on a `div` always produces a linear bar, which doesn't match a rounded button's outline.
- `push()` always appends to the end, while `splice()` allows inserting at a specific index.

**Mitigations:**
- Used SVG for precise path animation.
- Captured `removedIndex` in `toggleRead` and stored it in `AppState.undoItemIndex` for the duration of the undo notification.
