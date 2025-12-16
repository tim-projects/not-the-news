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
- [x] ./src/js/helpers/userStateUtils.js (Converted to .ts and initial types added, imports updated)
- [x] ./src/js/helpers/dataUtils.js (Converted to .ts and initial types added, errors resolved)
- [x] ./src/js/helpers/apiUtils.js (Converted to .ts and initial types added, errors resolved)
- [ ] ./src/js/helpers/deckManager.js
- [ ] ./src/js/data/dbUserState.js
- [ ] ./src/js/data/database.js
- [ ] ./src/js/data/dbSyncOperations.js
- [ ] ./src/js/data/dbCore.js
- [ ] ./src/js/utils/connectivity.js
- [ ] ./src/js/ui/uiElements.js
- [ ] ./src/js/ui/uiUpdaters.js
- [ ] ./src/js/ui/uiInitializers.js
- [ ] ./src/sw.js
- [ ] ./src/main.js
- [ ] ./src/app.js

**Current Challenges:**
- Project currently has compilation errors originating from `.js` files in the `src/js/data/` and `src/js/ui/` directories, and also from `src/js/libs/idb.js`. The `idb.js` file is intentionally excluded from conversion, so its errors need to be suppressed or ignored.

**Next Steps:**
- Address compilation errors in `src/js/data/dbCore.js`, `src/js/data/dbSyncOperations.js`, `src/js/data/dbUserState.js`, and `src/js/ui/uiUpdaters.js` by converting these files to TypeScript and adding types.
- Ensure errors from `src/js/libs/idb.js` are ignored/suppressed.
- The next file to convert is `src/js/helpers/deckManager.js`.
- Await further instructions to continue the conversion process.
