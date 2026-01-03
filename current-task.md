# Task: Deployment to Cloudflare Pages

## Status: Substantially Complete
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
9. [x] Security: Implement Firestore Security Rules
    - [x] **Prepare for Static Hosting (Cloudflare Pages)**
        - [x] Replace server-side Caddy redirects with client-side JS (`localStorage` check in `index.html`).
        - [x] Update `login.ts` and `main.ts` to manage `isAuthenticated` flag.
        - [x] Remove `redir` directives from production `Caddyfile`.
        - [x] Verify redirection logic with `tests/redirect.spec.js`.
        - [x] Configured `wrangler.jsonc` for production assets (`../www`) and custom domain.
        - [x] Automated production secret management (Firebase & App Password).
        - [x] Implemented client-side HTTPS redirect in `index.html` and `login.html` to resolve "Not Secure" warnings.
        - [x] UI Improvements:
        - [x] Layout fixes for Backup/Restore buttons.
        - [x] Implemented Modal-based Password Change UI.
        - [x] Reverted "Advanced Settings" to standard case and added User Email display.
    - [x] Backend Enhancements:
        - [x] Implemented standard JSON response helper with `Cache-Control` and `CORS` headers in Worker.
        - [x] Renamed all API endpoints to neutral names (`/api/profile`, `/api/list`, `/api/refresh`, etc.) to bypass ad-blockers.
        - [x] Hardened RSS fetching with AbortController, 2MB limits, and realistic User-Agent (fixes Reddit 403s).
        - [x] Implemented exponential backoff rate limiting and SSRF protection.
    - [x] **Deployment Automation:**
        - [x] Created `run-deploy-production.sh` with Git branch safety check (main/master only).
    - [x] **Containerless Local Development:**
        - [x] Created `run-local.sh` to run Vite and Wrangler without root/Docker.
        - [x] Implemented `systemd --user` service management.
        - [x] Configured `worker/.dev.vars` for local secrets.
    - [x] **Data Integrity & Robustness:**
        - [x] Fixed "original" theme normalization for legacy backups.
        - [x] Implemented auto-prepending of `https://` for protocol-less RSS URLs.
        - [x] Added worker-side filtering for comments (`#`) and empty lines in feed lists.
    - [x] **Legacy Cleanup:**
        - [x] Eliminated Docker, Podman, and Caddy components.

---

### Progress Update - Thursday, 1 January 2026

**Findings & Mitigations:**
- **Ad-Blocker Interference:** Browser extensions were blocking URLs containing "feed", "sync", or "user-state". 
    - *Mitigation:* Renamed all API endpoints to generic terms: `/api/profile` (state), `/api/refresh` (sync), `/api/list` (items), and `/api/lookup` (discovery).
- **RSS Fetching Reliability:** Reddit and other major sites were returning `403 Forbidden` to the Worker's default fetch requests.
    - *Mitigation:* Added a modern browser `User-Agent` and refined the fetch logic to include a 5s timeout and 2MB response size limit.
- **Production Security:** The `test@example.com` bypass posed a risk if leaked to production.
    - *Mitigation:* Wrapped the bypass in `import.meta.env.DEV` to ensure it only functions in local development environments.
- **Data Migration Path:** Restoring old backups (pre-2026) resulted in a broken UI due to the "original" theme name change.
    - *Mitigation:* Added normalization logic in `_loadInitialState` and `confirmRestore` to map legacy `"original"` values to `"originalLight"` or `"originalDark"`.

**Accomplishments:**
- **Robust URL Handling:** Implemented smart URL normalization that automatically adds `https://` to inputs like `theverge.com/rss` and strictly ignores comments/empty lines while preserving them in the user's configuration text.
- **Improved Identity UI:** The "Advanced Settings" view now clearly displays the email of the person signed in, and labels have been refined for better visual balance.
- **API Hardening:** The Worker now enforces strict payload size limits (128KB), per-user rate limiting with exponential penalties, and SSRF protection for feed discovery.
- **Type Safety:** Resolved several TypeScript errors in `AppState` and fixed async return types, ensuring a cleaner production build.
- **Production Readiness:** Successfully deployed the unified Worker + Assets package with full HTTPS support and automated deployment scripts.

