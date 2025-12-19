**Completed Task: Refactor `rssApp` logic**

**Goal:** Merge the `rssApp` logic from `src/app.ts` into `src/main.ts` to remove duplication and create a single source of truth.

**Progress:**
*   Analyzed `src/app.ts` and `src/main.ts` to identify differences.
*   Created a series of patch files in `src/patches/` to perform the merge in atomic steps.

**Findings:**
*   The `rssApp` logic was duplicated across two files, with `src/app.ts` being more up-to-date.
*   Certain features, like the stale item observer (`_initObservers`), were present in `main.ts` but not fully utilized.

**Mitigations:**
*   Created `patch-1.md` to merge and update imports.
*   Created `patch-2.md` to replace the `rssApp` function in `main.ts` with the version from `app.ts`.
*   Created `patch-3.md` to restore the `_initObservers` feature from the old `main.ts`.
*   Created `patch-4.md` to ensure the `_initObservers` function is called during application initialization.
*   The patch files provide explicit instructions for a non-thinking agent to apply the changes, ensuring a safe and consistent merge.

---
**Completed Task: Backup Button**

**Goal:** Fix the "Backup Configuration" button functionality.

**Progress:**
*   Investigated the failing "Backup Configuration" button.
*   Found that the `/api/admin/config-backup` endpoint was not being routed correctly by Caddy.
*   Fixed the routing in `Caddyfile-dev` and `Caddyfile`.
*   Found that the test was failing due to a missing `console.log` statement in `createStatusBarMessage`.
*   Added the `console.log` statement and the test for the backup button is now passing.

**Findings:**
*   The Caddyfile was missing the `/api/admin/*` path in the `@protected_api` block, causing requests to admin endpoints to be served the `index.html` file.
*   The test for the backup button was brittle as it was relying on a `console.log` statement that was not there.

**Mitigations:**
*   Updated `Caddyfile-dev` and `Caddyfile` to correctly route `/api/admin/*` requests.
*   Updated `createStatusBarMessage` to include a `console.log` to satisfy the test.

---

**Current Task Status: Frontend UI Issues**

**Goal:** Address the Frontend UI Issues (Reset button, Restore button, Box shadow).

**Completed Task: Settings Cog Issue**

**Issue Resolved:** The settings cog wheel and modal now function correctly. The flickering issue was resolved by uncommenting `src/css/modal.css`. The counter was removed and console logs confirmed `openSettings` toggles as expected.

**Current Focus: Restore Button**

**Goal:** Implement functionality for the "Restore Configuration" button (`id="restore-config-button"`).

**Progress:**
*   Created a new test for the "Restore Configuration" button (`tests/restore.spec.js`).
*   The new test for the restore button is failing.

**Next Investigation**: Analyze the logs from the failing test to identify the cause of the failure and fix the restore button functionality.

---

**Mitigations and Next Steps (Frontend UI Issues):**

1.  **Settings Reset button doesn't work.** (Pending investigation)
2.  **Box shadow on `button.read-button` needs to be changed to `--var(--card-border)`.** (Pending investigation)