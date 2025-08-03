// @filepath: src/sw.js

// @refactor-directive
// Refactor JS: concise, modern, functional, same output.

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

  // Define the response handler logic as an async function
  const handleRequest = async () => {
    // 1. Check the cache first for any request
    const cachedResponse = await caches.match(event.request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // 2. If not in cache, try the network
    try {
      const networkResponse = await fetch(event.request);

      // Only cache a valid response from the network.
      if (networkResponse && networkResponse.status === 200) {
        const responseToCache = networkResponse.clone();
        const cache = await caches.open(cacheName);
        await cache.put(event.request, responseToCache);
      }

      return networkResponse;
    } catch (error) {
      // 3. Network failed. Now, handle the offline fallback.
      
      // Determine if the request is a navigation request.
      const isNavigation = event.request.mode === 'navigate' || 
                           (event.request.headers.get('accept') || '').includes('text/html');

      if (isNavigation) {
        // For navigation requests, fall back to the offline HTML page.
        // I've used '/' as a robust way to get the root HTML page.
        // It's also a good idea to cache an explicit offline.html page and
        // return that instead for a better user experience.
        return caches.match('/');
      } else {
        // For all other requests (scripts, CSS, images), let them fail.
        // This is the correct behavior to avoid MIME type errors.
        console.error('[Service Worker] Fetch failed and no cached response:', event.request.url);
        return new Response(null, { status: 503, statusText: 'Service Unavailable' });
      }
    }
  };

  event.respondWith(handleRequest());
});