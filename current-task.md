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
8. [ ] Migration: Local/Redis state to Firestore
9. [ ] Security: Implement Firestore Security Rules

---

### Progress Update - Sunday, 28 December 2025

**Accomplishments:**
- **Frontend Auth Enforced:** Updated `src/main.ts` to use `onAuthStateChanged`. Unauthenticated users are now redirected to `login.html`.
- **Logout Feature:** Added a `logout` method to `rssApp` and a Logout button in the settings modal.
- **Worker Security:** Integrated `jose` library in the Cloudflare Worker to verify Firebase RS256 ID tokens.
- **Multi-User Isolation:** Refactored the worker's `Storage` class and handlers to isolate user state under `user_state/<uid>/` directory.
- **Container Integration:** Updated `build-dev.sh` to mount `.env` into the container and `build_entrypoint.sh` to pass `FIREBASE_PROJECT_ID` to the worker process.
- **Admin Endpoints:** Updated `/api/admin/reset-app` and other endpoints in the worker to be user-aware.

**Findings & Mitigations:**
- **Storage Strategy:** User data is now stored per-UID on disk (within the container volume). This provides immediate multi-user support while we prepare for Phase 8 (Firestore migration).
- **Seeding:** The initial seeding process now targets a `seeding-user` UID.
- **Worker Environment:** The worker now requires `FIREBASE_PROJECT_ID` to be set in its environment variables to verify tokens.

**Whitelisting Requirements (Reminder):**
- Ensure the following are in Firebase Console "Authorized domains":
  - `news.loveopenly.net`
  - `vscode.tail06b521.ts.net`
  - `localhost` (for dev)

**Next Steps:**
- Test the login flow and data isolation in the dev environment.
- Plan the migration of user state from local JSON files to Google Cloud Firestore for better scalability and multi-instance support.
- SECURE: The worker currently still allows some "anonymous" access for transition; this should be tightened once testing confirms token verification is stable.
