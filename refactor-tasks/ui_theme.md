# Refactor Task: Create `src/js/ui/theme.ts`

## Context
We are extracting theme and visual preference logic from `src/main.ts` to reduce its size.

## Source File
- `src/main.ts`

## Target File
- `src/js/ui/theme.ts`

## Instructions
1.  **Read `src/main.ts`** to locate the following functions inside the `rssApp` object:
    - `loadThemeStyle`
    - `updateThemeAndStyle`
    - `saveThemeStyle`
    - `applyThemeStyle`
    - `loadFontSize`
    - `saveFontSize`
    - `applyFontSize`
    - `loadFeedWidth`
    - `saveFeedWidth`
    - `applyFeedWidth`
    - `loadAnimationSpeed`
    - `saveAnimationSpeed`
    - `applyAnimationSpeed`
    - `loadCustomCss`
    - `saveCustomCss`
    - `resetCustomCss`
    - `generateCustomCssTemplate`
    - `applyCustomCss`
    - `saveFonts`
    - `applyFonts`
    - `preloadThemes`

2.  **Create `src/js/ui/theme.ts`**.

3.  **Add Imports**:
    - `import { AppState } from '@/types/app.ts';`
    - `import { saveSimpleState, loadSimpleState } from '../data/dbUserState.ts';`
    - `import { createStatusBarMessage } from './uiUpdaters.ts';`
    - *Note: Check if `createStatusBarMessage` is in `uiUpdaters.ts`. If not, find where it is or leave it as a TODO if circular dependency arises (though it should be fine).*

4.  **Extract and Export Functions**:
    - Copy the body of each function listed above.
    - Convert them to exported standalone functions.
    - **Crucial**: Ensure the first argument is `app: AppState`.
    - Example transformation:
      ```typescript
      // In src/main.ts:
      applyThemeStyle: function() { ... }

      // In src/js/ui/theme.ts:
      export function applyThemeStyle(app: AppState): void { ... }
      ```
    - Replace references to `this` with `app`.

5.  **Verify**: Ensure all variables used (like `app.theme`, `app.fontSize`) exist on the `AppState` interface.
