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
- **Authentication & Authorization:**
    - Configured Authorized Domains in Firebase Console (`news.loveopenly.net`, `vscode.tail06b521.ts.net`, `localhost`).
    - Implemented Google and Email/Password login providers.
    - Verified email login functionality in the development environment.
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
- **Hosting Strategy:** Evaluated Firebase Hosting vs. Cloudflare Pages.
    - *Finding:* Firebase Hosting (Spark plan) has a 360MB/day transfer limit, which might be tight.
    - *Decision:* Selected **Cloudflare Pages** for frontend hosting due to unlimited free bandwidth and native integration with the existing Cloudflare Worker backend.
- **RSS Item Descriptions:** RSS feed items were missing description text. 
    - *Mitigation:* Refactored `mapRawItem` to stop aggressive removal of content-bearing links/images. Improved worker-side field selection.
    - *Verification:* Verified with `tests/rss_content.spec.js`. Descriptions (including those with links/images like The Verge) are now rendering correctly.
- **Alpine Proxies vs. StructuredClone:** `structuredClone` is incompatible with Alpine.js Proxies used in the app state. **Mitigation:** Employed JSON-based sanitization for reliable IndexedDB storage.
- **Test Environment Isolation:** Tests were failing due to unseeded data or lingering unauthenticated states. **Mitigation:** Implemented `ensureFeedsSeeded` helper and forced explicit login bypass in `beforeEach` hooks.

**Next Steps (Comprehensive Testing & Stabilization Plan):**
To ensure total project stability after the Firebase migration, tests will be run one by one, with findings recorded and fixed iteratively:
1.  **Phase 10.1: Core Feature Verification (`tests/feature.spec.js`)** - **PASSED**. Fixed CSS specificity for read-item highlights.
2.  **Phase 10.2: Authentication Flow (`tests/auth.spec.js`)** - **PASSED**. Verified Login, Logout, and Protected routes.
3.  **Phase 10.3: Data Persistence (`tests/backup.spec.js`, `tests/restore.spec.js`)** - **PASSED**. Confirmed config export/import cycle via Firestore.
4.  **Phase 10.4: Content & Sync (`tests/rss_content.spec.js`, `tests/deck_refresh.spec.js`)** - RSS parsing and deck generation.
5.  **Phase 10.5: UI & UX (`tests/ui.spec.js`, `tests/theme.spec.js`)** - Theme persistence and mobile/desktop layout stability.

---

### Progress Update - Wednesday, 31 December 2025

**Accomplishments:**
- **Roadmap Planning:** Defined a granular testing strategy to handle context limits.
- **Task Backlog:** Updated `next-tasks.md` with new features (GDPR Account Deletion, Password Reset, Deep-links).
- **Phase 10.1 Feature Verification:**
    - Verified Reset, Backup, and Read item highlight features.
    - **Fix:** Increased CSS specificity in `buttons.css` for `.read-button.read` to ensure gold highlight correctly overrides theme-specific base colors.
- **Phase 10.3 Data Persistence:**
    - Verified that configuration backups can be generated and downloaded.
    - Confirmed that restoring from a JSON backup correctly updates both local IndexedDB and remote Firestore state.
- **Phase 10.2 Authentication Flow:**
    - Verified Login/Logout cycles and automatic redirection to `login.html` for unauthenticated sessions.
    - Confirmed persistence of authentication state across reloads.
- **Phase 9 Security:** (Completed previously) Deployed Firestore rules to both Prod and Dev.
- **Dev Env:** Fully configured `.env.development` with correct Dev Service Account keys.

**Current Focus:**
- Phase 10.4: Content & Sync (`tests/rss_content.spec.js`, `tests/deck_refresh.spec.js`).

