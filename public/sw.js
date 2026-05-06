/**
 * Nägels Online — minimal service worker.
 *
 * Exists primarily to satisfy Chrome's installability criteria so the
 * "Install app" prompt becomes available on Android. We deliberately do
 * NOT cache anything beyond the install/activate handshake — offline
 * play would need conflict resolution we don't have, and stale shell
 * caches risk shipping out-of-date JS to live users on every Vercel
 * deploy. The fetch handler is a transparent passthrough.
 */

const VERSION = 'v1';

self.addEventListener('install', (event) => {
  // Activate the new SW immediately; we don't pre-cache anything.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take over open clients on first activation.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through — let the browser handle every request normally.
  // Required for Chrome to consider the site installable.
  event.respondWith(fetch(event.request));
});
