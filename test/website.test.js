// The website layer: one policy, written in five places, and a site that is exactly the files
// the page loads. Netlify and Cloudflare Pages read _headers, Apache .htaccess, nginx
// deploy/nginx.conf, and a host that sends no headers (GitHub Pages) gets the policy from the
// <meta> of index.html and 404.html. A header changed in one of them and not the others is a
// site that is protected on one host and not on the next, so they are read out of every file
// here and held equal. What the policy allows is measured, not assumed: test/site.smoke.mjs
// serves the built site under these headers at a sub-path and drives the app.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const site = require('../scripts/site.js');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
/** A page without its comments, which may name the elements they describe. */
const page = (p) => read(p).replace(/<!--[\s\S]*?-->/g, '');

/** `_headers` as { path: { Header: value } }. */
function netlifyHeaders() {
  const rules = {};
  let current = null;
  for (const line of read('_headers').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = rules[line.trim()] = {}; continue; }
    const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    assert.ok(m && current, `_headers: a header line under a path: ${line}`);
    assert.ok(!Object.hasOwn(current, m[1]), `_headers: ${m[1]} is set once per path`);
    current[m[1]] = m[2].trim();
  }
  return rules;
}

/** Every `Header always set` in .htaccess, as { Header: value }. */
function apacheHeaders() {
  const out = {};
  for (const m of read('.htaccess').matchAll(/^\s*Header\s+always\s+set\s+([A-Za-z-]+)\s+"([^"]*)"(?:\s+env=HTTPS)?\s*$/gm)) {
    assert.ok(!Object.hasOwn(out, m[1]), `.htaccess: ${m[1]} is set once`);
    out[m[1]] = m[2];
  }
  assert.doesNotMatch(read('.htaccess'), /^\s*Header\s+(?!always\s+set\s)/m, '.htaccess sets every header with `Header always set`');
  return out;
}

/** Every `add_header` in deploy/nginx.conf, as { Header: value }. Each must carry `always`, or
 *  nginx leaves it off the 404 page and every other error response. */
function nginxHeaders() {
  const conf = read('deploy/nginx.conf');
  const out = {};
  for (const m of conf.matchAll(/^\s*add_header\s+([A-Za-z-]+)\s+"([^"]*)"\s+always;\s*$/gm)) {
    assert.ok(!Object.hasOwn(out, m[1]), `nginx.conf: ${m[1]} is set once`);
    out[m[1]] = m[2];
  }
  assert.equal([...conf.matchAll(/^\s*add_header\b/gm)].length, Object.keys(out).length, 'nginx.conf: every add_header is quoted and `always`');
  return out;
}

/** A page's <meta> policy and referrer policy. */
function metaOf(file) {
  const html = page(file);
  const csp = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/g)].map((m) => m[1]);
  const referrer = [...html.matchAll(/<meta name="referrer" content="([^"]+)">/g)].map((m) => m[1]);
  assert.equal(csp.length, 1, `${file} carries one Content-Security-Policy <meta>`);
  assert.equal(referrer.length, 1, `${file} carries one referrer <meta>`);
  // a <meta> policy governs only what comes after it
  assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.search(/<(script|link|style)\b/), `${file}: the policy comes before anything it governs`);
  return { csp: csp[0], referrer: referrer[0] };
}

/** A policy as an ordered list of [directive, ...sources]. */
const directives = (policy) => policy.split(';').map((d) => d.trim()).filter(Boolean).map((d) => d.split(/\s+/));
/** What a <meta> can carry of a header policy: frame-ancestors is ignored there, and
 *  upgrade-insecure-requests is left to the header so the dev server still serves a phone on
 *  the local network over plain http. */
const META_LEAVES_OUT = ['frame-ancestors', 'upgrade-insecure-requests'];

const HEADERS = netlifyHeaders()['/*'];

test('one policy: _headers, .htaccess and nginx.conf send the same headers with the same values', () => {
  assert.ok(HEADERS, '_headers has a /* rule');
  assert.deepEqual(apacheHeaders(), HEADERS, '.htaccess sends exactly what _headers does');
  assert.deepEqual(nginxHeaders(), HEADERS, 'deploy/nginx.conf sends exactly what _headers does');
});

