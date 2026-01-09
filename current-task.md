# Current Task: Interaction Assessment & Scaling

## Objectives

### 1. Comprehensive Interaction Assessment
- [ ] **Goal:** Document and verify every possible user interaction for UX consistency.
- [x] **Phase 1: Identification:** `interaction-report.md` created.
- [/] **Phase 2: Automated Verification:** `tests/interaction_assessment.spec.js` updated with robust selectors and async handling. Initial tests (Search, Navigation, Shortcuts) are passing locally.
- [ ] **Deliverables:** `interaction-report.md` and `interaction-assessment/` folder with verified logs.

### 2. Hybrid Storage (Pointer Support) - *Requires Permission*
- [ ] **Goal:** Prepare architecture for Firestore + Cloudflare R2 offloading for very large datasets (>800KB compressed).

## Strategy for 100,000 GUIDs per User
1. **Binary JSON Compression:** (Complete) Reduce 3.6MB raw data to ~400KB.
2. **Delta Sync:** (Complete) Only download changes.
3. **Serial Sync Queue:** (Complete) Prevent request flooding.
4. **Dev Bypass:** (Complete) In-memory dev storage to avoid cloud throttling during tests.
5. **Integer Mapping:** (Planned) Store 4-byte integers instead of full GUID strings.
