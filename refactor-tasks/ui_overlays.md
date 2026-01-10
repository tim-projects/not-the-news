# Refactor Task: Create `src/js/ui/overlays.ts`

## Context
We are extracting overlay/modal management logic from `src/main.ts`.

## Source File
- `src/main.ts`

## Target File
- `src/js/ui/overlays.ts`

## Instructions
1.  **Read `src/main.ts`** to locate the following functions:
    - `toggleSearch`
    - `updateAllUI` (if it primarily updates UI state)
    - `_reconcileAndRefreshUI` (calls loadAndDisplayDeck and updateAllUI)

2.  **Create `src/js/ui/overlays.ts`**.

3.  **Add Imports**:
    - `import { AppState } from '@/types/app.ts';`
    - `import { loadAndDisplayDeck } from '../controllers/deck.ts';` (You might need to create this later, or import from main if circular. For now, assume it will be in controllers/deck.ts or similar).
    - `import { updateCounts } from './uiUpdaters.ts';`

4.  **Extract and Export Functions**:
    - `toggleSearch(app: AppState)`
    - `updateAllUI(app: AppState)`: calls `app.updateCounts()` (or imported `updateCounts(app)`).
    - `_reconcileAndRefreshUI(app: AppState)`

5.  **Refactor**: Replace `this` with `app`.
