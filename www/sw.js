const cacheName = 'not-the-news-v3'; // IMPORTANT: Increment this cacheName for new SW versions!
const cacheAssets = [
  '/', // Include the root path
  'index.html',
  'login.html',
  'css/content.css',
  'css/buttons.css',
  'css/forms.css',
  'css/layout.css',
  'css/modal.css',
  'css/variables.css',
  'css/fonts/Playfair_Display.ttf',
  'images/placeholder.svg',
  'images/favicon.svg',
  'images/icon-192.png',
  'images/icon-512.png',
  'js/app.js',
  'js/data/appState.js',
  'js/data/database.js',
  'js/helpers/apiUtils.js',
  'js/helpers/dataUtils.js',
  'js/helpers/userStateUtils.js',
  'js/ui/uiElements.js',
  'js/ui/uiInitializers.js',
  'js/ui/uiUpdaters.js',
  'libs/alpine.3.x.x.js',
  'libs/idb.js',
  'libs/rss-parser.min.js'
];

self.addEventListener('install', function(event) {
  console.log('[Service Worker] Installing Service Worker ...', event);
  event.waitUntil(
    caches.open(cacheName)
      .then(function(cache) {
        console.log('[Service Worker] Caching all app shell and core content');
        return cache.addAll(cacheAssets);
      })
      .catch(function(error) {
        console.error('[Service Worker] Failed to cache initial assets:', error);
      })
  );
});

self.addEventListener('activate', function(event) {
  console.log('[Service Worker] Activating Service Worker ....', event);
  event.waitUntil(
    caches.keys().then(function(keyList) {
      return Promise.all(keyList.map(function(key) {
        if (key !== cacheName) {
          console.log('[Service Worker] Deleting old cache:', key);
          return caches.delete(key);
        }
      }));
    }).then(function() {
      // Ensure the new SW controls clients immediately
      return self.clients.claim();
    }).then(function() {
        // Force all open clients to reload to ensure they are controlled by the new SW.
        // This is the mechanism that replaces the removed app.js 'controllerchange' listener.
        self.clients.matchAll({ type: 'window' }).then(function (clients) {
            clients.forEach(function (client) {
                // Only reload if the client is still visible and the URL matches
                // and it's not already controlled by *this* SW instance's scriptURL (avoid self-reloads)
                if (client.url && client.visibilityState === 'visible' && client.url.startsWith(self.location.origin) && !client.url.includes(self.location.origin + '/sw.js')) {
                    console.log('[Service Worker] Forcing client reload for:', client.url);
                    client.navigate(client.url); // Reloads the current page
                }
            });
        });
    })
  );
});

self.addEventListener('fetch', function(event) {
  const requestUrl = new URL(event.request.url);

  // Serve static assets from cache first, then network
  if (cacheAssets.includes(requestUrl.pathname) || cacheAssets.includes(requestUrl.pathname.slice(1))) { // Handle both with and without leading slash
    event.respondWith(
      caches.match(event.request).then(function(response) {
        if (response) {
          console.log('[Service Worker] Cache hit (static asset) for:', requestUrl.href);
          return response;
        }
        console.log('[Service Worker] Cache miss (static asset) for:', requestUrl.href, 'Falling back to network.');
        return fetch(event.request);
      })
    );
    return; // Stop processing this fetch event if it's a static asset
  }

  // Handle API calls and other dynamic requests
  // Only cache GET requests that are successful and basic type (same-origin)
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then(function(cachedResponse) {
        // Return cached response if found
        //if (cachedResponse) {
        //  console.log('[Service Worker] Cache hit (dynamic GET) for:', requestUrl.href);
        //  return cachedResponse;
        //}

        //console.log('[Service Worker] Cache miss (dynamic GET) for:', requestUrl.href);
        // If not in cache, fetch from network
        return fetch(event.request).then(function(networkResponse) {
          // Check if we received a valid response to cache
          // Do not cache:
          // - Responses that are not OK (e.g., 404, 500)
          // - Opaque responses (cross-origin without CORS headers, like some images or fonts)
          // - Specific API endpoints that should always be fresh (e.g., /user-state, /time)
          // - Images that might be very large or change frequently (like external preview images)
          const shouldCache = networkResponse.ok &&
                              networkResponse.status === 200 &&
                              networkResponse.type === 'basic' && // 'basic' for same-origin, 'opaque' for cross-origin.
                              !requestUrl.pathname.includes('/user-state') && // Exclude user-state from generic caching
                              !requestUrl.pathname.includes('/time') && // Exclude time endpoint from generic caching
                              !requestUrl.pathname.includes('/items'); // Exclude /items from generic GET caching if it's dynamic
                                                                      // and fetched frequently by the app to ensure freshness.
                                                                      // If /items is only read from IndexedDB, this might not be needed.
                                                                      // Consider whether /items should be cached here based on its usage.

          if (shouldCache) {
            // IMPORTANT: Clone the response because a response can only be consumed once.
            const responseToCache = networkResponse.clone();
            caches.open(cacheName).then(function(cache) {
              cache.put(event.request, responseToCache);
              console.log('[Service Worker] Caching new response for:', requestUrl.href);
            });
          } else {
            console.log('[Service Worker] Not caching response for:', requestUrl.href, ' (Status:', networkResponse.status, ', Type:', networkResponse.type, ', OK:', networkResponse.ok, ')');
          }
          return networkResponse;
        }).catch(function(err) {
          // This catch handles network errors (e.g., user is offline, DNS lookup failed), not HTTP errors (like 404).
          console.error('[Service Worker] Network fetch failed for GET:', requestUrl.href, err);
          // For GET requests that fail, you might want to serve an an offline page or specific fallback.
          // For now, re-throwing to let your app's initApp catch it if it's a critical API call.
          throw err;
        });
      })
    );
  } else {
    // For non-GET requests (POST, PUT, DELETE), always go to the network and do not cache.
    console.log('[Service Worker] Network-only fetch for non-GET request:', event.request.method, requestUrl.href);
    event.respondWith(fetch(event.request).catch(function(err) {
      console.error('[Service Worker] Network fetch failed for non-GET:', requestUrl.href, err);
      throw err; // Re-throw to propagate the error to the main thread
    }));
  }
});