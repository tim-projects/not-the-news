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
