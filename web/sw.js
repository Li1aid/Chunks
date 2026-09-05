// Service Worker — 只缓存静态资源(cache-first),API 请求(跨域)一律不拦截。
// 发版:改 CACHE_NAME 版本号即可让所有静态资源刷新。

const CACHE_NAME = 'chunks-v1';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/settings.js',
  './js/sync.js',
  './js/merge.js',
  './js/ai.js',
  './js/fsrs.js',
  './js/card.js',
  './js/speech.js',
  './js/views/translate.js',
  './js/views/library.js',
  './js/views/review.js',
  './js/views/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // 跨域(Worker API)或非 GET:交给网络,离线时自然报错
  if (url.origin !== location.origin || event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        // 只缓存同源 200;导航请求离线兜底到 index.html
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        throw new TypeError('offline');
      });
    })
  );
});
