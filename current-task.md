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

**Current Task Status: Frontend UI Issues**

**Goal:** Address the Frontend UI Issues (Reset button, Backup button, Box shadow).

**Completed Task: Settings Cog Issue**

**Issue Resolved:** The settings cog wheel and modal now function correctly. The flickering issue was resolved by uncommenting `src/css/modal.css`. The counter was removed and console logs confirmed `openSettings` toggles as expected.

**Current Focus: Backup Button**

**Goal:** Implement functionality for the "Backup Configuration" button (`id="backup-config-button"`, `@click="backupConfig()"`). When pressed, it should trigger a download of the user's current configuration (RSS feeds, keyword blacklist, and other user settings) as a JSON file.

**Mitigations and Next Steps (Frontend UI Issues):**

1.  **Settings Reset button doesn't work.** (Pending investigation)
2.  **Settings Backup button doesn't work.** (In Progress)
    *   **Action**: Locate the `backupConfig()` function definition. Fixed backend `config_backup` endpoint. Updated frontend to include time in backup filename.
    *   **Next Investigation**: Create a Playwright test to simulate user interaction (login, open settings, click backup) and capture console logs and network activity to debug why the download is not triggering.
3.  **Box shadow on `button.read-button` needs to be changed to `--var(--card-border)`.** (Pending investigation)
