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
- **Resolved Firebase Configuration Errors:** Fixed the "projectId not provided" and `auth/configuration-not-found` errors by optimizing Vite's environment variable handling.
- **Stabilized Application State:** Restored missing state properties in `src/main.ts` that were causing widespread Alpine.js "undefined" errors, fixing the "broken" UI state.
- **Eliminated 401 Unauthorized Errors:** 
    - Improved `getAuthToken` in `dbSyncOperations.ts` with a retry loop to handle slow Firebase initialization.
    - Added explicit token checks before all protected network requests to prevent sending unauthenticated headers.
    - Refactored `tests/ui.spec.js` to use the app's own authenticated logic instead of raw unauthenticated `fetch` calls.
- **Gated Initialization:** Updated `initApp` to strictly defer data fetching until user authentication is verified and stable.
- **Authentication Verified:** Confirmed that both bypass login and full UI initialization now work without console errors.

**Findings & Mitigations:**
- **Vite Env Bundling:** Build-time environment variables were not being picked up because the Vite `root` was set to `src/`. **Mitigation:** Set `envDir: '../'` in `vite.config.js`.
- **Alpine State Loss:** State properties were truncated during refactoring. **Mitigation:** Restored complete `AppState` properties in the `rssApp` object.
- **Auth Race Conditions:** Network requests fired before tokens were ready. **Mitigation:** Added a retry mechanism for token acquisition and forced `initApp` to wait for verification.
- **Test Suite Interference:** Playwright diagnostic checks were triggering 401 errors. **Mitigation:** Refactored tests to operate within the authenticated Alpine application context.

**Whitelisting Requirements (Reminder):**
- Ensure the following are in Firebase Console "Authorized domains":
  - `news.loveopenly.net`
  - `vscode.tail06b521.ts.net`
  - `localhost` (for dev)

**Next Steps:**
- **Phase 9: Security Rules.** Implement and deploy Firestore Security Rules to protect user data.
- **Cleanup:** Remove any remaining legacy local file storage logic from the worker.
- **Final Verification:** Run the full test suite (`auth.spec.js`, `ui.spec.js`, `backup.spec.js`) to ensure stability across all features.