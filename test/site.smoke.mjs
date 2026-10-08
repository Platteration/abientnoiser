/* The website, end to end. Builds the site the way the deploy does (scripts/site.js), serves
 * it at a sub-path, as GitHub Pages serves a project site, from a server that sends every
 * response the headers _headers writes for it and answers a missing address with 404.html,
 * and drives the app in Chromium under that policy. It fails on any Content-Security-Policy
 * or Trusted Types violation, any page error, any console error, and any request outside the
 * site — the page's, and the service worker's, which the server sees. A policy that blocks
 * something the app really does fails here, not on a visitor's screen.
 * Run: npm run test:e2e (after test/browser.smoke.mjs), or node test/site.smoke.mjs */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const site = require('../scripts/site.js');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.NODE_GLOBAL_MODULES || '/opt/node22/lib/node_modules', 'playwright'))); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/abientnoiser/';

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

/** _headers as [{ pattern, headers }], in file order. */
function readHeaders() {
  const rules = [];
  for (const line of fs.readFileSync(path.join(root, '_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) { rules.push({ pattern: line.trim(), headers: {} }); continue; }
    const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    rules[rules.length - 1].headers[m[1]] = m[2].trim();
  }
  return rules;
}
const RULES = readHeaders();
/** The headers a Netlify-style host sends for a path of the site ('/x', from its root). */
function headersFor(sitePath) {
  const out = {};
  for (const { pattern, headers } of RULES) {
    const hit = pattern.endsWith('/*') ? sitePath.startsWith(pattern.slice(0, -1)) : sitePath === pattern;
    if (hit) Object.assign(out, headers);
  }
  return out;
}
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

// the site, built from the working tree exactly as the deploy builds it from the commit
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'an-site-'));
const dir = path.join(out, 'site');
site.build(dir, { host: 'pages' });

const served = [];      // every path the server was asked for, the service worker's included
const outside = [];     // and the ones that were not the site's
let offline = false;
const server = http.createServer((req, res) => {
  if (offline) { req.socket.destroy(); return; }
  const url = new URL(req.url, 'http://x');
  served.push(url.pathname);
  if (!url.pathname.startsWith(BASE)) {
    outside.push(url.pathname);
    res.writeHead(404);
    res.end();
    return;
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname.slice(BASE.length)); } catch { rel = '\0'; }
  if (rel === '') rel = 'index.html';
  const file = path.join(dir, rel);
  const inside = !rel.includes('\0') && path.relative(dir, file) && !path.relative(dir, file).startsWith('..');
  fs.readFile(inside ? file : dir, (err, data) => {
    if (err) {   // a host answers any address it does not have with the site's 404 page
      res.writeHead(404, { 'Content-Type': TYPES['.html'], ...headersFor(`/${rel}`) });
      res.end(fs.readFileSync(path.join(dir, '404.html')));
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...headersFor(`/${rel}`) });
    res.end(data);
  });
});
server.on('connection', (s) => { if (offline) s.destroy(); });
await new Promise((r) => server.listen(0, 'localhost', r));
const origin = `http://localhost:${server.address().port}`;
const home = `${origin}${BASE}`;

// a page of another origin, to frame the app from
const framer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': TYPES['.html'] });
  res.end(`<!DOCTYPE html><title>framer</title><iframe src="${home}" width="800" height="600"></iframe>`);
});
await new Promise((r) => framer.listen(0, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

/** A page that records what the policy refused, what threw, and what it asked for. */
async function watched(context) {
  const page = await context.newPage();
  const seen = { violations: [], errors: [], console: [], requests: [] };
  page.on('pageerror', (e) => seen.errors.push(String(e)));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' || /Content Security Policy|Content-Security-Policy|Permissions-Policy|Trusted Type/i.test(text)) seen.console.push(`${m.type()}: ${text}`);
  });
  page.on('request', (r) => seen.requests.push(r.url()));
  return { page, seen };
}
/** Reports securitypolicyviolation events, from every document a page loads, to the test. */
const VIOLATIONS = () => {
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__violation(`${e.effectiveDirective} ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber} ${e.sample}`);
  });
};
/** Whether the policy is in force in `page`'s document: under require-trusted-types-for an
 *  HTML string sink throws. The probe is itself a violation, so it runs in a page of its own,
 *  whose console and violations are not the ones under test. */
