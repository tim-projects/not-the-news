// www/sw.js

const cacheName = 'not-the-news-v8'; // IMPORTANT: Incremented cacheName to v8 for new SW version!
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
  // 'css/fonts/Playfair_Display.ttf', // This is commented out as we are caching the online Google Fonts version
  'images/placeholder.svg',
  'images/favicon.svg',
  'images/icon-192.png',
  'images/icon-512.png',
  'js/app.js',
  'js/data/appState.js',
  // 'js/data/database.js', // REMOVED from cacheAssets as it's now imported as a module
  'js/helpers/apiUtils.js',
  'js/helpers/dataUtils.js',
  'js/helpers/userStateUtils.js',
  'js/ui/uiElements.js',
  'js/ui/uiInitializers.js',
  'js/ui/uiUpdaters.js',
  'js/libs/alpine.3.x.x.js',
  'js/libs/idb.js',
  'js/libs/rss-parser.min.js',
  'manifest.json' // Added manifest.json to cache assets
];

// --- MODIFIED: Use standard ES Module import to bring in functions from database.js ---
import { processPendingOperations, isOnline, getDb, loadSimpleState, saveSimpleState, pullUserState, performFeedSync } from './js/data/database.js';

self.addEventListener('install', function(event) {
  console.log('[Service Worker] Installing Service Worker ...', event);
  event.waitUntil(
    caches.open(cacheName)
      .then(function(cache) {
        console.log('[Service Worker] Caching all app shell and core content');
        // Use Promise.all with individual cache.add for better error reporting
        return Promise.all(cacheAssets.map(function(url) {
          return cache.add(url).catch(function(error) {
            console.error('[Service Worker] Failed to cache:', url, error);
            // Re-throw the error to cause the install event to fail if any critical asset fails
            throw error;
          });
        }));
      })
      .then(function() {
        console.log('[Service Worker] All core assets cached successfully!');
      })
      .catch(function(error) {
        console.error('[Service Worker] Installation failed overall:', error);
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
        self.clients.matchAll({ type: 'window' }).then(function (clients) {
            clients.forEach(function (client) {
                if (client.url && client.visibilityState === 'visible' && client.url.startsWith(self.location.origin) && !client.url.includes(self.location.origin + '/sw.js')) {
                    console.log('[Service Worker] Forcing client reload for:', client.url);
                    client.navigate(client.url); // Reloads the current page
                }
            });
        });
    })
  );
});

// --- NEW: Sync Event Listener for background data synchronization ---
self.addEventListener('sync', function(event) {
    console.log('[SW-SYNC] Sync event triggered:', event.tag);
    if (event.tag === 'data-sync') { // This tag should match what you register on the client side
        event.waitUntil(processPendingOperations()); // Calls the function imported from database.js
    }
});

