# Task: Bug Fixes and UI Polishing

## Goal
Address reported bugs regarding deck clearing, shuffle counts, icon styling, and theme inconsistencies.

## Status
- [x] **Remove Sync Status Messages:** Remove or silence the transient status bar messages during sync.
- [ ] **Background Watcher Setup:** Move 'setting up watchers' and similar non-critical init tasks to the background to hide the loading screen faster.
- [ ] **Fix Theme Reset on Refresh:** Prevent the theme from resetting to default before loading user preferences.
- [ ] **Fix Deck Clearing Logic:** Resolve issue where unread > 0 but deck is empty, preventing new deck generation.
- [ ] **Fix Shuffle Count Increment:** Ensure the shuffle counter updates correctly in the UI and DB.
- [ ] **Repair Search/Shuffle Icons:** Fix CSS or SVG issues making icons look "messed up".
- [ ] **Fix Light Themes:** Ensure light themes don't inherit dark theme elements.

## Progress
- [x] Added tasks to current-task.md.
- [x] Silenced successful sync notifications.
- [x] Restored original SVG icons.
- [x] Standardized button layout and alignment.
- [x] Synced animations with Animation Speed slider.
- [x] Implemented alternating swipe directions.