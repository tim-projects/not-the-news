# Task: JSON Compression and Scaling Strategy

## Recent Fixes: Empty Items & Dev Stability
- [x] **Bug: Empty items in deck:** Resolved by implementing robust GUID filtering across the stack (frontend mapping, deck generation, shuffle processing, and backend sync pull).
- [x] **Backend Stability (Dev):** Implemented an in-memory storage fallback in the worker for development mode. This bypasses Firestore during intensive automated testing to avoid 429 (Too Many Requests) throttling.
- [x] **CORS & OPTIONS:** Ensured all worker responses (including 401s and errors) include CORS headers and implemented a proper 204 response for OPTIONS preflight requests.
- [x] **Request Flooding:** Implemented a serial promise queue for `pullUserState` in the frontend to prevent concurrent sync operations from overwhelming the backend.

## Objectives

### 1. Compression Utility
- [x] **Goal:** Create a TypeScript utility using the native `CompressionStream` API for Gzip compression and Base64 encoding.
- [x] **Importance:** Foundation for scaling. Compression reduces GUID lists by 80-90%, fitting large histories within Firestore limits.

### 2. Frontend Update
- [x] **Goal:** Modify `queueAndAttemptSyncOperation` to compress large payloads before POSTing to the cloud.
- [x] **Importance:** Reduces upload size and ensures sync doesn't fail due to Firestore document limits.

### 3. Worker Update
- [x] **Goal:** Update the backend to detect, store, and decompress binary blobs.
- [x] **Importance:** Enables server-side logic on compressed data and supports transparent decompression for clients.

### 4. Database Migration
- [x] **Goal:** Implement transparent upgrade of existing keys to the compressed format.
- [x] **Importance:** Automatically upgrades user data to the optimized format upon next sync.

### 5. Deck Transition Optimization
- [x] **Goal:** Eliminate the delay when the last item in a deck is marked read.
- [x] **Importance:** Background refresh during undo countdown ensures seamless transition to the next batch.

### 6. Delta-Only Synchronization
- [x] **Goal:** Implementation of hash-based diffing to avoid large downloads.
- [x] **Importance:** Drastically reduces bandwidth by only syncing what changed since the last known state.

### 9. Comprehensive Interaction Assessment
- [ ] **Goal:** Document and verify every possible user interaction for UX consistency.
- [x] **Phase 1: Identification:** `interaction-report.md` created.
- [/] **Phase 2: Automated Verification:** `tests/interaction_assessment.spec.js` updated with robust selectors and async handling. Initial tests (Search, Navigation, Shortcuts) are passing locally.
- [ ] **Deliverables:** `interaction-report.md` and `interaction-assessment/` folder with verified logs.

### 11. Original Theme Conflicts
- [x] **Goal:** Fix bug where Original themes were overridden.
- [x] **Fix:** Improved `applyThemeStyle` to purge old classes and added explicit variable blocks in `variables.css`. Verified with `tests/theme_regression.spec.js`.

### 12. Hybrid Storage (Pointer Support) - *Requires Permission*
- [ ] **Goal:** Prepare architecture for Firestore + Cloudflare R2 offloading for very large datasets (>800KB compressed).

## Strategy for 100,000 GUIDs per User
1. **Binary JSON Compression:** (Complete) Reduce 3.6MB raw data to ~400KB.
2. **Delta Sync:** (Complete) Only download changes.
3. **Serial Sync Queue:** (Complete) Prevent request flooding.
4. **Dev Bypass:** (Complete) In-memory dev storage to avoid cloud throttling during tests.
5. **Integer Mapping:** (Planned) Store 4-byte integers instead of full GUID strings.