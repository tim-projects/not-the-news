import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { StaleWhileRevalidate, NetworkOnly } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// The precache manifest is injected here by vite-plugin-pwa.
/// <reference lib="WebWorker" />
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any[] };

// Precache all assets defined in the manifest.
precacheAndRoute(self.__WB_MANIFEST);

// Clean up old caches on activation.
cleanupOutdatedCaches();

// Take control of the page immediately.
clientsClaim();

// Handle navigation requests with a fallback to index.html
const handler = async (params: any) => {
  try {
    const response = await new NetworkOnly().handle(params);
    console.log('[SW] Navigation served from network');
    return response;
  } catch (error) {
    console.log('[SW] Navigation falling back to cache');
    const cachedResponse = await matchPrecache('index.html');
    return cachedResponse || Response.error();
  }
};
const navigationRoute = new NavigationRoute(handler);
registerRoute(navigationRoute);

// Cache external assets like Google Fonts
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new StaleWhileRevalidate({
    cacheName: 'google-fonts',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
);

// Explicitly bypass service worker for most API calls, EXCEPT search
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/') && !url.pathname.includes('/search') && !url.pathname.includes('/discover-feed'),
  async (params) => {
    try {
      return await new NetworkOnly().handle(params);
    } catch (error) {
      console.warn('[SW] API call failed (likely offline):', params.url.pathname);
      return new Response(JSON.stringify({ error: 'Network error', offline: true }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
);

// Discovery API - Always Network with error handling
registerRoute(
  ({ url }) => url.pathname.includes('/api/discover-feed'),
  async (params) => {
    try {
      return await new NetworkOnly().handle(params);
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Discovery unavailable offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
);

// Offline Search Implementation
registerRoute(
  ({ url }) => url.pathname.includes('/api/search'),
  async ({ url }) => {
    const query = url.searchParams.get('q')?.toLowerCase() || '';
    if (!query) {
      return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
    }

    const searchTerms = query.split(/\s+/).filter(Boolean);

    try {
      const results = await new Promise<any[]>((resolve, reject) => {
        const request = indexedDB.open('not-the-news-db');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('feedItems', 'readonly');
          const store = tx.objectStore('feedItems');
          const getAllRequest = store.getAll();
          getAllRequest.onerror = () => reject(getAllRequest.error);
          getAllRequest.onsuccess = () => {
            const allItems = getAllRequest.result;
            const filtered = allItems.filter((item: any) => {
              const title = (item.title || '').toLowerCase();
              const description = (item.description || '').toLowerCase();
              const content = `${title} ${description}`;
              return searchTerms.every(term => content.includes(term));
            });
            resolve(filtered);
          };
        };
      });

      return new Response(JSON.stringify(results), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('[SW] Search error:', error);
      return new Response(JSON.stringify({ error: 'Search failed' }), { status: 500 });
    }
  }
);