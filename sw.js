/* ============================================================
   sw.js — Service Worker (PWA オフライン対応)
   わんポナビ v2
============================================================ */

const CACHE_NAME = 'wanponavi-v99';
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
  './images/bg-scene.webp',
  './images/dog-character-transparent.png',
  './images/icon-192.png',
  './images/icon-512.png',
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
  // 常にネットワークから取得(キャッシュ無効)
  e.respondWith(fetch(e.request));
});
