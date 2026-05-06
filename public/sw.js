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

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { return; }
  const { title, body, tag, room_id, room_code, type } = payload || {};
  if (!title) return;
  event.waitUntil(self.registration.showNotification(title, {
    body: body || '',
    tag,
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    data: { room_id, room_code, type },
    // your_turn replaces prior turn notifications silently; everything else
    // re-notifies so a stack of player_joined / hand_end events stays visible.
    renotify: type !== 'your_turn',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const room_code = data.room_code;
  const target = room_code ? `/join/${room_code}` : '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const ours = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (ours) {
      await ours.focus();
      ours.postMessage({ kind: 'push:navigate', room_code, room_id: data.room_id });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
