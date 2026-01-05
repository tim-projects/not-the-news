# Task: Bug Fixes and UI Polishing

## Goal
Address reported bugs regarding deck clearing, shuffle counts, icon styling, and theme inconsistencies.

## Status
- [x] **Background Watcher Setup:** Move 'setting up watchers' and similar non-critical init tasks to the background.
- [x] **Fix Theme Reset on Refresh:** Prevent the theme from resetting to default before loading user preferences.
- [x] **Fix Deck Clearing & Unread Bug:** Implement case-insensitive GUID comparison across the app.
- [x] **Refine Backup/Restore:** Exclude 'currentDeckGuids', 'shuffledOutGuids', 'lastShuffleResetDate', and 'shuffleCount' from backups.
- [x] **Optimize Sync (Delta Sync):** Implement GUID-based delta syncing. The client now sends its newest item timestamp, and the worker only returns fresh content. This dramatically reduces data transfer and sync time.
- [ ] **Fix Light Themes:** Audit theme CSS files to ensure dark elements (shadows, gradients) don't bleed into light themes.
- [ ] **Fix Shuffle Count Increment:** Ensure the shuffle counter updates correctly in the UI and DB.
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
- [x] Implemented case-insensitive GUID matching.
- [x] Refined backup/restore to exclude transient session data.
- [x] Parallelized feed fetching in the Worker.
- [x] Implemented GUID-based Delta Sync.
- [x] Optimized backup/restore performance via parallel server requests.
- [x] Fixed read history restoration bug.
- [x] Added production deployment protection to build.sh.