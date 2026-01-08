# Task: JSON Compression and Scaling Strategy

## Objectives

### 1. Compression Utility
- [x] **Goal:** Create a TypeScript utility using the native `CompressionStream` API for Gzip compression and Base64 encoding.
- [x] **Importance:** This is the foundation for scaling. Large arrays (like `read` history) can grow beyond Firestore's 1MB document limit. Compression typically reduces GUID lists by 80-90%, buying significant headroom.

### 2. Frontend Update
- [x] **Goal:** Modify `queueAndAttemptSyncOperation` to compress large payloads before POSTing to the cloud.
- [x] **Importance:** Ensures that heavy state updates don't fail due to size limits and reduces the amount of data the user's device needs to upload, improving performance on flakey connections.

### 3. Worker Update
- [x] **Goal:** Update the backend to detect, store, and decompress binary blobs.
- [x] **Importance:** Enables the server to understand the compressed data coming from clients and allows it to perform its own server-side logic (like keyword filtering or delta calculations) on the full dataset.

### 4. Database Migration
- [x] **Goal:** Implement transparent upgrade of existing keys to the compressed format.
- [x] **Importance:** Ensures that existing users don't lose their history. The app will automatically "upgrade" their cloud data to the new optimized format the next time they sync.

### 5. Deck Transition Optimization (Completed)
- [x] **Goal:** Eliminate the delay when the last item in a deck is marked read.
- [x] **Importance:** Triggers deck generation/refresh in the background during the 5-second undo countdown, ensuring the next deck is ready to display instantly after the undo notification expires.

### 6. Delta-Only Synchronization
- [x] **Goal:** Implementation of hash-based diffing to avoid large downloads.
- [x] **Importance:** Prevents the app from downloading the entire 100,000 item list every time a sync occurs. The client will only request what has changed since its last known state, drastically reducing bandwidth and battery usage.

### 7. Bug Investigation: Images Not Displaying
- [ ] **Goal:** Fix the regression where images are no longer appearing in the feed.
- [ ] **Findings:** 
    - Commit `f74539f` introduced logic to extract the first image from the description into a separate `image` property and remove it from the HTML to prevent duplicates.
    - The worker's `prettifyItem` function now removes the image tag entirely using a global regex.
    - On the client side, `mapRawItem` attempts to extract the image again, and if not found in the description, it falls back to the `item.image` property.
    - Possible causes:
        1. The client-side `IntersectionObserver` (`imageObserver`) is failing to trigger for dynamically loaded deck items.
        2. The worker-provided `image` property is being lost during the transition from minimized `deltaItems` to full items from `/api/list`.
        3. The client-side `mapRawItem` incorrectly resolves relative URLs when using `DOMParser`.
- [ ] **Mitigation:**
    - Verify `item.image` presence in the `/api/list` response.
    - Debug `IntersectionObserver` initialization and firing.
    - Check for CSS rules that might be inadvertently hiding the `title-image`.

### 8. GUID Optimization
- [ ] **Goal:** Map URL GUIDs to compact integers for massive state support.
- [ ] **Importance:** Storing a 100-character URL GUID 100,000 times is inefficient. Mapping these to 4-byte integers provides an immediate 25x reduction in raw data size before compression is even applied.

### 8. Hybrid Storage (Pointer Support) - *Requires Permission*
- [ ] **Goal:** Prepare architecture for Firestore + Cloudflare R2 hybrid storage.
- [ ] **Importance:** Once a compressed document nears the 1MB Firestore limit, we move the blob to R2 and store only a pointer in Firestore. This provides an unlimited scaling path for "power users" while keeping costs effectively zero.

## Strategy for 100,000 GUIDs per User (1,000 Users)
1. **Binary JSON Compression:** Use Gzip to reduce 3.6MB raw GUID lists to ~400KB, fitting within Firestore's 1MB limit.
2. **Delta Sync:** Download only what changed since the last known timestamp.
3. **Integer Mapping:** Store 4-byte integers instead of 36+ byte strings.
4. **Cloudflare R2 Offloading (Future):** Move blobs > 800KB to R2, leaving only a pointer in Firestore.

## Context
- **Goal:** Download enough items for 20 decks/day (200 items) and stay within free/low-cost tiers.
- **Constraints:** 1MB Firestore document limit, subrequest limits, and bandwidth efficiency.