**Final Verification:**
The application is live and functional in the production environment. The full E2E test suite (Auth, Redirect, RSS Content, UI, and Backup/Restore) has been executed and passes in the local containerless environment, mirroring the production logic.

---

### Progress Update - Friday, 2 January 2026

**Findings & Mitigations:**
- **COOP Policy Blockage:** Google Login popups were being blocked in production due to `Cross-Origin-Opener-Policy` restrictions.
    - *Mitigation:* Switched authentication flow from `signInWithPopup` to `signInWithRedirect`.
- **Missing Asset Binding:** Static assets were failing with 500 errors because the `ASSETS` binding was missing in `wrangler.jsonc`.
    - *Mitigation:* Added `binding: "ASSETS"` to the configuration and simplified the Worker's fetch handler.
- **Module Evaluation Errors:** Redundant re-exports and dynamic imports caused `TypeError` during production initialization.
    - *Mitigation:* Consolidated database imports into a central facade and eliminated dynamic imports in `main.ts`.
- **Circular Dependency Hang:** A circular dependency between `dbUserState.ts` and `dbSyncOperations.ts` caused module evaluation to fail in production builds.
    - *Mitigation:* Extracted shared definitions and basic loaders into `src/js/data/dbStateDefs.ts` to break the cycle.

---

### Progress Update - Saturday, 3 January 2026

**Findings & Mitigations:**
- **Cross-User Data Leak:** Discovered that the global feed cache in the Worker was shared across all authenticated sessions, allowing any logged-in user to see items synced by others via `/api/keys` and `/api/list`.
    - *Mitigation:* Replaced shared global arrays with a user-keyed `Map` (`userCaches`) to ensure strict isolation of feed data per UID.
- **Worker Memory Management:** Storing per-user caches in-memory without limits posed an OOM (Out-Of-Memory) risk.
    - *Mitigation:* Implemented a basic LRU (Least Recently Used) eviction policy for the `userCaches` Map, limiting the cache to 100 concurrent users.
- **RSS Content Security (XSS):** Audited the sanitization logic and confirmed that `sanitize-html` is correctly configured with a strict whitelist to strip malicious tags (`<script>`, `<iframe>`) and event handlers (`onerror`).

**Accomplishments:**
- **Isolated Per-User Caching:** Fully implemented and deployed secure, isolated caching in the Cloudflare Worker.
- **Security Regression Suite:** Added `worker/test/security_leak.spec.ts` which automatically verifies that users cannot access each other's feeds or profile data.
- **Hardened API Logic:** Updated all data-fetching endpoints (`/api/refresh`, `/api/keys`, `/api/list`) to strictly enforce UID-based lookups.
- **Archive Security:** Explicitly ensured that any `uid` field in restoration/backup files is stripped and ignored during import to prevent identity spoofing.
- **Import Robustness:** Modified the archive import process to be fault-tolerant, allowing partial success if individual keys fail to save, ensuring compatibility with older or malformed backup files.
- **Stale Asset Detection:** Investigated a user-reported `auth/popup-blocked` error and confirmed it was caused by a stale Service Worker serving an outdated build (`login-DOr9-383.js`) instead of the current version (`login-C34FhPJ2.js`) which correctly uses `signInWithRedirect`.
- **Automatic PWA Updates:** Configured `vite-plugin-pwa` with `registerType: 'autoUpdate'` and added `self.skipWaiting()` to `src/sw.ts`. This ensures that all users are forced to load the latest deployed version immediately upon visiting the site, preventing stale asset issues.

**Accomplishments:**
- **Production Google Login:** Fully functional redirect-based authentication flow.
- **Stable Asset Delivery:** Reliable serving of all static files through the Worker's asset binding.
- **Initialization Robustness:** Hardened application startup with timeouts and cleaner module structure.
- **Hardened Restoration:** Backups now correctly restore the full application state, including feed filters and deck positions.
- **Environment-Based Configuration:** Removed all hardcoded production URLs from the repository. Deployment now uses `VITE_PRODUCTION_DOMAIN` and temporary configuration files.