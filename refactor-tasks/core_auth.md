# Refactor Task: Create `src/js/core/auth.ts`

## Context
Extracting authentication-related actions.

## Source File
- `src/main.ts`

## Target File
- `src/js/core/auth.ts`

## Instructions
1.  **Read `src/main.ts`** to locate:
    - `logout`
    - `changePassword`
    - `submitPasswordChange`
    - `deleteAccount`
    - `resetApplicationData` (Since it wipes data, often related to account resets)

2.  **Create `src/js/core/auth.ts`**.

3.  **Add Imports**:
    - `import { AppState } from '@/types/app.ts';`
    - `import { auth } from '../data/dbAuth.ts';` (Verify exact path)
    - `import { createStatusBarMessage } from '../ui/uiUpdaters.ts';`
    - `import { closeDb, initDb } from '../data/dbCore.ts';`
    - `import { pullUserState } from '../data/sync/state.ts';` (Future path, might need adjustment)

4.  **Extract and Export Functions**:
    - `logout(app: AppState)`
    - `changePassword(app: AppState)`
    - `submitPasswordChange(app: AppState)`
    - `deleteAccount(app: AppState)`
    - `resetApplicationData(app: AppState)`

5.  **Refactor**: Replace `this` with `app`.
