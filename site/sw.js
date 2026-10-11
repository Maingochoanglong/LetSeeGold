// Service worker: lets the page show notifications on mobile browsers
// (which only allow them from a service worker) and makes the site installable.
// It deliberately caches nothing so prices are never served stale.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const page = all.find((c) => c.url.startsWith(self.registration.scope));
      if (page) return page.focus();
      return self.clients.openWindow(self.registration.scope);
    })(),
  );
});
