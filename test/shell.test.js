const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** Every file the page loads, in order, from the script and link tags. */
function pageAssets() {
  const html = read('index.html');
  const out = [];
  for (const m of html.matchAll(/<script src="([^"]+)"|<link[^>]+href="([^"]+)"/g)) {
    const href = m[1] || m[2];
    if (href && !/^https?:/.test(href) && !href.startsWith('data:')) out.push(href.replace(/^\.\//, ''));
  }
  return out;
}

function shellList() {
  const sw = read('sw.js');
  const block = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, 'sw.js should declare a SHELL array');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/^\.\//, ''));
}

test('the service worker precaches every file the page loads', () => {
  const shell = shellList();
  const missing = pageAssets().filter((a) => !shell.includes(a));
  assert.deepEqual(missing, [], `sw.js SHELL is missing: ${missing.join(', ')}`);
});

test('every precached file exists on disk', () => {
  for (const f of shellList()) {
    if (f === '') continue; // './' is the directory index
    assert.ok(fs.existsSync(path.join(root, f)), `sw.js precaches a missing file: ${f}`);
  }
});

test('the manifest points at files that exist', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.ok(manifest.name && manifest.start_url && manifest.icons.length);
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(root, icon.src.replace(/^\.\//, ''))), `missing icon ${icon.src}`);
  }
});

/** What the cache name should be, given what the shell files currently contain. */
function shellHash() {
  const h = crypto.createHash('sha256');
  for (const f of shellList()) {
    h.update(`${f}\0`);
    if (f !== '') h.update(fs.readFileSync(path.join(root, f))); // './' is the same bytes as index.html
  }
  return h.digest('hex').slice(0, 12);
}

// A cache-first worker only ever refetches the shell when its cache name changes, and
// a byte-identical sw.js is never even reinstalled. A hand-written VERSION went stale
// for ten shell-changing commits, which froze every existing visitor on the first
// build they loaded. Tie the name to the bytes so it cannot drift again.
test('the service worker cache name tracks the shell contents', () => {
  const m = read('sw.js').match(/const VERSION = '([^']*)'/);
  assert.ok(m, 'sw.js should declare a VERSION');
  const want = `ambient-noiser-${shellHash()}`;
  assert.equal(m[1], want, `sw.js VERSION is stale — cached installs would keep the old shell. Set it to '${want}'.`);
});

// Cache Storage is partitioned by origin, not by service-worker scope, and a GitHub
// Pages project site shares one origin with every other app the account publishes. An
// unfiltered activate sweep therefore deletes the co-tenants' offline shells, and a
// bare caches.match() can answer with one of their responses. The cache name already
// carries a prefix that makes ownership decidable; the point is to use it.
// These two assertions are about the source — the name has to carry the prefix, and the
// sweep has to filter on it. Whether the *reads* are scoped is a property of the running
// worker, not of what sw.js says, so test/browser.smoke.mjs plants a co-tenant cache and
// drives the real thing: a regex here passed a worker that opened the wrong cache.
test('the service worker only touches caches it owns', () => {
  const sw = read('sw.js');
  const prefix = sw.match(/const PREFIX = '([^']*)'/);
  assert.ok(prefix, 'sw.js should declare a PREFIX for its own cache names');
  const version = sw.match(/const VERSION = '([^']*)'/)[1];
  assert.ok(version.startsWith(prefix[1]), `VERSION '${version}' must carry the PREFIX, or the sweep deletes this app's own cache`);
  const activate = sw.slice(sw.indexOf("addEventListener('activate'"), sw.indexOf("addEventListener('fetch'"));
  assert.match(activate, /startsWith\(PREFIX\)/, 'the activate sweep must delete only caches named with this app\'s prefix');
});

// A ceiling the visitor only meets when it refuses their save is a ceiling they learn
// about the hard way. The page has to say it before then, and say the same number the
// code enforces.
test('the page states the library ceiling the code enforces', () => {
  const max = read('js/storage.js').match(/const MAX_MIXES = (\d+)/);
  assert.ok(max, 'js/storage.js should declare MAX_MIXES');
  assert.match(read('index.html'), new RegExp(`up to ${max[1]} of them`),
    `index.html should name the ${max[1]}-mix ceiling in the library hint, not leave it to a toast`);
});

test('the service worker revalidates hits and keeps one copy of the document', () => {
  const sw = read('sw.js');
  assert.match(sw, /ignoreSearch/, 'navigations must match the cached document with the query string ignored');
  const fetchHandler = sw.slice(sw.indexOf("addEventListener('fetch'"));
  assert.match(fetchHandler, /revalidate\(/, 'a cache hit must still be refreshed in the background');
  assert.match(fetchHandler, /!navigate/, 'navigation responses (one per share link) must never be cached under their own URL');
});

// Every script is a same-origin file and nothing is inlined, so the policy costs
// nothing and turns a future escaping slip into a console error instead of script
// execution. Keeping script-src strict is the whole point of having it.
test('the page ships a content security policy', () => {
  const html = read('index.html');
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(meta, 'index.html should carry a Content-Security-Policy meta tag');
  const policy = meta[1];
  for (const directive of ['default-src', 'script-src', 'worker-src', 'object-src', 'base-uri']) {
    assert.match(policy, new RegExp(`(^|; )${directive} `), `the policy should set ${directive}`);
  }
  const scriptSrc = policy.match(/script-src ([^;]+)/)[1];
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(scriptSrc), `script-src must stay strict, not '${scriptSrc}'`);
  const external = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((src) => /^[a-z]+:/.test(src));
  assert.deepEqual(external, [], 'a cross-origin script would be blocked by the policy');
});

