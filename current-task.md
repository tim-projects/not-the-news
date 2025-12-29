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

### Progress Update - Monday, 29 December 2025

**Accomplishments:**
- **Firestore REST Migration:** Successfully migrated the Cloudflare Worker `Storage` class to use the Firestore REST API. The app is now truly stateless, persisting all user settings, RSS feeds, and read/starred state directly to Firestore under `users/{uid}/state/{key}`.
- **Runtime Configuration Injection:** Solved the "auth/configuration-not-found" issue by moving Firebase configuration injection from build-time to runtime. `build_entrypoint.sh` now performs a precise `sed` replacement on all built assets in `/app/www/` every time the container starts.
- **Worker Robustness:** Fixed several syntax and logical errors in the worker's `src/index.ts` related to admin endpoints and default export formatting.
- **Seeding Automation:** Implemented `/api/admin/config-restore` in the worker to allow the entrypoint script to automatically seed initial RSS feeds and blacklists into Firestore.
- **Improved Build Script:** `build-dev.sh` now robustly sources and exports `.env.development` variables, ensuring they are passed to the container runtime via `-e` flags.

**Findings & Mitigations:**
- **Vite Env Bundling Issue:** Discovered that build-time environment variables in Docker are unreliable due to layer caching. **Mitigation:** Used placeholder strings in source code (`VITE_FIREBASE_*_PLACEHOLDER`) and injected real values at runtime via the container entrypoint.
- **Asset Ownership:** Runtime injection failed initially due to files in `www/assets` being owned by root. **Mitigation:** Added `chown -R appuser:appgroup /app/www/` to the entrypoint before injection.
- **Service Worker Caching:** Browser was loading stale `sw.js` without injected keys. **Mitigation:** Expanded injection to target all files in `www` and added verification steps in logs.
- **Disk Space Management:** Encountered "no space left on device" during Podman builds. **Mitigation:** Added `podman system prune -f` to the build process.

**Whitelisting Requirements (Reminder):**
- Ensure the following are in Firebase Console "Authorized domains":
  - `news.loveopenly.net`
  - `vscode.tail06b521.ts.net`
  - `localhost` (for dev)

**Next Steps:**
- **Phase 9: Security Rules.** Implement and deploy Firestore Security Rules to protect user data beyond the worker's service account access.
- **Cleanup:** Remove legacy local file storage logic from the worker.
- **Verification:** Run the full `auth.spec.js` and `ui.spec.js` suites to ensure zero regressions in the new stateless architecture.