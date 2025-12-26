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

// Explicitly bypass service worker for API calls
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkOnly()
);