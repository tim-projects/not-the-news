// @filepath: src/sw.js

// This file is now powered by Workbox and vite-plugin-pwa.
// It replaces the manual caching logic with a more automated and robust system.

// We import the Workbox functions we need.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';

// The precache manifest is injected here by vite-plugin-pwa.
// This is a list of all your build files (including hashed ones) and their revision hashes.
// Workbox will replace this placeholder with the manifest during the build process.
self.__WB_MANIFEST;

// A route for handling navigation requests (offline fallback).
const navigationHandler = async ({ event }) => {
  try {
    // Try to get a response from the network first.
    return await fetch(event.request);
  } catch (error) {
    // If the network fails, fall back to the index.html from the cache.
    // This is the single-page application fallback.
    return caches.match('index.html');
  }
};

// Register a route for navigation requests.
// This ensures that when the user is offline and refreshes the page,
// they get the cached index.html instead of a network error.
registerRoute(
  ({ request, url }) => {
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
  })
);