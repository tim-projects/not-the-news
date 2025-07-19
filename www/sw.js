const cacheName = 'not-the-news-v1';
const cacheAssets = [
  'index.html',
  'login.html',
  'style.css',
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
  'libs/rss-parser.min.js',
  'fonts/Playfair_Display.ttf',
  'images/placeholder.svg'
];

self.addEventListener('install', function(event) {
  console.log('[Service Worker] Installing Service Worker ...', event);
  event.waitUntil(
    caches.open(cacheName)
      .then(function(cache) {
        console.log('[Service Worker] Caching all: app shell and content');
        return cache.addAll(cacheAssets);
      })
  );
});

self.addEventListener('activate', function(event) {
  console.log('[Service Worker] Activating Service Worker ....', event);
  return self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});
