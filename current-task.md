# Task: Bug Fixes and UI Polishing

## Goal
Address reported bugs regarding deck clearing, shuffle counts, icon styling, and theme inconsistencies.

## Status
- [x] **Background Watcher Setup:** Move 'setting up watchers' and similar non-critical init tasks to the background.
- [x] **Fix Theme Reset on Refresh:** Prevent the theme from resetting to default before loading user preferences.
- [x] **Fix Deck Clearing & Unread Bug:** Implement case-insensitive GUID comparison across the app.
- [x] **Refine Backup/Restore:** Exclude 'currentDeckGuids', 'shuffledOutGuids', 'lastShuffleResetDate', and 'shuffleCount' from backups.
- [ ] **Optimize Sync (Delta Sync):** Implement GUID-based delta syncing. The client will send its `lastFeedSync` timestamp, and the worker will only return items newer than that. This minimizes data usage and speeds up sync without needing external storage like Redis.
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