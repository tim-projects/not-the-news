# Task: Bug Fixes and UI Polishing

## Goal
Address reported bugs regarding deck clearing, shuffle counts, icon styling, and theme inconsistencies.

## Status
- [x] **Background Watcher Setup:** Move 'setting up watchers' and similar non-critical init tasks to the background.
- [x] **Fix Theme Reset on Refresh:** Prevent the theme from resetting to default before loading user preferences.
- [ ] **Fix Deck Clearing & Unread Bug:** Implement case-insensitive GUID comparison across the app. Ensure 'unreadCount' and 'loadAndDisplayDeck' correctly handle potentially mismatched GUID casing from restores or syncs.
- [ ] **Refine Backup/Restore:** Exclude 'currentDeckGuids', 'shuffledOutGuids', 'lastShuffleResetDate', and 'shuffleCount' from backups to prevent "ghost" items and ensure clean regeneration on new installs.
- [ ] **Fix Light Themes:** Audit theme CSS files to ensure dark elements don't bleed into light themes (check gradients, shadows, and hardcoded colors).
- [ ] **Fix Shuffle Count Increment:** Ensure the shuffle counter updates correctly in the UI and DB (verify interaction with refund logic).
- [ ] **Repair Search/Shuffle Icons:** Verify if current icons look "messed up" and fix if needed.

## Progress
- [x] Added tasks to current-task.md.
- [x] Silenced successful sync notifications.
- [x] Restored original SVG icons.
- [x] Standardized button layout and alignment.
- [x] Synced animations with Animation Speed slider.
- [x] Implemented alternating swipe directions.
- [x] Backgrounded non-critical initialization tasks.
- [x] Fixed theme flash on refresh.