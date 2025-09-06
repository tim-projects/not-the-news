### 15. Entire Deck Vanishes After Closing Item

*   **Description:** When a user closes an item in the unread deck, the entire current deck vanishes from the UI. This indicates an issue with how the deck state is being managed after an item is hidden or removed.
*   **Status:** Unresolved.


## Offline Loading Issue

**Issue:** The application no longer loads when offline. This is a regression, as the app is a PWA and should function offline.

**Efforts:**
1.  **Service Worker Analysis:** Examined `www/sw.js` (a minified Workbox service worker) to understand its precaching strategy. It appeared to be caching essential HTML, CSS, and JS assets.
2.  **Vite PWA Configuration Investigation:** Analyzed `vite.config.js` to understand how the service worker is generated using `vite-plugin-pwa`.
3.  **Configuration Attempts:** Attempted various configurations for `srcDir` and `filename` within the `VitePWA` plugin to correctly point to the service worker source file (`src/sw.js`) and ensure proper asset caching relative to the build output (`www` directory). The following combinations were tried:
    *   `srcDir: 'www'`, `filename: 'src/sw.js'`
    *   `srcDir: 'src'`, `filename: 'sw.js'`
    *   `srcDir: '.'`, `filename: 'src/sw.js'`
    *   Moving `src/sw.js` to `public/sw.js` and removing `srcDir` and `filename` (relying on defaults).
    *   `srcDir: 'public'`, `filename: 'sw.js'`
4.  **Build Attempts:** After each configuration change, `npm run build` was executed to rebuild the application and generate the service worker.

**Stuck Point:**
Despite numerous attempts and consulting the `vite-plugin-pwa` documentation, the build consistently failed with the error: `Could not resolve entry module "src/src/sw.js"` (or similar variations depending on the `srcDir` and `filename` combination). It appears that the `root` directory (`src/`) is being prepended to the `filename` path, regardless of the `srcDir` setting, leading to an incorrect module resolution path for the service worker source file. I was unable to find a configuration that resolves this build error. Inspect the Caddyfile to ensure this isn't causing the problem.

The test `should mark an item as read and unread` is still failing.

**Current Problem:**
The test is failing on the line `await expect(page.locator(`#items > .item[data-guid="${initialGuid}"].read`)).toBeVisible();`.
The error message is `Received: <element(s) not found>`.

**Analysis of Console Logs:**
The console logs from the browser (from `src/main.js`) clearly show that the `read` class *is* being added to the element:
```
Browser console log: [toggleRead] itemElement classList BEFORE toggle: item entry
Browser console log: [toggleRead] itemElement classList AFTER toggle: item entry read
```
This means the JavaScript code is successfully manipulating the DOM.

**Discrepancy:**
There is a discrepancy between what the browser's `classList` reports and what Playwright's `locator` is finding. Playwright is unable to find an element with both the `data-guid` and the `read` class, even though the browser's console indicates the class was added.

**Mitigations Attempted:**
1.  **Global find and replace of "hidden" with "read":** Completed.
2.  **Cleaning up duplicate properties and functions in `src/main.js`:** Completed.
3.  **Forcing reactivity with `$watch` and reassigning `this.deck`:** Reverted, as it didn't resolve the issue and added complexity.
4.  **Explicitly calling `updateAllUI()` which calls `loadAndDisplayDeck()`:** This is the current state, and `loadAndDisplayDeck` is confirmed to be called.
5.  **Directly manipulating the `deck` array and using `$nextTick`:** Reverted, as it didn't resolve the issue and added complexity.
6.  **Directly manipulating the class on the element:** Reverted, as it conflicted with Alpine.js's reactivity.
7.  **Adding `waitForLoadState` and `waitForTimeout` in tests:** `waitForTimeout` is still present in the test, but it doesn't seem to be sufficient.
8.  **Changing assertions to use more specific locators:** Implemented, but the element is still not found.
9.  **Adding `deckKey` to force re-render of `main` tag:** Reverted, as it didn't resolve the issue and added complexity.
10. **Explicitly reassigning `this.deck = [...this.deck]` in `toggleRead`:** This was the last attempt to force reactivity, but it also didn't work.
11. **Changing `:class` binding to directly use `this.read.some(r => r.guid === entry.guid)`:** Implemented, and the `isRead` function was removed.

**Hypothesis:**
The most likely cause is that Alpine.js is re-rendering the element and overwriting the directly manipulated class. My direct manipulation of `itemElement.classList.toggle('read')` is a temporary change that gets undone by Alpine.js's reactivity.

The problem is that even though `this.read` is updated, and `this.deck` is re-created in `loadAndDisplayDeck`, Alpine.js's `x-for` loop is not reacting to the changes in the `isRead` property of the items within the `deck` array, or the `filteredEntries` getter is not causing a re-render of the `x-for` loop.

**Mitigation for Blockages:**
I am stuck. I have tried multiple approaches to force Alpine.js to re-render the UI based on the updated `read` state, but none have been successful. The console logs confirm that the data is being updated and the class is being applied, but Playwright cannot see it. This suggests a deeper issue with Playwright's interaction with Alpine.js or a very subtle timing issue that I haven't been able to pinpoint.

**Alternative Solutions:**
1.  **Investigate Playwright's debugging tools more deeply:** Use Playwright's trace viewer to see exactly what's happening in the browser at the time of the assertion.
2.  **Simplify the Alpine.js setup for testing:** Create a minimal Alpine.js app that only handles the read/unread state and test that with Playwright to isolate the issue.
3.  **Consider a different testing strategy:** Instead of asserting on the class, assert on the number of visible items in the "Unread" view, and then switch to "All" view and assert on the number of "read" items. This would bypass the direct class assertion.