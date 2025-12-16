**Current Task Status: TypeScript Migration**

**Goal:** Migrate all JavaScript files to TypeScript (`.ts` or `.tsx`).

**Scope:** All `.js` files within the `src/` directory, EXCLUDING:
- `src/js/libs/` (third-party libraries)
- `node_modules/` (installed packages)
- Files within `www/` (build output directory)
- `tests/` directory (Playwright scripts - these will remain in JavaScript for now)
- Configuration files like `vite.config.js` and `playwright.config.js` (these may be converted in a separate, later step if necessary for tooling setup, but are not part of the core application logic migration).

**Files to be Converted:**
- ./src/js/helpers/userStateUtils.js
- ./src/js/helpers/dataUtils.js
- ./src/js/helpers/apiUtils.js
- ./src/js/helpers/deckManager.js
- ./src/js/data/dbUserState.js
- ./src/js/data/database.js
- ./src/js/data/dbSyncOperations.js
- ./src/js/data/dbCore.js
- ./src/js/utils/connectivity.js
- ./src/js/ui/uiElements.js
- ./src/js/ui/uiUpdaters.js
- ./src/js/ui/uiInitializers.js
- ./src/sw.js
- ./src/main.js
- ./src/app.js

**Next Steps:**
- Await further instructions to begin the conversion process.