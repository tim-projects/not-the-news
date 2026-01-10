# Current Task: Interaction Assessment & Scaling

## Objectives

### 1. Comprehensive Interaction Assessment
- [x] **Goal:** Document and verify every possible user interaction for UX consistency.
- [x] **Phase 1: Identification:** `interaction-report.md` created.
- [x] **Phase 2: Automated Verification:** Completed via comprehensive test suite.
    - `tests/interaction_search_help.spec.js`: Global UI (Search, Help, Title, Scroll).
    - `tests/interaction_feed_item.spec.js`: Item selection, actions (Star/Read), images, links.
    - `tests/interaction_settings.spec.js`: Modal navigation, state persistence, RSS edits.
    - `tests/interaction_shortcuts.spec.js`: Navigation (j/k), sub-element focus (h/l), actions (r/s/u/t).
    - `tests/interaction_more.spec.js`: Advanced actions (Enter/o), TTS (p), Undo (Ctrl+Z), and deeper Settings (Blacklist, Backup).
- [x] **Deliverables:** `interaction-report.md` finalized and `interaction-assessment/` folder populated with verification artifacts.

## Progress & Findings
- **Progress:** Automated verification is 100% complete. Every interaction listed in `interaction-report.md` has been verified via Playwright tests.
- **Findings:**
    - **Compression Bug Fixed:** Identified and resolved a critical issue where compressed user state (e.g., `currentDeckGuids`) was not being decompressed when pulled from the server, causing corrupted local state and broken "Undo" functionality.
    - **Missing ID Added:** Restored the `settings-modal` ID to `src/index.html` to ensure reliable test targeting and UI consistency.
    - **TTS Reliability:** Implemented `speechSynthesis` mocking in tests to prevent "synthesis-failed" errors in headless environments while still verifying the internal application state changes.
    - **Link Click Race Condition:** Fixed via `$nextTick` in `src/main.ts` (as reported previously).
    - **Selection Pattern:** Confirmed "Selection First" logic for links and buttons on items not fully in view.
    - **Navigation Memory:** `lastSelectedGuid` correctly maintains focus context during view switches.

## Next Steps
- [ ] Finalize the report with any minor visual regressions found (none so far).
- [ ] Move on to "Hybrid Storage" architecture planning.

### 2. Hybrid Storage (Pointer Support) - *Requires Permission*
- [ ] **Goal:** Prepare architecture for Firestore + Cloudflare R2 offloading for very large datasets (>800KB compressed).

## Strategy for 100,000 GUIDs per User
1. **Binary JSON Compression:** (Complete) Reduce 3.6MB raw data to ~400KB.
2. **Delta Sync:** (Complete) Only download changes.
3. **Serial Sync Queue:** (Complete) Prevent request flooding.
4. **Dev Bypass:** (Complete) In-memory dev storage to avoid cloud throttling during tests.
5. **Integer Mapping:** (Planned) Store 4-byte integers instead of full GUID strings.