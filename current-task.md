# Current Task: Fix Status Message Bar and Config Sync

## Objective
The status message bar (toast) never appears. It needs to be implemented such that it:
1. Appears at the bottom of the screen when a message is generated.
2. Stays visible long enough to be read.
3. Automatically hides after a delay.
4. Uses a non-distracting animation to avoid interrupting the user's reading experience.

## Progress
- [x] Investigate `createStatusBarMessage` implementation in `src/js/ui/uiUpdaters.ts`.
- [x] Check `src/css/status.css` for existing styles and animations.
- [x] Update logic in `main.ts` or `uiUpdaters.ts` to manage the visibility lifecycle.
- [x] Ensure the animation is subtle and non-distracting.
- [x] Verify with manual check and UI tests.

## Findings
- **Status Bar ID Inconsistency:** The HTML used `#status-message-container` while CSS targeted `#sync-status-message`.
- **Visibility Logic:** `x-show` was hiding the element too quickly for CSS transitions to fire.
- **Config Sync Failure:** RSS feeds and keyword blacklists were missing in incognito mode because `USER_STATE_DEFS` lacked definitions for those keys, preventing them from being pulled from the server.
- **Reset Wiping Config:** The reset button was deleting `rssFeeds.json`, `keywordBlacklist.json`, and `theme.json` on the backend.
- **Parsing Incompatibility:** The UI couldn't parse the seeded nested RSS structure, showing an empty list even when the feed was working.
- **Deck Recovery Bug:** `manageDailyDeck` was failing to regenerate a deck after a reset because it didn't correctly identify that the old deck GUIDs were missing from the fresh feed.

## Mitigations
- **Unified Status Bar:** Unified IDs to `#sync-status-message` and used Alpine.js `:class` bindings to trigger subtle CSS transitions.
- **Robust RSS Parsing:** Created `parseRssFeedsConfig` utility to handle both nested (seeded) and flat (user-saved) JSON formats.
- **Persistent Configuration:** Updated `api.py` to preserve feeds, blacklist, and theme during a reset.
- **Forced Sync Recovery:** Implemented a `force` pull parameter in sync operations to immediately restore preserved configuration after an application reset.
- **Prioritized Image Loading:** Implemented an `IntersectionObserver` to trigger image loading as items enter the viewport.
- **Smart Deck Management:** Refined `manageDailyDeck` to detect effectively empty decks (e.g. after a reset) and force immediate population from entries.
- **Settings Feedback:** Added status messages for all settings toggles (Sync, Images, Theme, etc.).
- **Consistent UI Components:** Aligned the undo button's background, colors, and vertical position with the scroll-to-top button for a more cohesive UI.