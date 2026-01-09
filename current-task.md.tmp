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
- [ ] **Deliverables:** `interaction-report.md` finalized and `interaction-assessment/` folder populated with verification artifacts.

## Progress & Findings
- **Progress:** Automated verification is 95% complete. Core UX flows, edge cases (partial visibility), and keyboard accessibility are fully verified.
- **Findings:**
    - **Link Click Race Condition:** Identified and fixed a bug where links in `entry.description` were sometimes missing click listeners because `x-html` rendering hadn't completed before `x-init` fired.
        - *Fix:* Wrapped `handleEntryLinks` logic in `this.$nextTick` in `src/main.ts`.
        - *Verified:* `Feed Item: Link Clicks coverage logic` test now reliably detects "Low coverage" selection behavior and "High coverage" navigation (popup).
    - **Selection Pattern:** Confirmed "Selection First" logic for links and buttons on items not fully in view.
    - **Keyboard Accessibility:** Sub-element focus (h/l keys) allows precise control over Star/Read/Play actions without a mouse.
    - **Navigation Memory:** `lastSelectedGuid` correctly maintains focus context during view switches.
    - **Undo Reliability:** Verified that `u` and `Ctrl+Z` reliably restore items with correct position memory.
    - **Settings Integrity:** Verified that sub-menu navigation (Appearance -> Main) and form persistence work as expected.

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