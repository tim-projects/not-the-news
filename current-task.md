# Task: Convert to Multi-User App with Firebase

## Status: In Progress
**Branch:** `multi-user-firebase`

### Roadmap
1. [x] Firebase Account & Project Setup (User)
2. [x] Frontend Firebase SDK Integration
3. [x] Modernize Login UI & Implementation
4. [x] Update Frontend to send Auth Tokens
5. [x] Update main.ts to enforce Authentication (Refactored to prevent circular redirects)
6. [x] Cloudflare Worker: Verify Firebase Tokens (using `jose`)
7. [x] Cloudflare Worker: Associate data with UIDs (Storage isolation)
8. [ ] Migration: Local/Redis state to Firestore
9. [ ] Security: Implement Firestore Security Rules

---

### Progress Update - Sunday, 28 December 2025

**Accomplishments:**
- **Auth Robustness:** Refactored `src/main.ts` and `src/js/login.ts` to handle authentication initialization cleanly. Added `data-auth-ready` attribute to the login form to signal script readiness to testing frameworks.
- **Bypass Login:** Implemented a multi-stage bypass for `test@example.com` / `devtestpwd` that tries Anonymous sign-in first, then falls back to email/password creation/login. This ensures a valid Firebase UID is always available for testing.
- **Build System:** Updated `Dockerfile`, `dockerfile-dev`, `build.sh`, and `build-dev.sh` to correctly pass `VITE_FIREBASE_*` environment variables as build arguments, ensuring the production build contains the necessary Firebase configuration.
- **Worker Isolation:** Verified that the Cloudflare Worker correctly identifies users via the `Authorization` header and stores state in UID-specific directories.
- **Cleanup:** Integrated `podman system prune -a -f` into the development build script to manage disk usage efficiently.

**Findings & Mitigations:**
- **Test Reliability:** Addressed failing tests in `tests/auth.spec.js` by waiting for the `data-auth-ready` signal before interaction.
- **Redirect Handling:** Signup test now uses `Promise.race` to correctly handle both immediate redirects and success message displays.

**Whitelisting Requirements (Reminder):**
- Ensure the following are in Firebase Console "Authorized domains":
  - `news.loveopenly.net`
  - `vscode.tail06b521.ts.net`
  - `localhost` (for dev)

**Next Steps:**
- **Phase 8: Firestore Migration.** Transition from local UID-based JSON files to Cloudflare-compatible Firestore SDK (or REST API) to enable true statelessness and cross-instance data persistence.