test('one policy: every page carries the header policy in its <meta>, less what a <meta> cannot say', () => {
  const header = directives(HEADERS['Content-Security-Policy']);
  const want = header.filter(([name]) => !META_LEAVES_OUT.includes(name)).map((d) => d.join(' ')).join('; ');
  for (const name of META_LEAVES_OUT) assert.ok(header.some(([d]) => d === name), `the header policy sets ${name}`);
  for (const file of ['index.html', '404.html']) {
    const meta = metaOf(file);
    assert.equal(meta.csp, want, `${file}'s <meta> policy is the header's, directive for directive`);
    assert.equal(meta.referrer, HEADERS['Referrer-Policy'], `${file}'s referrer <meta> is the header's`);
  }
});

test('the policy starts from nothing and allows only what the app loads', () => {
  const policy = HEADERS['Content-Security-Policy'];
  const d = Object.fromEntries(directives(policy).map(([name, ...sources]) => [name, sources]));
  assert.equal(directives(policy).length, Object.keys(d).length, 'each directive once');
  assert.deepEqual(d['default-src'], ["'none'"]);
  assert.deepEqual(d['script-src'], ["'self'"], 'scripts are the site\'s own files: nothing inline, nothing evaluated');
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.deepEqual(d['base-uri'], ["'none'"]);
  assert.deepEqual(d['form-action'], ["'none'"]);
  assert.deepEqual(d['frame-ancestors'], ["'none'"], 'no other site may frame the app (clickjacking)');
  assert.deepEqual(d['connect-src'], ["'self'"], 'the service worker fetches the site\'s own files and nothing else talks to the network');
  assert.deepEqual(d['worker-src'], ["'self'", 'blob:'], 'sw.js, and the blob: ticker in js/timer.js');
  assert.deepEqual(d['require-trusted-types-for'], ["'script'"]);
  for (const [name, sources] of Object.entries(d)) {
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'wasm-unsafe-eval'", '*', 'data:', 'http:', 'https:', "'strict-dynamic'"]) {
      assert.ok(!sources.includes(bad), `${name} allows ${bad}`);
    }
  }
});

