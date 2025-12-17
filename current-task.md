**Current Task Status: TypeScript Migration**

**Goal:** Migrate all JavaScript files to TypeScript (`.ts` or `.tsx`).

**Scope:** All `.js` files within the `src/` directory, EXCLUDING:
- `src/js/libs/` (third-party libraries)
- `node_modules/` (installed packages)
- Files within `www/` (build output directory)
- `tests/` directory (Playwright scripts - these will remain in JavaScript for now)
- Configuration files like `vite.config.js` and `playwright.config.js` (these may be converted in a separate, later step if necessary for tooling setup, but are not part of the core application logic migration).

**Progress on TypeScript Setup:**
- Installed `typescript` and `@types/node`.
- Created and configured `tsconfig.json` with `allowJs: true` and `checkJs: true`.
- Added `typecheck` script to `package.json`.
- Created `src/shims-for-migration.d.ts` to provide minimal type declarations for `.js` modules.

**Files to be Converted:**
- [x] ./src/js/helpers/userStateUtils.js (Converted to .ts and initial types added, errors resolved)
- [x] ./src/js/helpers/dataUtils.js (Converted to .ts and initial types added, errors resolved)
- [x] ./src/js/helpers/apiUtils.js (Converted to .ts and initial types added, errors resolved)
- [x] ./src/js/helpers/deckManager.js (Converted to .ts and initial types added, errors resolved)
- [x] ./src/js/data/dbSyncOperations.js (Converted to .ts and initial types added, errors resolved)
- [x] ./src/js/data/dbUserState.js (Converted to .ts and initial types added, errors resolved)
- [x] ./src/js/data/dbCore.js (Converted to .ts and initial types added, errors resolved)
- [x] ./src/js/data/database.js (Converted to .ts and initial types added, errors resolved)
- [x] ./src/js/utils/connectivity.js (Converted to .ts and initial types added, errors resolved)
- [ ] ./src/js/ui/uiElements.js
- [ ] ./src/js/ui/uiUpdaters.js
- [ ] ./src/js/ui/uiInitializers.js
- [ ] ./src/sw.js
- [ ] ./src/main.js
- [ ] ./src/app.js

**Frontend UI Issues (Debugging in Progress):**

*   **Settings cog icon requires 1-5 clicks to open and flickers on hover.**
    *   **Progress:**
        *   Resolved Gunicorn silent crash by implementing fork-safe logging (logging to `sys.stderr` instead of file).
        *   Attempted to fix cog click by changing `@click="openSettings = true"` to `@click="openSettings = !openSettings"`.
        *   Attempted to fix by dispatching custom event `toggle-settings-modal` from HTML and listening in `main.js`.
        *   Attempted to fix by removing `@click.self="openSettings = false"` from modal.
        *   Attempted to fix by removing all `x-transition` directives from modal.
        *   Attempted to fix by commenting out all CSS rules in `src/css/modal.css`.
        *   Current state for debugging: Reverted all `x-cloak` and `x-transition`, commented out `modal.css`, and replaced Alpine `@click` with a raw `onclick="testSettingsClick()"` that triggers `alert()` and increments an on-page counter.
    *   **Findings:** The issue persists even with raw JS `onclick`, indicating a problem *before* the click event reliably registers. Flickering on hover suggests rapid re-rendering or DOM interference.
    *   **Mitigation (Current Strategy):** Extreme simplification of the click handler and modal styling to isolate the core problem. Observing if the raw `onclick` event is consistently firing.

*   **Settings Reset button doesn't work.** (Pending investigation)
*   **Settings Backup button doesn't work.** (Pending investigation)
*   **Box shadow on `button.read-button` needs to be changed to `--var(--card-border)`.** (Pending investigation)

**Next Steps (on Settings Cog):**
- Continue observing the behavior of the simplified `onclick` handler and counter. If it's still inconsistent, the interference is likely happening at a very low level (browser event handling, z-index issues, or DOM re-rendering not related to Alpine.js).
- If the raw `onclick` works consistently, then the issue lies in Alpine.js's state management or event binding when `openSettings = true` is toggled.