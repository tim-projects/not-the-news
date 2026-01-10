# Refactor Task: Create `src/js/ui/observers.ts`

## Context
We are extracting `IntersectionObserver` logic for scrolling and images.

## Source File
- `src/main.ts`

## Target File
- `src/js/ui/observers.ts`

## Instructions
1.  **Read `src/main.ts`** to locate:
    - `observeImage`
    - `_initImageObserver`
    - `_initScrollObserver`
    - `_initObservers` (stale item observer)

2.  **Create `src/js/ui/observers.ts`**.

3.  **Add Imports**:
    - `import { AppState } from '@/types/app.ts';`

4.  **Extract and Export Functions**:
    - `observeImage(app: AppState, el: HTMLImageElement)`
    - `_initImageObserver(app: AppState)`
    - `_initScrollObserver(app: AppState)`
    - `_initObservers(app: AppState)`

5.  **Refactor**: Replace `this` with `app`. Ensure `app.imageObserver`, `app.scrollObserver`, etc. are updated correctly.
