/* Offline cache for the app shell. Bump VERSION whenever the shell changes. */
const VERSION = 'ambient-noiser-v2';
const SHELL = [
  './', './index.html', './css/style.css', './icon.svg', './manifest.webmanifest',
  './js/prng.js', './js/theory.js', './js/composer.js', './js/storage.js', './js/visual.js', './js/card.js', './js/app.js',
  './js/audio/graph.js', './js/audio/synths.js', './js/audio/drums.js', './js/audio/ambience.js',
  './js/audio/engine.js', './js/audio/recorder.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
