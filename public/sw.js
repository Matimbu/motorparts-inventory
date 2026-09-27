// Keeps the app's screens available when the connection drops. Data always comes live from the server:
// nothing under /api/ is ever cached.
const CACHE = 'shell-v1';
const SHELL = ['/', '/app.js', '/styles.css', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const key = e.request.mode === 'navigate' ? '/' : url.pathname;
  // network first, so a new version shows up right away; the cache is only the fallback
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && (SHELL.includes(key))) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key)));
});
