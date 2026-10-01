const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../js/prng.js');
require('../js/theory.js');
require('../js/composer.js');
require('../js/storage.js');
const AN = globalThis.AN;

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// The settings contract shared by the platteration apps, pinned as literals rather than
// read back from the module: a renamed key silently orphans every visitor's data, a
// dropped row or enum member silently replaces a choice with its default, and a test
// that derives its expectation from the value under test would excuse both.

test('every storage key is the string it has always been', () => {
  assert.deepEqual(AN.storage.KEYS, {
    mixes: 'ambientnoiser.mixes.v1',
    autosave: 'ambientnoiser.autosave.v1',
    prefs: 'ambientnoiser.prefs.v1',
  });
});

test('no other file spells a storage key out', () => {
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
  for (const f of walk('js')) {
    if (f === path.join('js', 'storage.js')) continue;
    assert.doesNotMatch(read(f), /ambientnoiser\.[a-z]+\.v\d/, `${f} names a storage key; it should reach it through AN.storage.KEYS`);
  }
});

test('the preferences record has exactly these fields, with these defaults', () => {
  assert.deepEqual(AN.storage.PREF_DEFAULTS, {
    theme: 'system', visuals: null, quiet: false, queue: [], queueEvery: 0, crossfade: 8,
  });
});

test('the enum tables offer exactly these values, in this order', () => {
  assert.deepEqual(Object.keys(AN.storage.THEMES), ['system', 'dark', 'light', 'black']);
  assert.deepEqual(Object.keys(AN.storage.VISUALS), ['on', 'off']);
  assert.deepEqual(AN.storage.QUEUE_MINUTES, [0, 10, 20, 30, 45, 60]);
  assert.deepEqual(AN.storage.CROSSFADES, [4, 8, 15, 30]);
  for (const table of [AN.storage.THEMES, AN.storage.VISUALS]) {
    for (const v of Object.values(table)) assert.equal(v, true, 'a table is a set of own keys, nothing more');
  }
});

// The page must offer every value the table knows and nothing else: the selects are
// built from the tables at runtime, so this pins that the labels cover them.
test('every table value has a label on the page', () => {
  const app = read('js/app.js');
  const labels = (name) => [...app.match(new RegExp(`const ${name} = \\{([^}]*)\\}`))[1].matchAll(/(\w+): '/g)].map((m) => m[1]);
  assert.deepEqual(labels('THEME_LABELS'), Object.keys(AN.storage.THEMES));
  assert.deepEqual(labels('VISUAL_LABELS'), Object.keys(AN.storage.VISUALS));
});

// The About dialog names a release. The service worker's VERSION is a different thing —
// a hash of the shell bytes, re-stamped by the deploy — and must stay that way.
test('the About dialog reports the package version', () => {
  const pkg = JSON.parse(read('package.json'));
  const m = read('js/app.js').match(/const APP_VERSION = '([^']*)'/);
  assert.ok(m, 'js/app.js should declare APP_VERSION');
  assert.equal(m[1], pkg.version, `APP_VERSION is '${m[1]}' but package.json says '${pkg.version}'`);
  assert.doesNotMatch(read('sw.js'), /APP_VERSION|package\.json/, 'the cache stamp is derived from the shell, not the release');
  assert.doesNotMatch(read('js/app.js'), /const VERSION = /, 'and the release is not the cache stamp');
});

test('the header carries the contract\'s controls, and they are accessible', () => {
  const html = read('index.html');
  for (const id of ['theme', 'visuals', 'quiet', 'resetPrefs', 'about', 'aboutDialog', 'aboutVersion', 'aboutClose']) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html should have #${id}`);
  }
  assert.match(html, /<button id="quiet"[^>]*aria-pressed="false"/, 'quiet mode is a toggle, so it carries aria-pressed');
  assert.match(html, /<dialog id="aboutDialog"[^>]*aria-labelledby="aboutTitle"/);
  const about = html.slice(html.indexOf('<dialog id="aboutDialog"'), html.indexOf('</dialog>'));
  assert.match(about, /MIT licence/);
  assert.match(about, /href="https:\/\/github\.com\/Platteration\/abientnoiser"/);
  assert.match(about, /share link[^.]*URL/, 'the privacy sentence says what a share link carries');
  // every button in the header has a text label, and an icon-only one would need aria-label
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  for (const b of header.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)) {
    assert.ok(b[2].trim() || /aria-label="[^"]+"/.test(b[1]), `header button ${b[1]} needs a text label or an aria-label`);
  }
});

// Reset is confirmed and touches the preferences record only. The browser suite drives
// the button; this pins that the handler asks first and that the storage call it makes
// is the one that keeps the other records.
test('reset asks first and resets the preferences record only', () => {
  const app = read('js/app.js');
  const fn = app.slice(app.indexOf('function resetPrefs()'), app.indexOf('\n  }', app.indexOf('function resetPrefs()')));
  assert.match(fn, /if \(!confirm\(/, 'reset is confirmed');
  assert.match(fn, /AN\.storage\.resetPrefs\(\)/);
  assert.doesNotMatch(fn, /storage\.(clear|remove|autosave|save)\(/, 'nothing else is written');
});