self.addEventListener('fetch', function(event) {
  const requestUrl = new URL(event.request.url);
  const requestMethod = event.request.method;

  // --- NEW: Handle navigation requests (e.g., refreshing the page) first ---
  // This is crucial for fixing "Site can't be reached" when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request).then(function(response) {
        if (response) {
          console.log('[Service Worker] Cache hit (navigation) for:', requestUrl.href);
          return response;
        }
        // If the specific navigation URL isn't cached, try index.html as a fallback
        return caches.match('index.html').then(function(indexResponse) {
          if (indexResponse) {
            console.log('[Service Worker] Serving index.html as navigation fallback for:', requestUrl.href);
            return indexResponse;
          }
          // If even index.html isn't cached, try network (will fail offline but log the attempt)
          console.log('[Service Worker] No cached response for navigation, falling back to network:', requestUrl.href);
          return fetch(event.request);
        }).catch(function(err) {
            console.error('[Service Worker] Navigation fallback failed (e.g., network error or no cache):', err);
            // Still try network fetch as a last resort, which will ultimately fail offline
            return fetch(event.request);
        });
      })
    );
    return; // Stop processing this fetch event as it's a navigation request
  }

  // Strategy: Cache First for static assets (app shell)
  // This serves your main app files from cache first for speed and offline.
  if (cacheAssets.includes(requestUrl.pathname) || cacheAssets.includes(requestUrl.pathname.slice(1))) { // Handle both with and without leading slash
    event.respondWith(
      caches.match(event.request).then(function(response) {
        if (response) {
          // console.log('[Service Worker] Cache hit (static asset) for:', requestUrl.href); // Keep this commented unless debugging
          return response;
        }
        console.log('[Service Worker] Cache miss (static asset) for:', requestUrl.href, 'Falling back to network.');
        // Fallback to network (will fail if offline and not in cache)
        return fetch(event.request);
      })
    );
    return; // Stop processing this fetch event if it's a static asset
  }

  // Strategy: Cache First, then Network for Google Fonts
  // This specifically targets font CSS and font files from Google's CDN for offline access.
  if (requestUrl.origin === 'https://fonts.googleapis.com' || requestUrl.origin === 'https://fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(function(cachedResponse) {
        if (cachedResponse) {
          console.log('[Service Worker] Cache hit (Google Font) for:', requestUrl.href);
          return cachedResponse;
        }
        console.log('[Service Worker] Cache miss (Google Font) for:', requestUrl.href, 'Falling back to network.');
        return fetch(event.request).then(function(networkResponse) {
          // Check for valid response before caching. Opaque responses can be cached.
          if (networkResponse.status === 200 || networkResponse.type === 'opaque') {
            const responseToCache = networkResponse.clone();
            caches.open(cacheName).then(function(cache) {
              cache.put(event.request, responseToCache);
              console.log('[Service Worker] Caching Google Font:', requestUrl.href);
            });
          }
          return networkResponse;
        }).catch(function(err) {
          console.error('[Service Worker] Network fetch failed for Google Font:', requestUrl.href, err);
          // If both cache and network fail, it will propagate the error,
          // which is expected if the font cannot be served offline and wasn't cached.
          throw err;
        });
      })
    );
    return; // Stop processing this fetch event if it's a Google Font
  }

  // Strategy: Cache First, then Network with Cache Update for specific API GET requests
  // This ensures offline availability for user state and feed data that has been previously fetched.
  // It also ensures fresh data is fetched when online.
  const isApiGetRequest = requestMethod === 'GET' && (
      requestUrl.pathname.startsWith('/user-state') ||
      requestUrl.pathname.startsWith('/feed-guids') ||
      requestUrl.pathname.startsWith('/feed-items') || // Assuming this is also a GET endpoint for items
      requestUrl.pathname.startsWith('/config/') // For any dynamic config files
  );

  if (requestMethod === 'GET') {
    event.respondWith(
      caches.match(event.request).then(function(cachedResponse) {
        // This is the core 'Cache First, then Network' for API.
        // It immediately responds with cached data if available,
        // but always attempts to fetch from the network to update the cache for next time.
        const fetchPromise = fetch(event.request).then(function(networkResponse) {
          // Check if we received a valid response to cache
          // Only cache 'basic' (same-origin) successful responses.
          const shouldCache = networkResponse.ok && networkResponse.status === 200 && networkResponse.type === 'basic';

          if (shouldCache) {
            const responseToCache = networkResponse.clone();
            caches.open(cacheName).then(function(cache) {
              cache.put(event.request, responseToCache);
              console.log('[Service Worker] Caching new response for:', requestUrl.href);
            });
          } else {
            // Log reasons why a response isn't cached (e.g., 404, cross-origin opaque, etc.)
            console.log('[Service Worker] Not caching response for:', requestUrl.href, ' (Status:', networkResponse.status, ', Type:', networkResponse.type, ', OK:', networkResponse.ok, ')');
          }
          return networkResponse;
        }).catch(function(err) {
          // This catch handles true network errors (e.g., user is offline, DNS lookup failed).
          console.error('[Service Worker] Network fetch failed for GET:', requestUrl.href, err);
          // If network fails, and there's a cached response, serve the cached response.
          if (cachedResponse) {
            console.log('[Service Worker] Network failed, serving cached response for:', requestUrl.href);
            return cachedResponse;
          }
          // If no cache and network failed, re-throw the error to indicate failure to the main thread.
          throw err;
        });

        // For API calls, if we have a cached response, serve it immediately
        // but *also* trigger the network fetch in the background to update the cache.
        if (isApiGetRequest && cachedResponse) {
          event.waitUntil(fetchPromise); // Keep the Service Worker alive until the background fetch completes
          return cachedResponse;
        }

        // For all other GET requests (non-API, non-static) or when no cached response is available,
        // just return the network fetch promise. This effectively makes them Network First.
        return fetchPromise;
      })
    );
  } else {
    // For non-GET requests (POST, PUT, DELETE, etc.), always go to the network and do not cache.
    // These typically involve sending data to the server and should always be fresh.
    console.log('[Service Worker] Network-only fetch for non-GET request:', event.request.method, requestUrl.href);
    event.respondWith(fetch(event.request).catch(function(err) {
      console.error('[Service Worker] Network fetch failed for non-GET:', requestUrl.href, err);
      throw err; // Re-throw to propagate the error to the main thread
    }));
  }
});