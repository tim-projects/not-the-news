# Current Task: Help Modal Refactor & UX Polish

## Objectives
- [x] Refactor shortcuts UI into an integrated sticky column.
- [x] Implement SVG drawing animations for star and read buttons.
- [x] Standardize keyboard shortcuts (`u` for Undo, `t` for Top, `m` for Read).
- [x] Implement 10s selection highlight fade.
- [x] Fix mobile layout centering and scrolling (global `box-sizing`, `margin: 0`).
- [x] Refactor Service Worker for SPA offline reliability.
- [x] Ensure all themes support the shadows toggle with visible colors.
- [x] Fix "Original Dark" theme loading bug (base class sync).
- [x] Fix Shuffle Count revert bug (manual shuffle vs. auto-refresh).
- [x] Implement background deck pre-generation (online & offline variants).
- [x] Update `processShuffle` to consume pre-generated decks for instant refreshes.
- [x] Improve feed item focus visibility via selection opacity (1.0 selected, 0.8 unselected).
- [x] Refine modal keyboard interactions (Escape to close, field navigation).
- [x] Fix "active color" appearing during drawing animation.
- [x] Fix theme selector reporting "Original Dark" when "Original Light" is active.
- [x] Fix undo button outline shape to match button border radius dynamically.
- [ ] Investigate and fix Unread count remaining at 0 after auto-refresh.

## Progress
- Refactored `shortcuts-section` into a sticky/sliding layout.
- Standardized navigation keys and added navigation memory via `lastSelectedGuid`.
- Implemented CSS keyframe-based selection fade (10s).
- Successfully resolved mobile alignment issues by resetting `html/body` margins and applying global `border-box`.
- Refactored SW to use Workbox `NavigationRoute` for reliable `index.html` fallback.
- Added visible shadow colors to all theme CSS files and fixed `.no-shadows` global override.
- Synchronized `localStorage` and `html` base classes in `main.ts` to fix theme persistence.
- Refined `deckManager.ts` logic to prevent manual shuffles from being "refunded" by auto-refresh.
- Implemented consumption of pre-generated decks in `processShuffle` and `_loadAndManageAllData`.
- Implemented focus-based opacity logic in `content.css` to clearly distinguish selected items.
- Fixed keyboard event leakage into the feed when the settings modal is active.
- Resolved "active color" bleed during SVG drawing by making the button transparent during animation.
- Introduced `originalLight` and `originalDark` theme styles to resolve state confusion between light/dark modes.
- Fixed Undo button SVG outline by calculating dynamic border radius based on button height.

## Findings & Mitigations
- **Race Condition in Deck Regeneration**: Occurred when marking the last item as read. Fixed by consolidating async lifecycle in `toggleRead` and adding explicit array reference updates.
- **Theme Persistence Issue**: The base `light`/`dark` class was only set on explicit user toggle. Fixed by adding a class-management step to `applyThemeStyle` and syncing `localStorage` early.
- **Shuffle Count Bug**: Manual shuffles were being "refunded" by `manageDailyDeck`. Mitigation: added `allItemsInDeckShuffled` check to specifically detect manual shuffles.
- **Undo Button Outline Fix**: SVG `rx/ry` was hardcoded to 100, making it oval on short buttons. Mitigation: Added `undoBtnRadius` to state and used `requestAnimationFrame` to measure button height after it renders.
- **Theme Style Confusion**: "Original" value was used for both Light and Dark modes, leading to UI selector mismatches. Mitigation: Explicitly separated values into `originalLight` and `originalDark`.
- **Unread Count Bug**: Reports of unread count staying at 0 after a deck refresh. Potential mitigation: ensure `updateCounts` is called *after* `this.deck` and `this.currentDeckGuids` are fully populated in `_loadAndManageAllData`.

## Next Steps
- Implement robust fix for Unread count UI synchronization.
- Perform final audit of offline mode behavior.
- Standardize all test files to use ES modules.