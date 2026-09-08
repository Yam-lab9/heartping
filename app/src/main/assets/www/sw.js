const CACHE_NAME = 'heartping-v3';
const ASSETS = ['./', './index.html', './style.css', './app.js', './firebase-service.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('heartping-') && key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache authenticated API responses, other origins, or mutations.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
      !ASSETS.some(asset => new URL(asset, self.registration.scope).href === url.href)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return await caches.match(event.request) || new Response('Offline. Reconnect to load HeartPing.', { status: 503 });
    }
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window' });
    const window = windows.find(client => client.url.startsWith(self.registration.scope));
    if (window) return window.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
