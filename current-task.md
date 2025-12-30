# Task: Convert to Multi-User App with Firebase

## Status: In Progress
**Branch:** `multi-user-firebase`

### Roadmap
1. [x] Firebase Account & Project Setup (User)
2. [x] Frontend Firebase SDK Integration
3. [x] Modernize Login UI & Implementation
4. [x] Update Frontend to send Auth Tokens
5. [x] Update main.ts to enforce Authentication
6. [x] Cloudflare Worker: Verify Firebase Tokens (using `jose`)
7. [x] Cloudflare Worker: Associate data with UIDs (Storage isolation)
8. [x] Migration: Local/Redis state to Firestore (REST API Implementation)
9. [ ] Security: Implement Firestore Security Rules

---

### Progress Update - Tuesday, 30 December 2025

**Accomplishments:**
- **Standardized E2E Test Suite:**
    - Created `tests/test-helper.js` to centralize authenticated login and feed seeding logic.
    - Refactored 10+ test files (including `shuffle`, `unread`, `undo`, `config`, `theme`, `tts`, `flick`, etc.) to use modern Firebase-aware setup patterns.
    - Resolved widespread test failures caused by legacy authentication logic and UI structure changes.
- **Authenticated Admin & Worker Endpoints:**
    - Added mandatory authentication tokens to `backupConfig`, `restoreConfig`, `resetApplicationData`, and background worker feed-sync tasks.
    - Exported `getAuthToken` from `dbSyncOperations.ts` to allow widespread usage in core application logic.
- **Resolved Data Persistence Bugs:**
    - Fixed a critical `DataCloneError` in `sanitizeForIndexedDB` by switching from `structuredClone` to `JSON.parse(JSON.stringify())`, which correctly handles Alpine.js Proxy objects.
    - Standardized backup filename matching in tests to support ISO-formatted timestamps.
- **Improved UI Reactivity & Robustness:**
    - Enhanced theme selection logic in `index.html` using `closest('optgroup')` for better reliability.
    - Restored missing `[DEBUG]` console logs to support automated verification of configuration settings.
- **Stabilized Application State:** Restored missing state properties in `src/main.ts` that were causing widespread Alpine.js "undefined" errors.

**Findings & Mitigations:**
- **Alpine Proxies vs. StructuredClone:** `structuredClone` is incompatible with Alpine.js Proxies used in the app state. **Mitigation:** Employed JSON-based sanitization for reliable IndexedDB storage.
- **Test Environment Isolation:** Tests were failing due to unseeded data or lingering unauthenticated states. **Mitigation:** Implemented `ensureFeedsSeeded` helper and forced explicit login bypass in `beforeEach` hooks.
- **UI Navigation Latency:** Tests were frequently timing out while waiting for nested settings sub-menus. **Mitigation:** Added explicit waits for sub-menu visibility and manual `change` event dispatching for reactive elements.

**Whitelisting Requirements (Reminder):**
- Ensure the following are in Firebase Console "Authorized domains":
  - `news.loveopenly.net`
  - `vscode.tail06b521.ts.net`
  - `localhost` (for dev)

**Next Steps:**
- **Phase 9: Security Rules.** Implement and deploy Firestore Security Rules to protect user data.
- **Cleanup:** Remove any remaining legacy local file storage logic from the worker.
- **Comprehensive Run:** Execute the entire `npx playwright test` suite one last time to confirm total project stability.
