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
test('the service worker only touches caches it owns', () => {
  const sw = read('sw.js');
  const prefix = sw.match(/const PREFIX = '([^']*)'/);
  assert.ok(prefix, 'sw.js should declare a PREFIX for its own cache names');
  const version = sw.match(/const VERSION = '([^']*)'/)[1];
  assert.ok(version.startsWith(prefix[1]), `VERSION '${version}' must carry the PREFIX, or the sweep deletes this app's own cache`);
  const activate = sw.slice(sw.indexOf("addEventListener('activate'"), sw.indexOf("addEventListener('fetch'"));
  assert.match(activate, /startsWith\(PREFIX\)/, 'the activate sweep must delete only caches named with this app\'s prefix');
  assert.ok(!/caches\.match\(/.test(sw), 'reads must go through caches.open(VERSION), not the origin-wide caches.match()');
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
