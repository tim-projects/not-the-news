// www/sw.js

const cacheName = 'not-the-news-v9'; // Incremented cacheName to v9 for this change.
const cacheAssets = [
  '/',
  'index.html',
  'login.html',
  // Vite renames bundled JS/CSS with hashes, so we cannot list them here.
  // The fetch handler below will handle caching them on first visit.
  'images/placeholder.svg',
  'images/favicon.svg',
  'images/icon-192.png',
  'images/icon-512.png',
  'manifest.json'
];

self.addEventListener('install', function(event) {
  console.log('[Service Worker] Installing Service Worker ...', event);
  event.waitUntil(
    caches.open(cacheName)
      .then(function(cache) {
        console.log('[Service Worker] Caching app shell and core content');
        return cache.addAll(cacheAssets)
          .then(() => {
            console.log('[Service Worker] All core assets cached successfully!');
          })
          .catch(function(error) {
            console.error('[Service Worker] Failed to cache a resource:', error);
            // This will cause the install event to fail, which is correct behavior.
            throw error;
          });
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
      return self.clients.claim();
    })
  );
});

// The sync event listener was removed as it was using an ES module import,
// which is not supported in the standard Service Worker context.
// You will need to implement this logic differently, for example by using postMessage
// to communicate with the main thread.

self.addEventListener('fetch', function(event) {
  // Check the request method. If it's not a GET, let it go to the network directly.
  if (event.request.method !== 'GET') {
    return;
  }

  // Use respondWith for caching GET requests
  event.respondWith(
    caches.match(event.request).then(function(response) {
      // If we have a cached response, return it.
      if (response) {
        return response;
      }

      // If nothing is in the cache, try the network.
      return fetch(event.request).then(function(networkResponse) {
        // Only cache a valid response from the network.
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        // Clone the response to put in the cache.
        const responseToCache = networkResponse.clone();
        caches.open(cacheName).then(function(cache) {
          // This call only happens for GET requests now.
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(function() {
        // Fallback for failed network requests
        return caches.match('index.html');
      });
    })
  );
});