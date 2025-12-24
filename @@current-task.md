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

## Findings & Mitigations
- **Race Condition in Deck Regeneration**: Occurred when marking the last item as read. Fixed by consolidating async lifecycle in `toggleRead` and adding explicit array reference updates.
- **Theme Persistence Issue**: The base `light`/`dark` class was only set on explicit user toggle. Fixed by adding a class-management step to `applyThemeStyle` and syncing `localStorage` early.
- **Shuffle Count Bug**: Manual shuffles were being "refunded" by `manageDailyDeck`. Mitigation: added `allItemsInDeckShuffled` check to specifically detect manual shuffles.
- **Keyboard Shortcut Leakage**: Global shortcuts (j/k, arrows) remained active while the settings modal was open. Mitigation: Implemented modal-aware logic in `keyboardManager.ts` to block global events and handle focus traps.
- **Test Selector Fragility**: Playwright tests were failing because the `read-button` selector was too broad, picking up the "Close" button in the shortcuts panel. Mitigation: Refined locators to target specific children of the main `#items` container.

## Next Steps
- Fix the theme selector UI bug where "Original Light" incorrectly reports as "Original Dark" on reopen.
- Resolve remaining test timeouts by optimizing `waitForSelector` and loading screen handling.
- Perform final audit of offline mode behavior with pre-generated decks.