test('the style hash is the 404 page\'s <style>, and nothing else on either page is inline', () => {
  const allowed = directives(HEADERS['Content-Security-Policy']).find(([name]) => name === 'style-src').slice(1);
  const hashes = [];
  for (const file of ['index.html', '404.html']) {
    const html = page(file);
    for (const m of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) hashes.push(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
    assert.equal([...html.matchAll(/<style\b/g)].length, [...html.matchAll(/<style>/g)].length, `${file}: every <style> is a plain one`);
    const inlineScripts = [...html.matchAll(/<script\b([^>]*)>/g)].filter((m) => !/\ssrc="[^"]+"/.test(m[1]));
    assert.deepEqual(inlineScripts.map((m) => m[0]), [], `${file} has no inline script`);
    assert.doesNotMatch(html, /<[^>]*\son[a-z]+\s*=/i, `${file} has no inline event handler`);
    assert.doesNotMatch(html, /<[^>]*\sstyle\s*=/i, `${file} has no style attribute`);
  }
  assert.deepEqual(allowed, ["'self'", ...hashes], `style-src is 'self' and the hash of each inline <style> as it is now: ${hashes.join(' ')}`);
});

test('Trusted Types: the policy names exactly the policies the scripts create, and no script writes HTML', () => {
  const names = directives(HEADERS['Content-Security-Policy']).find(([name]) => name === 'trusted-types').slice(1);
  const sources = site.siteFiles().filter((f) => f.endsWith('.js')).map((f) => [f, read(f)]);
  const created = sources.flatMap(([, src]) => [...src.matchAll(/createPolicy\('([^']+)'/g)].map((m) => m[1]));
  assert.deepEqual([...names].sort(), [...created].sort(), 'trusted-types lists each createPolicy name, once, and nothing else');
  // Under require-trusted-types-for these throw; this names the line before a browser does.
  const SINKS = /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\.srcdoc\s*=|\beval\(|new Function\(|createContextualFragment|DOMParser/;
  for (const [file, src] of sources) {
    const lines = src.split('\n').flatMap((line, i) => (SINKS.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
    assert.deepEqual(lines, [], 'text reaches the page through textContent and createElement, never as HTML');
  }
});

test('the other headers: no sniffing, no framing, no referrer, no features the app does not use, HTTPS remembered', () => {
  assert.equal(HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(HEADERS['X-Frame-Options'], 'DENY', 'the old browsers\' half of frame-ancestors \'none\'');
  // A share link carries the whole mix in its address; no other site is told it.
  assert.equal(HEADERS['Referrer-Policy'], 'no-referrer');
  assert.equal(HEADERS['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(HEADERS['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(HEADERS['Strict-Transport-Security'], 'max-age=31536000; includeSubDomains');
  // No file name carries a version or a hash, so nothing may be cached without asking.
  assert.equal(HEADERS['Cache-Control'], 'no-cache');
  const features = HEADERS['Permissions-Policy'].split(',').map((f) => f.trim().split('='));
  const USED = { autoplay: '(self)', 'clipboard-write': '(self)' }; // the music, and Copy link
  for (const [name, allow] of features) assert.equal(allow, USED[name] || '()', `${name} is ${USED[name] ? 'this site\'s alone' : 'denied'}`);
  for (const name of [...Object.keys(USED), 'camera', 'microphone', 'geolocation', 'display-capture', 'payment', 'usb']) {
    assert.ok(features.some(([f]) => f === name), `Permissions-Policy names ${name}`);
  }
  assert.deepEqual(netlifyHeaders()['/LICENSE'], { 'Content-Type': 'text/plain; charset=utf-8' }, 'the licence is served as text');
});

/** The repository's files: tracked, plus new ones not yet added (so a file is checked before
 *  its first commit); every file on disk outside node_modules and .git where there is no
 *  work tree. */
function repositoryFiles() {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));
  } catch {
    const out = [];
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.name === 'node_modules' || e.name === '.git') continue;
        if (e.isDirectory()) walk(p); else out.push(p);
      }
    };
    walk('');
    return out;
  }
}

test('the site is the shell, the worker and the files every site has, and nothing else', () => {
  const files = site.siteFiles();
  const shell = site.shell();
  assert.deepEqual(files, [...new Set([...shell, ...site.EXTRA])].sort());
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), `${f} exists`);
  for (const f of ['index.html', '404.html', 'sw.js', 'manifest.webmanifest', 'robots.txt', '.well-known/security.txt', 'js/guard.js']) {
    assert.ok(files.includes(f), `the site has ${f}`);
  }
  const NOT_SITE = /(^|\/)(README|CLAUDE|AGENTS|CONVENTIONS|REVIEW|SECURITY|SECURITY-AUDIT)\.md$|^(test|scripts|deploy|node_modules|\.github|\.claude)\/|^(_headers|_redirects|\.htaccess|package(-lock)?\.json)$/;
  assert.deepEqual(files.filter((f) => NOT_SITE.test(f)), [], 'no notes, tests, scripts or hosting configs');
  assert.deepEqual(files.filter((f) => f.split('/').some((part) => part.startsWith('.')) && f !== '.well-known/security.txt'), [], 'no dotfile but the security contact');
  const pages = read('.github/workflows/pages.yml');
  assert.match(pages, /^\s+- run: mkdir dist && git archive HEAD -- \$\(node scripts\/site\.js --list\) \| tar -x -C dist$/m, 'the Pages deploy archives exactly the site\'s files out of the commit');
  assert.match(pages, /^\s+path: dist$/m, 'and uploads that folder');
});

test('scripts/site.js writes the site, and the config each host reads, into an empty folder', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'an-site-'));
  try {
    const list = (dir) => {
      const out = [];
      const walk = (rel) => { for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) { const p = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(p); else out.push(p); } };
      walk('');
      return out.sort();
    };
    for (const [host, extra] of Object.entries(site.HOST_FILES)) {
      const out = path.join(tmp, host);
      site.build(out, { host });
      assert.deepEqual(list(out), [...site.siteFiles(), ...extra].sort(), `--host=${host}`);
      assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), read('index.html'));
      assert.throws(() => site.build(out, { host }), /not empty/, 'a folder already holding files is refused, not published along with the site');
    }
    assert.throws(() => site.build(path.join(tmp, 'x'), { host: 'constructor' }), /unknown host/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** Which paths each host config serves, read the way that host reads it. */
function nginxServes(urlPath) {
  const conf = read('deploy/nginx.conf');
  const server = conf.slice(conf.indexOf('listen 443'));
  const blocks = [...server.matchAll(/location\s+(=|~)?\s*(\S+)\s*\{([^}]*(?:\{[^}]*\}[^}]*)?)\}/g)].map((m) => ({ kind: m[1] || 'prefix', match: m[2], body: m[3] }));
  const exact = blocks.find((b) => b.kind === '=' && b.match === urlPath);
  const regex = blocks.find((b) => b.kind === '~' && new RegExp(b.match).test(urlPath));
  const prefix = blocks.filter((b) => b.kind === 'prefix' && urlPath.startsWith(b.match)).sort((a, b) => b.match.length - a.match.length)[0];
  const block = exact || regex || prefix;
  assert.ok(block, `nginx.conf has a location for ${urlPath}`);
  return !/\breturn\s+404\b/.test(block.body);
}
function apacheServes(relPath) {
  const rule = read('.htaccess').match(/^\s*RewriteRule\s+!(\S+)\s+-\s+\[R=404,L\]\s*$/m);
  assert.ok(rule, '.htaccess refuses everything outside an allowlist');
  return new RegExp(rule[1]).test(relPath);
}
function netlifyDenies(urlPath) {
  return read('_redirects').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).some((line) => {
    const [from, to, status] = line.trim().split(/\s+/);
    assert.equal(`${to} ${status}`, '/404.html 404!', `_redirects: every rule is a forced 404: ${line}`);
    return from.endsWith('/*') ? urlPath.startsWith(from.slice(0, -1)) : urlPath === from;
  });
}

