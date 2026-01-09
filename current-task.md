# Current Task: Demo Deck Implementation

## Objectives
Implement a demo deck system to serve curated RSS content to unauthenticated users without Firebase overhead.

## Status
- [x] **Cron Worker:** `worker/src/index.ts` updated with `scheduled` handler to generate demo deck.
- [x] **Demo API:** `/api/demo-deck.json` serves R2-cached deck.
- [x] **R2 Storage:** `rss-demo-deck-bucket` created and bound.
- [x] **Initial Integration:** Frontend detects unauthenticated users and loads demo feed.
- [x] **Verified:** Playwright tests confirm demo feed loading and redirection.
- [x] **UI Refinements:**
    - [x] Add Call-to-Action (CTA) dialog for account-only interactions.
    - [x] Intercept `toggleRead` (local only, no CTA), `processShuffle`, `saveRssFeeds` with CTA.
    - [x] Hide Advanced Settings, Filter View, and Backup/Restore in Demo Mode.
    - [x] Fix bug where marking read in demo mode clears the entire deck.
    - [x] Hide Auto-Sync Feed in Demo Mode.
    - [x] Fix CTA close button positioning.
    - [x] Make theme selection instant (optimistic UI).
- [x] **Asset Optimization:**
    - [x] Implement `preloadThemes` to warm up theme assets in background.

## Verification
- [x] Run `tests/demo.spec.js`.
- [x] Deploy to dev-news for final human verification.