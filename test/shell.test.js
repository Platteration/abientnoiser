const test = require('node:test');
const assert = require('node:assert/strict');
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
