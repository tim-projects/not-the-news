**Current Task Status: Frontend UI Issues**

**Goal:** Address the Frontend UI Issues (Settings cog, Reset button, Backup button, Box shadow).

**Previous Task Status: TypeScript Migration (COMPLETE)**

**Goal Achieved:** All JavaScript files within the `src/` directory have been successfully migrated to TypeScript (`.ts` or `.tsx`) and the project builds without compiler errors.

**Remaining Issues (from previous task):**

*   **`TS6133: 'type' is declared but its value is never read.` in `src/js/ui/uiUpdaters.ts`**: This is an acceptable warning as the `type` parameter is intended for future styling improvements and does not affect current functionality.

**Mitigations and Next Steps (Frontend UI Issues):**

1.  **Re-evaluate Settings Cog Issue**:
    *   **The user reported**: "the settings cog wheel no longer works at all. it still flickers. clicking it shows a counter underneath for absolutely no reason or use. The actual settings modal no longer displays."
    *   **Progress**:
        *   Removed the debugging counter `settingsButtonClicks` from `src/index.html` (along with its `x-text="settingsButtonClicks"`).
        *   Removed the entire debugging script block (`testSettingsClick()` and `console.log` overrides) from `src/index.html`.
        *   Confirmed `openSettings` initialized to `false` in `src/app.ts` and `src/main.ts`.
        *   Confirmed settings button `@click="openSettings = !openSettings"` correctly toggles the state.
        *   Confirmed modal `div` uses `x-show="openSettings"`.
        *   Identified that `manageSettingsPanelVisibility(this)` call was commented out in `src/app.ts`'s `openSettings` watcher.
    *   **Mitigation/Next Action**: Uncomment `await manageSettingsPanelVisibility(this);` within the `openSettings` watcher in `src/app.ts`.
    *   **Validation**: Rebuild the application and test the settings cog to see if the modal now displays correctly and if flickering is reduced.

2.  **Settings Reset button doesn't work.** (Pending investigation)
3.  **Settings Backup button doesn't work.** (Pending investigation)
4.  **Box shadow on `button.read-button` needs to be changed to `--var(--card-border)`.** (Pending investigation)