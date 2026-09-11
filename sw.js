/* Offline cache for the app shell.
   VERSION is a hash of the shell's own contents, not a hand-edited counter: a stale
   stamp meant every visitor kept running the first build they ever loaded, because a
   byte-identical sw.js is never reinstalled and a cache hit was never revalidated.
   `test/shell.test.js` recomputes the hash and fails when it drifts, and the Pages
   deploy re-stamps it with the commit sha. */
/* Cache Storage is partitioned by ORIGIN, not by service-worker scope, and a GitHub
   Pages project site shares its origin with every other app the account publishes. So
   an unscoped read or delete reaches the co-tenants' caches too. Both the activate
   sweep and every read are therefore scoped to PREFIX-named caches, which here means
   our own. The deploy re-stamps the line below with the commit sha, so keep the prefix
   inside the literal rather than composing it. */
const PREFIX = 'ambient-noiser-';
const VERSION = 'ambient-noiser-4cc0b6ca5d93';
const SHELL = [
  './', './index.html', './css/style.css', './icon.svg', './manifest.webmanifest',
  './js/prng.js', './js/timer.js', './js/theory.js', './js/composer.js', './js/storage.js', './js/visual.js', './js/card.js', './js/app.js',
  './js/audio/graph.js', './js/audio/synths.js', './js/audio/drums.js', './js/audio/ambience.js',
  './js/audio/engine.js', './js/audio/recorder.js',
];

/** The one document URL: every navigation, whatever its query string, is this page. */
const DOC = './';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k.startsWith(PREFIX)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Read from this app's own cache. An unscoped match searches every cache on the
    origin, so offline it can answer with a co-tenant app's copy of one of our URLs. */
function lookup(req, opts) {
  return caches.open(VERSION).then((c) => c.match(req, opts));
}

/** Refresh one cache entry in the background; offline, the cached copy stands.
    'no-cache' so the check reaches the server rather than the browser's own cache. */
function revalidate(req, key) {
  let fresh = req;
  try { fresh = new Request(req, { cache: 'no-cache' }); } catch { /* keep the request as it is */ }
  return fetch(fresh)
    .then((res) => (res.ok ? caches.open(VERSION).then((c) => c.put(key, res)) : undefined))
    .catch(() => { /* offline — keep what we have */ });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Share links arrive as './?mix=...'; they are the same document, so ignore the
  // query when matching and never store a second copy per link.
  const navigate = req.mode === 'navigate';
  e.respondWith(
    lookup(req, { ignoreSearch: navigate }).then((hit) => {
      if (hit) {
        // Stale while revalidate: answer from the cache, then fetch a fresh copy so
        // the next load has it even if the worker itself never changes.
        e.waitUntil(revalidate(navigate ? new Request(DOC) : req, navigate ? DOC : req));
        return hit;
      }
      return fetch(req).then((res) => {
        if (res.ok && !navigate) {
          const copy = res.clone();
          e.waitUntil(caches.open(VERSION).then((c) => c.put(req, copy)));
        }
        return res;
      }).catch(() => lookup(DOC).then((doc) => doc || lookup('./index.html')));
    })
  );
});
