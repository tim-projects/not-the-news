# Future Features & Enhancements

- the search box should have clickable up and down bittons on the right side to select items that have been found (similar to using the uo and down arrow keys)
- when marking an item as read it correctly selects the next item, but the scroll isnt quite right the top of the item goes off the screen. instead, the top border of the newly selelected item ahoukd always be in the view area.

## Text-to-Speech Enhancements
- Control speed/voice with utterance.rate and utterance.voice, pausing via speechSynthesis.pause(). Add event listeners for article load to auto-read or use a shortcut like 'v'.

---

## Reader View / Extractor Integration
- `o` key opens the website article in the right side pane (using the extractor).
- `Shift+o` opens the website in a new tab.
- Folders for website-specific extractor modules or a generic extraction module.
- Expose per-website settings to users for custom extraction rules (with upstream submission support).

---

## Play Icon Visibility Scroll
- If using keyboard navigation and an item description is long, ensure the "Play" icon is scrolled into view when selected.
- Logic: Only scroll if the bottom of the item (or the icon itself) is currently off-screen.# Task: Codebase Analysis & Refactoring Preparation

## Goal
Analyze the current codebase to identify large files (>300 lines) and complex dependencies to plan a modular refactor. The ultimate goal is to improve maintainability and support future AI-driven development.

## Progress
- [x] **Generate Functions Map:**
    - Created `FUNCTIONS-MAP.md` which lists every file in `src/` and `worker/src/`, their functions, and line counts.
    - **Identified Critical Candidates for Refactoring:**
        - `src/main.ts`: 2083 lines (God Object)
        - `worker/src/index.ts`: ~460 lines
        - `src/js/data/dbSyncOperations.ts`: ~450 lines
        - `src/js/helpers/dataUtils.ts`: ~350 lines
        - `src/js/helpers/keyboardManager.ts`: ~320 lines
- [x] **Immediate Fixes:**
    - Fix wrong URL on Reddit/Wired titles.
    - Implement hidden pop-up bar for sync status.
    - Unified build and deployment script (`build.sh`).

## Next Steps
- [ ] **Review FUNCTIONS-MAP.md:** Use the report to design a new repository structure.
- [ ] **Plan Refactor:** Create a detailed plan to split `src/main.ts` and other large files.
