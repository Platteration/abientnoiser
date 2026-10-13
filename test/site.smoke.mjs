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

import catalogue from '../server/catalogue.js';
import { createNodeHandler } from '../server/kit/node.js';
import { createMemoryStore } from '../server/kit/store.js';
import { createFakes, envFor, signedDelivery } from './api-fakes.mjs';

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
/** The headers a Netlify-style host sends for a path of the site ('/x', from its root): every
 *  matching rule's, and a header two of them set goes out with both values joined, as Netlify
 *  and Cloudflare Pages send it (test/website.test.js refuses such a pair in _headers). */
function headersFor(sitePath) {
  const out = {};
  for (const { pattern, headers } of RULES) {
    const hit = pattern.endsWith('/*') ? sitePath.startsWith(pattern.slice(0, -1)) : sitePath === pattern;
    if (!hit) continue;
    for (const [name, value] of Object.entries(headers)) out[name] = Object.hasOwn(out, name) ? `${out[name]}, ${value}` : value;
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
/** What answers under api/: 'site', the folder's static api/config ("nothing on", as on GitHub
 *  Pages); 'missing', the not-found page, as on a host whose folder has no such file; 'kit', the
 *  site's API itself (server/kit with server/catalogue.js), as Cloudflare Pages' function or
 *  nginx's proxy answers it, with a fake Google and a fake Stripe injected through its fetch. */
let apiMode = 'site';
let kit = null;
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
  if (url.pathname.startsWith(`${BASE}api/`) && apiMode !== 'site') {
    if (apiMode === 'kit') { kit(req, res); return; }
    res.writeHead(404, { 'Content-Type': TYPES['.html'], ...headersFor(url.pathname.slice(BASE.length - 1)) });
    res.end(fs.readFileSync(path.join(dir, '404.html')));
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
// The API at the site's own address, the way a deployment configures it (APP_URL is the site's
// public address; http is allowed for localhost alone, where browsers keep Secure cookies).
const fakes = await createFakes();
const kitLog = [];
kit = createNodeHandler({ catalogue, env: envFor(home), store: createMemoryStore(), fetch: fakes.fetch, log: (level, message) => kitLog.push(`${level}: ${message}`) });

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
  const seen = { violations: [], errors: [], console: [], requests: [], failed: [] };
  page.on('pageerror', (e) => seen.errors.push(String(e)));
  page.on('requestfailed', (r) => seen.failed.push(r.url()));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' || /Content Security Policy|Content-Security-Policy|Permissions[- ]Policy|Trusted Type/i.test(text)) seen.console.push(`${m.type()}: ${text}`);
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
    // Every feature this Chromium knows is off but the two the app uses. The client hints are
    // set aside: they say only which hints the browser sends to this same site. A feature a
    // newer Chromium adds shows up here until it is denied in all three host files.
    const allowed = await page.evaluate(() => document.featurePolicy.allowedFeatures().filter((f) => !f.startsWith('ch-')).sort());
    check(JSON.stringify(allowed) === JSON.stringify(['autoplay', 'clipboard-write']),
      `Permissions-Policy leaves the page autoplay and clipboard-write and nothing else (${allowed.join(', ')})`);

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
    const about = await page.evaluate(() => ({
      open: document.getElementById('aboutDialog').open, version: document.getElementById('aboutVersion').textContent,
      account: !document.getElementById('account').hidden, privacy: !document.getElementById('privacyLocal').hidden && document.getElementById('privacyAccount').hidden,
      drawn: document.getElementById('accountBody').childElementCount, thanks: !document.getElementById('supporterThanks').hidden,
    }));
    await page.click('#aboutClose');
    check(about.open && /^\d+\.\d+\.\d+$/.test(about.version), `About opens (version ${about.version})`);
    check(!about.account && about.drawn === 0 && !about.thanks && about.privacy,
      'with no API on the host (the site\'s own api/config says nothing is on), About has no account, no shop and the privacy sentence for a site without sign-in');
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
    // Offline, the page's one question to the API, api/config, which the service worker leaves
    // to the network, fails, and Chromium notes that it did: the only request that may fail, and
    // the only console line it may cost.
    await page.waitForTimeout(300);
    const unanswered = seen.failed.filter((u) => u === `${home}api/config`).length;
    check(unanswered === 1 && seen.failed.length === 1, `offline, nothing fails but the page's question to the API, which the worker does not answer from its cache (${seen.failed.join(', ')})`);
    let allowance = unanswered;
    seen.console = seen.console.filter((m) => !(allowance > 0 && /^error: Failed to load resource: net::ERR_[A-Z_]+$/.test(m) && allowance--));
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

  // ---- a host with no api/config at all ----
  {
    apiMode = 'missing';
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const quiet = [];
    await ctx.exposeBinding('__violation', (_source, text) => quiet.push(text));
    await ctx.addInitScript(VIOLATIONS);
    const { page: p, seen: s } = await watched(ctx);
    await p.goto(home);
    await p.waitForSelector('.seg');
    await p.waitForResponse((r) => r.url() === `${home}api/config`).catch(() => null);
    await p.waitForTimeout(300);
    const state = await p.evaluate(() => ({ account: !document.getElementById('account').hidden, drawn: document.getElementById('accountBody').childElementCount, privacy: !document.getElementById('privacyLocal').hidden }));
    // Chromium's own note that a response was a 404 is the one console line this costs.
    const lines = s.console.filter((m) => !m.startsWith('error: Failed to load resource: the server responded with a status of 404'));
    check(!state.account && state.drawn === 0 && state.privacy && quiet.length === 0 && s.errors.length === 0 && lines.length === 0,
      `api/config answered 404: nothing is drawn and nothing breaks (${s.console.length} console line, Chromium's note of the 404${lines.length ? `; others: ${lines.join(' | ')}` : ''})`);
    await ctx.close();
    apiMode = 'site';
  }

  // ---- sign in with Google and "Support this app", where the site runs its API ----
  // The whole flow in Chromium under the site's real policy, the service worker in control:
  // sign in (Google's authorize page answered by a redirect to the callback, as Google answers a
  // consenting visitor), buy (Stripe's Checkout answered by a redirect to the success address once
  // the signed webhook is posted), the entitlement drawn, sign out, sign in again, delete the
  // account. Nothing may leave the site but those two navigations, which never reach the network.
  {
    apiMode = 'kit';
    const ctx = await browser.newContext();
    const refused = [];
    await ctx.exposeBinding('__violation', (_source, text) => refused.push(text));
    await ctx.addInitScript(VIOLATIONS);
    const away = [];
    const person = { sub: '7001', email: 'grace@example.com' };
    // Google's side. Playwright routes a request but not the ones its redirect makes, so Google's
    // authorize page is answered where the API's redirect to it is made: the API's own answer to
    // api/auth/google/start is fetched as it is (its sign-in cookie with it), the authorize URL in
    // it checked as Google checks it (fakes.consent), and the browser sent on to the callback
    // Google sends a consenting visitor back to. The browser never asks Google for anything.
    await ctx.route(`${home}api/auth/google/start?*`, async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      const location = response.headers().location || '';
      away.push(location);
      const back = fakes.consent(location, person);
      return route.fulfill({ response, headers: { ...response.headers(), location: back.href } });
    });
    let delivered = null;
    await ctx.route('https://checkout.stripe.com/**', (route) => {
      away.push(route.request().url());
      const id = new URL(route.request().url()).pathname.split('/').pop();
      const back = fakes.sessions.get(id).get('success_url');
      // Stripe tells the site after the visitor is back, a moment later: the page polls api/me.
      delivered = new Promise((resolve) => setTimeout(() => {
        const { body, signature } = signedDelivery(fakes.paid(route.request().url()));
        fetch(`${home}api/webhooks/stripe`, { method: 'POST', headers: { 'stripe-signature': signature, 'content-type': 'application/json' }, body })
          .then((r) => resolve(r.status), () => resolve('failed'));
      }, 1000));
      return route.fulfill({ status: 302, headers: { location: back } });
    });
    const { page: p, seen: s } = await watched(ctx);
    const aboutState = () => p.evaluate(() => ({
      account: !document.getElementById('account').hidden,
      text: document.getElementById('accountBody').textContent,
      buttons: [...document.querySelectorAll('#accountBody button')].map((b) => b.textContent),
      thanks: !document.getElementById('supporterThanks').hidden,
      privacy: document.getElementById('privacyLocal').hidden && !document.getElementById('privacyAccount').hidden,
      toast: document.getElementById('toast').textContent,
      search: location.search,
    }));
    const openAbout = async () => {
      await p.click('#about');
      await p.waitForFunction(() => !document.getElementById('account').hidden && document.querySelector('#accountBody button'));
    };
    /** A click that leaves the page (for Google, for Stripe) and the page it comes back to. */
    const roundTrip = async (selector) => {
      const back = p.waitForEvent('framenavigated', { predicate: (f) => f === p.mainFrame(), timeout: 15000 });
      await p.click(selector);
      await back;
      await p.waitForLoadState('load');
      await p.waitForSelector('.seg');
    };
    try {
      await p.goto(home);
      await p.waitForSelector('.seg');
      const controlled = await p.evaluate(async () => {
        await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 10000))]);
        for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 50));
        return !!navigator.serviceWorker.controller;
      });
      check(controlled, 'the service worker controls the page before the sign-in, so every step below passes through its scope');

      // Leaving for Google asks first when something would be lost: here a shared mix that is
      // only playing (not saved until the visitor changes or saves it), a recording and a WAV
      // export, both running.
      const shared = await p.evaluate(() => AN.storage.encodeShare({ ...AmbientNoiser.state.settings, seed: 'shared-before-sign-in' }));
      await p.goto(`${home}?mix=${encodeURIComponent(shared)}`);
      await p.waitForSelector('.seg');
      await p.click('#record');
      await p.waitForFunction(() => AmbientNoiser.state.recorder && AmbientNoiser.state.recorder.recording);
      await p.selectOption('#wavMinutes', '1');
      await p.click('#wav');
      await p.waitForFunction(() => AmbientNoiser.state.wavBusy);
      await openAbout();
      let question = '';
      p.once('dialog', (d) => { question = d.message(); d.dismiss(); });
      await p.click('#accountSignIn');
      await p.waitForTimeout(300);
      const stayed = await p.evaluate(() => ({ url: location.href, recording: AmbientNoiser.state.recorder.recording, wav: AmbientNoiser.state.wavBusy, seed: AmbientNoiser.state.settings.seed }));
      check(/^Signing in leaves this page for Google\. The recording that is running will be lost\. The WAV export that is running will stop\. The shared mix you are playing is not saved: Save keeps it\. Leave anyway\?$/.test(question)
        && stayed.url === home && stayed.recording && stayed.wav && stayed.seed === 'shared-before-sign-in' && away.length === 0,
        `signing in asks first when a recording, a WAV export and an unsaved shared mix would be lost, and "Cancel" stays ("${question}")`);
      await p.click('#aboutClose');
      await p.click('#wavCancel');
      await p.waitForFunction(() => !AmbientNoiser.state.wavBusy, null, { timeout: 60000 });
      await p.click('#record');
      await p.waitForFunction(() => !AmbientNoiser.state.recorder.recording);
      await p.goto(home);
      await p.waitForSelector('.seg');

      await openAbout();
      const out = await aboutState();
      check(out.account && out.privacy && !out.thanks && JSON.stringify(out.buttons) === JSON.stringify(['Sign in with Google', 'Sign in to buy']) && /Support this app · €3\.00/.test(out.text),
        `with the API on, About offers "Sign in with Google" and "Support this app" at Stripe's price, with the exact privacy sentence (${out.buttons.join(', ')}; "${out.text.slice(0, 60)}…")`);

      await roundTrip('#accountSignIn');
      await openAbout();
      const signedIn = await aboutState();
      check(away.length === 1 && /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/.test(away[0]) && /^Signed in as grace@example\.com/.test(signedIn.text) && JSON.stringify(signedIn.buttons) === JSON.stringify(['Sign out', 'Delete account', 'Buy']),
        `Sign in with Google goes to Google and back through the callback, and About says who is signed in (${signedIn.text.slice(0, 40)}…)`);

      await roundTrip('#supportBuy');
      await p.waitForFunction(() => /^Thank you — Support this app is unlocked\.$/.test(document.getElementById('toast').textContent), null, { timeout: 20000 });
      const hook = await delivered;
      await openAbout();
      const bought = await aboutState();
      check(hook === 200 && away.length === 2 && /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/.test(away[1]) && bought.thanks && /Owned$/.test(bought.text) && bought.search === '',
        `Buy goes to Stripe's Checkout and back; the signed webhook grants it, the page polls api/me and thanks the supporter in About ("Owned", webhook ${hook}, address ${bought.search || 'clean'})`);

      await p.click('#accountSignOut');
      await p.waitForSelector('#accountSignIn');
      const out2 = await aboutState();
      check(!out2.thanks && JSON.stringify(out2.buttons) === JSON.stringify(['Sign in with Google', 'Sign in to buy']), 'Sign out ends the session, and the thank-you goes with it');

      await roundTrip('#accountSignIn');
      await openAbout();
      const again = await aboutState();
      check(again.thanks && /Owned$/.test(again.text), 'signing in again brings the purchase back: it belongs to the Google account');

      let asked = '';
      p.once('dialog', (d) => { asked = d.message(); d.accept(); });
      await p.click('#accountDelete');
      await p.waitForSelector('#accountSignIn');
      await roundTrip('#accountSignIn');
      await openAbout();
      const deleted = await aboutState();
      check(/^Delete your account\?/.test(asked) && !deleted.thanks && /^Signed in as grace@example\.com/.test(deleted.text) && deleted.buttons.includes('Buy'),
        'Delete account asks first, then deletes the account and its purchase: signed in again, nothing is owned');

      // a sign-in that does not complete comes back as ?signin=failed, said once, then taken out
      await p.goto(`${home}api/auth/google/callback?code=forged&state=forged`);
      await p.waitForSelector('.seg');
      await p.waitForFunction(() => document.getElementById('toast').textContent === "Sign-in didn't complete.");
      check((await p.evaluate(() => location.search)) === '', 'a sign-in that does not complete says "Sign-in didn\'t complete." and leaves the address clean');

      const cachedApi = await p.evaluate(async () => {
        const out = [];
        for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) if (/\/api\//.test(new URL(r.url).pathname)) out.push(r.url);
        return out;
      });
      check(cachedApi.length === 0, `the service worker cached nothing under api/${cachedApi.length ? `: ${cachedApi.join(', ')}` : ''}`);
    } catch (e) {
      console.error(e);
      failures++;
    }
    check(refused.length === 0, `account flow: no Content-Security-Policy or Trusted Types violation${refused.length ? `: ${refused.join(' | ')}` : ''}`);
    check(s.errors.length === 0, `account flow: no page errors${s.errors.length ? `: ${s.errors.join(' | ')}` : ''}`);
    check(s.console.length === 0, `account flow: no console errors or policy warnings${s.console.length ? `: ${s.console.join(' | ')}` : ''}`);
    const strays = s.requests.filter((u) => !inSite(u) && !away.includes(u));
    check(strays.length === 0 && away.length === 4 && s.requests.filter((u) => away.includes(u)).length === 1,
      `account flow: nothing outside ${BASE}: Google's page was answered at the API's redirect to it (3 sign-ins), and Stripe's Checkout, the one navigation away, was answered in the browser${strays.length ? `; outside: ${strays.join(', ')}` : ''}`);
    check(fakes.unexpected.length === 0 && kitLog.length === 1 && /sign-in failed \(no valid sign-in cookie\)/.test(kitLog[0]),
      `the API asked Google and Stripe only what they answer, and logged only the forged sign-in (${kitLog.join(' | ')}${fakes.unexpected.join(' | ')})`);
    await ctx.close();
    apiMode = 'site';
  }

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

  // The safety net's own file and the stylesheet can fail to load as well, and neither stops
  // the app: a page that started shows its controls and no note saying it has not. A script
  // the app starts without (the share image's) still leaves the note up and the controls
  // hidden, since a feature of the page is missing.
  for (const [name, file, wantNote] of [
    ['the safety net itself', 'js/guard.js', false],
    ['the stylesheet', 'css/style.css', false],
    ['a script init() does not need', 'js/card.js', true],
    ['the account, which the app starts without', 'js/account.js', true],
  ]) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route(`${home}${file}`, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(home);
    // not '.seg' visible: with no stylesheet the segments have no size
    await p.waitForFunction(() => document.documentElement.classList.contains('started'), null, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(500);
    const state = {
      classes: await p.evaluate(() => document.documentElement.className),
      started: await p.evaluate(() => document.documentElement.classList.contains('started')),
      note: await p.locator('#startNote').isVisible(),
      main: await p.locator('main').isVisible(),
      toolbar: await p.locator('.toolbar').isVisible(),
    };
    const ok = state.started && state.note === wantNote && state.main === !wantNote && state.toolbar === !wantNote;
    check(ok, `${file} does not load (${name}): the app starts, and ${wantNote ? 'the note stands in place of the controls' : 'its controls show with no note saying it has not'} (classes "${state.classes}", note ${state.note}, main ${state.main}, toolbar ${state.toolbar})`);
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
