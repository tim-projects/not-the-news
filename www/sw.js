// www/sw.js
const STATIC_CACHE = 'shell-v2';
const API_CACHE    = 'api-v1';

// List the files you want precached:
const PRECACHE_URLS = [
  '/',                     // your index.html
  '/js/app.js',        // your main bundle
  '/js/data/appState.js',
  '/js/data/database.js',
  '/js/helpers/apiUtils.js',
  '/js/helpers/dataUtils.js',
  '/js/helpers/userStateUtils.js',
  '/js/ui/uiElements.js',
  '/js/ui/uiInitializers.js',
  '/js/ui/uiUpdaters.js',
  '/style.css',       // if you have a CSS file
  '/libs/alpine.3.x.x.js',
  '/libs/idb.js',
  '/libs/rss-parser.min.js',
  '/images/placeholder.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        return cache.addAll(PRECACHE_URLS)
          .catch(error => {
            console.error('Failed to cache:', error);
            PRECACHE_URLS.forEach(url => {
              fetch(url)
                .then(response => {
                  if (!response.ok) {
                    console.error('Failed to fetch ' + url + ': ' + response.status);
                  }
                })
                .catch(fetchError => {
                  console.error('Failed to fetch ' + url + ': ' + fetchError);
                });
            });
            throw error; // Re-throw the error to prevent installation
          });
      })
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
  // Exclude requests to external image domains
  if (url.hostname.includes('redd.it')) {
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      return cached || fetch(request).catch(() => {
        if (request.url === 'https://news.loveopenly.net/time') {
          // Return a placeholder response for /time
          return new Response(JSON.stringify({ time: 'offline' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } else if (request.headers.get('Accept').includes('application/json')) {
          return new Response(JSON.stringify({ time: 'offline' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } else {
          return caches.match('/images/placeholder.svg');
        }
      });
    })
  );
});