/** sw.js with its globals stubbed, handing back the handlers it registered. The worker
 *  is plain JS, so the real fetch handler can be driven here — what it does when the
 *  cache is unavailable is behaviour, not prose, and every response the app makes goes
 *  through it. Each cache name gets its own store and there is no origin-wide
 *  caches.match(), so a read aimed at the wrong cache answers with the wrong body (or
 *  nothing) rather than quietly passing. */
function loadWorker({ cached = {}, openFails = false, network = true } = {}) {
  const base = 'https://example.test/app/';
  const abs = (r) => (typeof r === 'string' ? new URL(r, base).href : r.url);
  const version = read('sw.js').match(/const VERSION = '([^']*)'/)[1];
  const stores = new Map();
  const storeFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  // this app's own cache, and a co-tenant's holding the same URLs with other bodies
  for (const [k, v] of Object.entries(cached)) {
    storeFor(version).set(new URL(k, base).href, v);
    storeFor('another-app-v2').set(new URL(k, base).href, `CO-TENANT ${v}`);
  }
  const opened = [];
  const cacheFor = (name) => {
    const store = storeFor(name);
    return {
      match(req, opts) {
        const want = abs(req);
        for (const [url, body] of store) {
          if (url === want) return Promise.resolve({ body });
          if (opts && opts.ignoreSearch && url.split('?')[0] === want.split('?')[0]) return Promise.resolve({ body });
        }
        return Promise.resolve(undefined);
      },
      put: (key, res) => { store.set(abs(key), res.body); return Promise.resolve(); },
      addAll: () => Promise.resolve(),
    };
  };
  const caches = {
    open: (name) => { opened.push(name); return openFails ? Promise.reject(new Error('QuotaExceededError')) : Promise.resolve(cacheFor(name)); },
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (k) => { stores.delete(k); return Promise.resolve(true); },
  };
  const fetchImpl = (req) => (network
    ? Promise.resolve({ ok: true, body: `NETWORK ${abs(req)}`, clone() { return this; } })
    : Promise.reject(new TypeError('Failed to fetch')));
  class FakeRequest {
    constructor(input, init) {
      this.url = abs(input);
      this.method = 'GET';
      this.mode = (init && init.mode) || (typeof input === 'object' && input.mode) || 'same-origin';
    }
  }
  const handlers = {};
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    location: { origin: 'https://example.test' },
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => Promise.resolve(),
  };
  new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', read('sw.js'))(
    self, caches, fetchImpl, FakeRequest, undefined, URL);
  const respond = (url, mode) => {
    let answer;
    handlers.fetch({
      request: { url: new URL(url, base).href, method: 'GET', mode: mode || 'same-origin' },
      respondWith: (p) => { answer = p; },
      waitUntil: (p) => { Promise.resolve(p).catch(() => {}); },
    });
    return Promise.resolve(answer);
  };
  return { respond, opened };
}

// caches.match() is a read that resolves undefined when there is nothing to find;
// caches.open() creates the cache when it is absent, so it can fail where matching
// cannot — an evicted quota, a corrupt backend. It is the head of the fetch handler's
// chain, so an uncaught rejection there is not a cache miss: it is a network error for
// every request the worker intercepts, the navigation included, online or offline, with
// no way to reach the page that would unregister it. A lookup that cannot answer is a
// miss.
test('a cache that cannot be opened is a miss, not a dead page', async () => {
  const warm = loadWorker({ cached: { './index.html': 'CACHED DOC', './js/app.js': 'CACHED APP' } });
  assert.equal((await warm.respond('./js/app.js')).body, 'CACHED APP', 'a cached asset is answered from the cache');
  assert.ok(warm.opened.every((k) => k.startsWith('ambient-noiser-')), `only this app's caches are opened: ${warm.opened.join(', ')}`);

  const broken = loadWorker({ cached: { './index.html': 'CACHED DOC' }, openFails: true });
  const doc = await broken.respond('./?mix=abc', 'navigate');
  assert.ok(doc && /^NETWORK/.test(doc.body), `a navigation still reaches the network when the cache will not open (got ${doc && doc.body})`);
  const asset = await broken.respond('./js/app.js');
  assert.ok(asset && /^NETWORK/.test(asset.body), 'and so does every other request');

  // cache gone *and* no network: still a resolved response rather than a rejection the
  // browser would report as a failed fetch for the whole page
  const bothGone = loadWorker({ cached: { './index.html': 'CACHED DOC' }, openFails: true, network: false });
  await bothGone.respond('./?mix=abc', 'navigate');
});
