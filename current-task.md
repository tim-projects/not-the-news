# Current Task: Fix Regressions and Restore Animations

## Objectives
Restore core UX behaviors that have regressed during recent refactors, specifically keyboard scrolling and interaction animations.

## Status
- [x] **Scroll Regression:** 
    - [x] Restore reliable `scrollSelectedIntoView` logic using `window.scrollTo`.
    - [x] Create Playwright test `tests/scroll.spec.js` to verify keyboard navigation scrolling.
- [ ] **Mark as Read Animation:**
    - [ ] Restore `readingGuid` state in `AppState`.
    - [ ] Restore SVG outline "drawing" animation for read and star buttons.
    - [ ] Verify animations with Playwright trace/screenshot.
- [ ] **File Size Management:**
    - [ ] Refactor `src/main.ts` (currently ~2468 lines) into smaller modules to comply with 500-line limit.
    - [ ] Targets: `themeHandler.ts`, `interactionManager.ts`, `demoManager.ts`.

## Verification
- [x] Run `tests/scroll.spec.js` locally.
- [ ] Run `tests/demo.spec.js` to ensure no side effects.
- [x] Deploy to dev-news for final human verification.
