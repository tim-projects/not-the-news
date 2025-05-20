// www/sw.js
const STATIC_CACHE = 'shell-v1';
const API_CACHE    = 'api-v1';

// List the files you want precached:
const PRECACHE_URLS = [
  '/',                     // your index.html
  '/javascript.js',        // your main bundle
  '/js/database.js',
  '/js/functions.js',
  '/js/settings.js',
  '/style.css',       // if you have a CSS file
  '/libs/alpine.3.x.x.js',
  '/libs/idb.js',
  '/libs/rss-parser.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  // clean up old caches
  const keep = [STATIC_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (!keep.includes(key)) return caches.delete(key);
      }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. navigation requests → serve shell from cache
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/')  // serve index.html
        .then(resp => resp || fetch(request))
    );
    return;
  }

  // 2. API calls → stale-while-revalidate
  if (url.pathname.startsWith('/items') || url.pathname.startsWith('/user-state')) {
    event.respondWith(
      caches.open(API_CACHE).then(cache =>
        cache.match(request).then(cached => {
          const networkFetch = fetch(request)
            .then(resp => {
              cache.put(request, resp.clone());
              return resp;
            })
            .catch(() => {}); // swallow errors
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // 3. other requests → cache-first for static
  event.respondWith(
    caches.match(request).then(cached => 
      cached || fetch(request)
    )
  );
});
