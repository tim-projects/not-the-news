# Current Task

**Task:** Add a new feature to allow users to mark items as 'read' or 'unread'.

**Goal:** Implement a mechanism for users to toggle the read/unread status of news items.

**Sub-tasks:**
1.  **Frontend (UI):** Add a visual indicator and a clickable element (e.g., a button or icon) to each news item in the UI.
    *   **Status:** Complete. The `read-toggle` button and `isRead` function are in place, and `src/css/content.css` contains styles for `.item.entry.read` and `.read-toggle.read` to provide visual feedback.
2.  **Frontend (Logic):** Implement JavaScript to handle click events, update the UI, and send the status change to the backend.
    *   **Status:** Complete. The `toggleRead` function in `src/main.js` handles the click event, updates the state, and calls `toggleItemStateAndSync` which is responsible for syncing with the backend.
3.  **Backend (API):** Create or modify an API endpoint to receive the read/unread status and update the database.
    *   **Status:** Complete. The `post_user_state` endpoint in `src/api.py` already handles `readDelta` operations, and the `get_single_user_state_key` endpoint serves the `read` state.
4.  **Database:** Add a field to the news item schema to store the read/unread status.
    *   **Status:** Complete. The backend uses `read.json` in `/data/user_state` to store the 'read' status, consistent with other user states.
5.  **Testing:** Write Playwright tests to ensure the feature works correctly.
    *   **Status:** In Progress (Blocked).

**Progress:**
- Frontend UI: Complete
- Frontend Logic: Complete
- Backend API: Complete
- Database: Complete
- Testing: Blocked - Playwright tests are timing out because no feed items are loading in the application under test.

**Identified Problem (Refined):**
- The application under test is not loading any feed items, causing the Playwright tests to time out while waiting for elements that depend on loaded data.
- `feed.xml` exists and contains data on the backend.
- The frontend's `performBackgroundSync()` function (which fetches feed data) is not being executed.
- The `console.log` added inside the `if (this.isOnline && this.syncEnabled)` block in `initApp` (in `src/main.js`) did not appear in the previous test run, indicating the condition `(this.isOnline && this.syncEnabled)` is `false`.
- A `console.log` has been added *before* the `if (this.isOnline && this.syncEnabled)` condition in `initApp` (in `src/main.js`) to explicitly log the values of `this.isOnline` and `this.syncEnabled` right before the check.

**Next Steps:**
1.  Run Playwright tests again to capture this new log output.
2.  Based on the log output, determine the root cause (e.g., `navigator.onLine` returning `false` in the test environment, or `syncEnabled` being unexpectedly `false`).
3.  Implement a fix to ensure feed items are loaded in the test environment. This might involve:
    *   Forcing `navigator.onLine` to `true` in Playwright.
    *   Ensuring `syncEnabled` is always `true` for tests.
    *   Mocking the API calls to `/api/feed-guids` and `/api/feed-items` in Playwright to provide dummy data, bypassing the actual backend if network issues are suspected in the test environment.