test('pointed at a checkout, every host config serves the site and answers 404 for everything else', () => {
  const files = new Set(site.siteFiles());
  // Netlify deploys from the repository, so its rules list the repository's own files; nginx
  // and Apache refuse anything outside the site, files that are not in the repository too.
  const others = [...repositoryFiles().filter((f) => !files.has(f)), '.git/config', '.git/HEAD', 'node_modules/playwright/package.json'];
  for (const f of ['README.md', 'deploy/nginx.conf', '_headers', '_redirects', '.htaccess', 'test/website.test.js', 'scripts/serve.js', 'package.json']) {
    assert.ok(others.includes(f), `${f} is one of the repository's files outside the site`);
  }
  for (const f of others) {
    assert.equal(nginxServes(`/${f}`), false, `nginx answers 404 for /${f}`);
    assert.equal(apacheServes(f), false, `Apache answers 404 for /${f}`);
    assert.equal(netlifyDenies(`/${f}`), true, `Netlify answers 404 for /${f}`);
  }
  for (const f of ['.env', 'dist/index.html', 'index.html.bak', 'js/app.js.map', 'backup.zip']) {
    assert.equal(nginxServes(`/${f}`), false, `nginx answers 404 for /${f}`);
    assert.equal(apacheServes(f), false, `Apache answers 404 for /${f}`);
  }
  for (const f of files) {
    assert.equal(nginxServes(`/${f}`), true, `nginx serves /${f}`);
    assert.equal(apacheServes(f), true, `Apache serves /${f}`);
    assert.equal(netlifyDenies(`/${f}`), false, `Netlify serves /${f}`);
  }
  assert.equal(nginxServes('/'), true, 'nginx serves the page at /');
  assert.equal(apacheServes(''), true, 'Apache serves the page at /');
  for (const dir of ['js/', 'js/audio/', 'css/', '.well-known/']) {
    assert.equal(nginxServes(`/${dir}`), false, `nginx answers 404 for the folder /${dir}`);
    assert.equal(apacheServes(dir), false, `Apache answers 404 for the folder /${dir}`);
  }
});

test('security.txt names a contact, the policy and an expiry no more than a year away', () => {
  const fields = {};
  for (const line of read('.well-known/security.txt').split('\n')) {
    const m = line.match(/^([A-Za-z-]+): (.+)$/);
    if (m) (fields[m[1]] = fields[m[1]] || []).push(m[2]);
  }
  // SECURITY.md asks for a private report, so the contact is the repository's private form.
  assert.deepEqual(fields.Contact, ['https://github.com/Platteration/abientnoiser/security/advisories/new']);
  assert.match(read('SECURITY.md'), /Report a vulnerability/);
  assert.deepEqual(fields.Policy, ['https://github.com/Platteration/abientnoiser/blob/HEAD/SECURITY.md']);
  assert.deepEqual(fields['Preferred-Languages'], ['en']);
  assert.equal(fields.Expires.length, 1);
  const expires = Date.parse(fields.Expires[0]);
  // RFC 9116: an expired file is to be treated as stale. Renew it with a date a year out.
  assert.ok(expires > Date.now(), `security.txt expired on ${fields.Expires[0]}: renew it`);
  assert.ok(expires - Date.now() <= 366 * 24 * 3600 * 1000, 'Expires is no more than a year away');
});
