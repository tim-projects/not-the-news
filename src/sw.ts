// @filepath: src/sw.js

// This file is now powered by Workbox and vite-plugin-pwa.
// It replaces the manual caching logic with a more automated and robust system.

// We import the Workbox functions we need.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// The precache manifest is injected here by vite-plugin-pwa.
// This is a list of all your build files (including hashed ones) and their revision hashes.
// Workbox will replace this placeholder with the manifest during the build process.
/// <reference lib="WebWorker" />
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any[] };

self.__WB_MANIFEST;

type RouteHandlerCallback = ({ event }: { event: FetchEvent }) => Promise<Response>;

// A route for handling navigation requests (offline fallback).
const navigationHandler: RouteHandlerCallback = async ({ event }): Promise<Response> => { // Change return type to Promise<Response>
  try {
    // Try to get a response from the network first.
    return await fetch((event as any).request);
  } catch (error: any) {
    // If the network fails, fall back to the index.html from the cache.
    // This is the single-page application fallback.
    const cachedResponse = await caches.match('index.html');
    if (cachedResponse) {
        return cachedResponse;
    }
    // If index.html is not in cache, return a generic offline response
    return new Response('<h1>Offline</h1><p>You are currently offline and this page is not available in the cache.</p>', {
        headers: { 'Content-Type': 'text/html' }
    });
  }
};

// Register a route for navigation requests.
// This ensures that when the user is offline and refreshes the page,
// they get the cached index.html instead of a network error.
registerRoute(
  ({ request }) => {
    return request.mode === 'navigate';
  },
  navigationHandler,
);

// Precache all assets defined in the manifest.
// This includes all your hashed Vite bundles, which are now correctly pre-cached
// during the 'install' event.
precacheAndRoute(self.__WB_MANIFEST);

// Clean up old caches on activation.
// This ensures that new versions of your PWA don't get mixed up with old cached files.
cleanupOutdatedCaches();

// Take control of the page immediately.
clientsClaim();

// A more advanced fetch handler for runtime caching.
// This caches external assets like Google Fonts using a "stale-while-revalidate" strategy,
// which is great for frequently updated content.
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

// --- NEW: Add a route to bypass the service worker for API calls ---
import { NetworkOnly } from 'workbox-strategies';
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkOnly()
);
// --- END NEW ---