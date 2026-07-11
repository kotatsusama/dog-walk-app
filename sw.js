/* ============================================================
   sw.js — Service Worker (PWA オフライン対応)
   わんポナビ v2
============================================================ */

const CACHE_NAME = 'wanponavi-v2';
const ASSETS = [
  './',
  './index.html',
  './js/storage.js',
  './js/weather.js',
  './js/map.js',
  './js/walk.js',
  './js/health.js',
  './js/app.js',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // APIリクエストはネットワーク優先
  if (e.request.url.includes('api.open-meteo.com') ||
      e.request.url.includes('overpass-api.de') ||
      e.request.url.includes('nominatim.openstreetmap.org') ||
      e.request.url.includes('router.project-osrm.org')) {
    e.respondWith(fetch(e.request).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // それ以外はキャッシュ優先
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
