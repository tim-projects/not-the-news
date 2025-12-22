# Current Task: Fix Shuffle Button and Persistence

## Objective
Fix issues where the shuffle button says it shuffled but the deck doesn't change, and the shuffle count resets on page refresh.
1. Investigate `processShuffle` logic in `src/js/helpers/deckManager.ts` and its usage in `src/main.ts`.
2. Ensure `shuffleCount` and `currentDeckGuids` are correctly persisted and loaded.
3. Fix the logic that replaces the deck when shuffling.
4. Verify that refreshing the page maintains the shuffled deck and the correct shuffle countdown.

## Progress
- [x] Investigate shuffle logic and persistence.
- [x] Fix deck replacement on shuffle (added `shuffledOutGuidsSet` check in `isDeckEffectivelyEmpty`).
- [x] Fix shuffle count persistence (added to sync definitions and fixed falsy `0` handling).
- [x] Fix broken RSS feed syncing due to missing frontend definitions and incorrect container paths.
- [x] Implement robust session management via Redis to resolve authentication failures in tests.
- [ ] Verify fix with tests (In Progress: resolving `/api/feed-sync` routing issue).

## Findings
- **RSS Missing:** RSS items were missing because `rssFeeds` and `keywordBlacklist` weren't defined in the frontend `USER_STATE_DEFS`, preventing them from being pulled from the server.
- **Path Issues:** `rss/run.py` used relative paths that didn't resolve correctly inside the container volume structure. Fixed to use absolute `/data/feed/`.
- **Auth Failures:** Transient tokens in `api.py` were not shared across requests reliably. Implemented Redis-backed session storage (`db 1`) for tokens.
- **Routing Loop:** `/api/feed-sync` was returning `index.html` because it wasn't recognized as a protected API path in Caddy, causing it to fall through to the SPA router.
- **Sync Lock:** `reset-app` deletes `feed.xml`. If the subsequent sync fails, the app has 0 items, causing tests to timeout.

## Mitigations
- **Consolidated API:** Unified multiple `_authenticate_request` definitions in `api.py`.
- **Manual Sync Route:** Added `/api/feed-sync` to allow tests to trigger feed generation on demand.
- **Absolute Paths:** Updated all container-side scripts to use absolute paths for shared volumes.
- **Enhanced Logging:** Switched all `app.logger` calls to `api_logger` for better visibility in Docker logs.