const probes = new Set();
async function enforcedAt(context, url) {
  const p = await context.newPage();
  probes.add(p);
  try {
    await p.goto(url);
    await p.waitForSelector('.seg');
    return await p.evaluate(() => {
      try { document.createElement('div').innerHTML = '<b>probe</b>'; return 'assigned'; } catch (e) { return e.name; }
    });
  } finally {
    await p.close();
  }
}
const inSite = (u) => u.startsWith(home) || u.startsWith(`blob:${origin}/`);

try {
  const context = await browser.newContext({ permissions: ['clipboard-write'], acceptDownloads: true });
  const violations = [];
  await context.exposeBinding('__violation', ({ page: from }, text) => { if (!probes.has(from)) violations.push(text); });
  await context.addInitScript(VIOLATIONS);
  const { page, seen } = await watched(context);

  // The flow runs in a try of its own: when a step throws, what the page asked for and what
  // the policy refused up to then is still reported below, which is usually why it threw.
  try {
    // ---- the page, under the policy as a header ----
    const response = await page.goto(home);
    await page.waitForSelector('.seg');
    const sent = response.headers();
    const want = headersFor('/index.html');
    const mismatched = Object.entries(want).filter(([k, v]) => sent[k.toLowerCase()] !== v).map(([k]) => k);
    check(response.status() === 200 && mismatched.length === 0, `the page is served at ${BASE} with every header _headers writes (${Object.keys(want).length})${mismatched.length ? `; wrong: ${mismatched.join(', ')}` : ''}`);
    const enforced = await page.evaluate(() => ({
      started: document.documentElement.classList.contains('started'),
      noJs: document.documentElement.classList.contains('no-js'),
      note: getComputedStyle(document.getElementById('startNote')).display,
    }));
    const sink = await enforcedAt(context, home);
    check(sink === 'TypeError', `Trusted Types are enforced: an HTML string sink throws (${sink})`);
    check(enforced.started && !enforced.noJs && enforced.note === 'none', 'the app started, and the safety net\'s note stays hidden');
    check(page.workers().length >= 1, `the ticker runs in its blob: worker under the policy, not on a throttled setInterval (${page.workers().length} worker)`);

    // ---- the main flow ----
    await page.click('#play');
    await page.waitForTimeout(1500);
    const playing = await page.evaluate(() => ({ pos: AmbientNoiser.state.engine.transport.now(), playing: AmbientNoiser.state.engine.transport.playing }));
    check(playing.playing && playing.pos > 0.5, `Play makes music (position ${playing.pos.toFixed(2)} s)`);
    await page.click('.style:nth-child(2)');
    await page.click('#lift');
    await page.evaluate(() => {
      const rain = document.querySelector('.fader input[data-layer="rain"]');
      rain.value = '60';
      rain.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('details.movements summary');
    await page.click('#sectionList li .edit');
    const edited = await page.evaluate(() => ({
      style: AmbientNoiser.state.settings.style, rain: AmbientNoiser.state.settings.levels.rain,
      editor: document.querySelectorAll('#sectionList .editor select').length,
    }));
    check(edited.style === 'lofi' && edited.rain === 0.6 && edited.editor === 4, `style, mixer and the movement editor respond (${edited.style}, rain ${edited.rain}, ${edited.editor} editor fields)`);
    await page.click('#sectionList li .edit');
    await page.fill('#mixName', 'site check');
    await page.click('#save');
    await page.click('#share');
    await page.waitForFunction(() => /Link copied/.test(document.getElementById('toast').textContent));
    check(true, 'Copy link writes the share link to the clipboard (clipboard-write is this site\'s)');
    const saved = await page.evaluate(() => [...document.querySelectorAll('#mixList li strong')].map((s) => s.textContent));
    check(saved.includes('site check'), `Save puts the mix in the library (${saved.join(', ')})`);

    const download = async (selector) => {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(selector)]);
      const file = await dl.path();
      return { name: dl.suggestedFilename(), size: fs.statSync(file).size, file };
    };
    const card = await download('#card');
    check(/\.png$/.test(card.name) && card.size > 20000, `Save image downloads a picture (${card.name}, ${card.size} bytes)`);
    const backup = await download('#export');
    check(/\.json$/.test(backup.name) && fs.readFileSync(backup.file, 'utf8').includes('site check'), `Export library downloads the library (${backup.name})`);
    await page.click('#record');
    await page.waitForTimeout(1200);
    const recording = await download('#record');
    check(/\.(webm|ogg|mp4|m4a)$/.test(recording.name) && recording.size > 0, `Record captures what is playing (${recording.name}, ${recording.size} bytes)`);
    page.once('dialog', (d) => d.accept());   // "Delete all 1 saved mix?"
    await page.click('#libClear');
    await page.setInputFiles('#importFile', backup.file);
    await page.waitForFunction(() => /Imported 1 mix/.test(document.getElementById('toast').textContent));
    check(true, 'Import library reads the exported file back');
    await page.click('#about');
    const about = await page.evaluate(() => ({ open: document.getElementById('aboutDialog').open, version: document.getElementById('aboutVersion').textContent }));
    await page.click('#aboutClose');
    check(about.open && /^\d+\.\d+\.\d+$/.test(about.version), `About opens (version ${about.version})`);
    await page.selectOption('#theme', 'light');
    check(await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'the theme select applies');
    await page.click('#play');

    // ---- installable, offline, and a share link ----
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    check(manifest.errors.length === 0 && /Ambient Noiser/.test(manifest.data || ''), `the manifest loads under manifest-src (${manifest.errors.length} errors)`);
    const worker = await page.evaluate(async () => {
      // a worker whose install fails never becomes ready: give it ten seconds, not for ever
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10000))]);
      for (let i = 0; i < 100 && reg && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 50));
      const names = (await caches.keys()).filter((k) => k.startsWith('ambient-noiser-'));
      const keys = names.length ? (await (await caches.open(names[0])).keys()).map((r) => r.url) : [];
      return { scope: reg && reg.scope, controlled: !!navigator.serviceWorker.controller, keys };
    });
    const shell = site.shell();
    const missing = shell.filter((f) => !worker.keys.includes(`${home}${f}`));
    check(worker.scope === home && worker.controlled && missing.length === 0,
      `the service worker installs at ${BASE} and caches the whole shell under the policy's connect-src (${worker.keys.length} entries${missing.length ? `; missing ${missing.join(', ')}` : ''})`);
    const shareCode = await page.evaluate(() => AN.storage.encodeShare(AmbientNoiser.state.settings));
    offline = true;
    await page.goto(`${home}?mix=${encodeURIComponent(shareCode)}`);
    await page.waitForSelector('.seg');
    const fromCache = await page.evaluate(() => ({
      search: location.search, style: AmbientNoiser.state.settings.style, toast: document.getElementById('toast').textContent,
    }));
    fromCache.html = await enforcedAt(context, `${home}?mix=${encodeURIComponent(shareCode)}`);
    check(fromCache.style === 'lofi' && fromCache.search === '' && /shared mix/.test(fromCache.toast) && fromCache.html === 'TypeError',
      `offline, a share link opens from the cache, still under the policy, and leaves the address bar clean (${fromCache.style}, "${fromCache.toast}")`);
    offline = false;

    // ---- an address the site does not have ----
    const lost = await page.goto(`${home}no-such-page`);
    const notFound = await page.evaluate(() => ({ title: document.title, radius: getComputedStyle(document.querySelector('main')).borderTopLeftRadius, link: document.querySelector('a.open').href }));
    check(lost.status() === 404 && /Page not found/.test(notFound.title) && notFound.radius === '14px' && notFound.link === home,
      `a missing address gets the 404 page, styled under the policy, linking back to ${BASE} (${lost.status()}, radius ${notFound.radius})`);
    await page.click('a.open');
    await page.waitForSelector('.seg');
    check(page.url() === home, 'and its link opens the app');
    // the one console line a 404 is allowed: Chromium's own note that the document was a 404
    seen.console = seen.console.filter((m) => !(m.startsWith('error: Failed to load resource: the server responded with a status of 404') && served.includes(`${BASE}no-such-page`)));

    // ---- the repository is not the site ----
    for (const f of ['README.md', '.git/config', 'deploy/nginx.conf', '_headers', '_redirects', '.htaccess', 'test/site.smoke.mjs', 'scripts/serve.js', 'package.json', 'CLAUDE.md']) {
      const r = await page.request.get(`${home}${f}`);
      const body = await r.text();
      check(r.status() === 404 && body.includes('Page not found'), `${BASE}${f} is not published (${r.status()})`);
    }

  } catch (e) {
    console.error(e);
    failures++;
  }

  // ---- what the page asked for, and what the policy refused ----
  check(violations.length === 0, `no Content-Security-Policy or Trusted Types violation${violations.length ? `: ${violations.join(' | ')}` : ''}`);
  check(seen.errors.length === 0, `no page errors${seen.errors.length ? `: ${seen.errors.join(' | ')}` : ''}`);
  check(seen.console.length === 0, `no console errors or policy warnings${seen.console.length ? `: ${seen.console.join(' | ')}` : ''}`);
  const strays = seen.requests.filter((u) => !inSite(u));
  check(strays.length === 0, `the page asked for nothing outside ${BASE} (${seen.requests.length} requests${strays.length ? `; outside: ${strays.join(', ')}` : ''})`);
  check(outside.length === 0 && served.length > 0, `nor did its service worker: the server saw ${served.length} requests, ${outside.length} outside the site${outside.length ? `: ${outside.join(', ')}` : ''}`);
  await context.close();

  // ---- framed by another site ----
  const frameCtx = await browser.newContext();
  const framed = await frameCtx.newPage();
  const frameConsole = [];
  framed.on('console', (m) => frameConsole.push(m.text()));
  await framed.goto(`http://127.0.0.1:${framer.address().port}/`);
  await framed.waitForTimeout(1000);
  const child = framed.frames().find((f) => f !== framed.mainFrame());
  const childLoaded = child ? await child.evaluate(() => !!document.querySelector('.seg')).catch(() => false) : false;
  check(!childLoaded && frameConsole.some((m) => /frame-ancestors 'none'/.test(m)),
    `another site cannot frame the app: frame-ancestors 'none' refuses it (clickjacking)${childLoaded ? '; the app loaded in the frame' : ''}`);
  await frameCtx.close();

  // ---- the safety net ----
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const ns = await noScript.newPage();
  await ns.goto(home);
  const nsNote = await ns.locator('#startNote').isVisible();
  const nsMain = await ns.locator('main').isVisible();
  check(nsNote && !nsMain, 'with JavaScript off, a note says why instead of a page of dead controls');
  await noScript.close();

  for (const [name, handler, message] of [
    ['a script that does not load', (r) => r.abort(), /did not load/],
    ['a script that throws while starting', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: headersFor('/js/storage.js'), body: 'throw new Error("broken build")' }), /could not start/],
  ]) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route(`${home}js/storage.js`, handler);
    const p = await ctx.newPage();
    await p.goto(home);
    await p.waitForTimeout(500);
    const state = await p.evaluate(() => ({
      note: document.getElementById('startNote').textContent,
      noteShown: getComputedStyle(document.getElementById('startNote')).display !== 'none',
      mainShown: getComputedStyle(document.querySelector('main')).display !== 'none',
    }));
    check(state.noteShown && !state.mainShown && message.test(state.note), `${name}: the safety net shows a note in place of the controls ("${state.note.slice(0, 60)}…")`);
    await ctx.close();
  }
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.close();
  framer.close();
  fs.rmSync(out, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall site checks passed');
process.exit(failures ? 1 : 0);
