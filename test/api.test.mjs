// The website's API as this app deploys it: server/catalogue.js through the kit, by both ways in
// (functions/api/[[path]].js on Cloudflare Pages, server/start.mjs on a host of its own), with a
// fake Google and a fake Stripe handed to the kit through its `fetch` (test/api-fakes.mjs), never
// through a variable that names another host. Run by `npm test` beside the kit's own self-test
// (server/kit/selftest.mjs), which covers every guard of the kit itself.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import catalogue from '../server/catalogue.js';
import { priceVariable, validateCatalogue } from '../server/kit/app.js';
import { pagesHandler } from '../server/kit/cloudflare.js';
import { start } from '../server/start.mjs';
import { AMOUNT, createFakes, envFor, signedDelivery } from './api-fakes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const require = createRequire(import.meta.url);
require('../js/account.js');
const account = globalThis.AN.account;

/** What every test here must never do: reach the network. The fakes are injected instead. */
const realFetch = globalThis.fetch;
const escaped = [];
let local = null;
before(() => {
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    // the tests' own requests to the API they started on loopback
    if (local && url.startsWith(local)) return realFetch(input, init);
    escaped.push(url);
    throw new Error(`a test reached for the network: ${url}`);
  };
});
after(() => {
  globalThis.fetch = realFetch;
  assert.deepEqual(escaped, []);
});

describe('the catalogue', () => {
  it('sells one "Support this app" payment, granting supporter, and nothing else', () => {
    const checked = validateCatalogue(catalogue);
    assert.equal(checked.app, 'ambientnoiser');
    assert.deepEqual(checked.products.map((p) => [p.id, p.name, p.mode, p.grants]), [['supporter', 'Support this app', 'payment', 'supporter']]);
    assert.equal(priceVariable('supporter'), 'STRIPE_PRICE_SUPPORTER');
    // the page asks for that product and reads that entitlement
    assert.equal(account.SUPPORTER, 'supporter');
  });

  it('is what the API is built from, and the fakes are not', () => {
    for (const file of ['server/start.mjs', 'server/catalogue.js', 'functions/api/[[path]].js']) {
      for (const line of read(file).match(/^import .*$/gm) ?? []) assert.doesNotMatch(line, /fakes|test/, `${file} imports nothing of the tests`);
    }
    // the kit reads no variable that could point it at another Google or Stripe
    for (const file of fs.readdirSync(path.join(root, 'server/kit')).filter((f) => f.endsWith('.js'))) {
      assert.doesNotMatch(read(`server/kit/${file}`), /process\.env\.(?!KIT_)|GOOGLE_[A-Z_]*URL|STRIPE_[A-Z_]*(URL|HOST|BASE)/, `server/kit/${file}`);
    }
  });
});

describe('Cloudflare Pages: functions/api/[[path]].js', () => {
  it("is the kit's three-line entry with this app's catalogue, and _routes.json sends it /api/* alone", () => {
    const entry = 'functions/api/[[path]].js';
    assert.equal(read(entry), [
      "import { pagesHandler } from '../../server/kit/cloudflare.js';",
      "import catalogue from '../../server/catalogue.js';",
      'export const onRequest = pagesHandler(catalogue);',
      '',
    ].join('\n'));
    for (const target of ['../../server/kit/cloudflare.js', '../../server/catalogue.js']) {
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(entry), target)), target);
    }
    assert.deepEqual(JSON.parse(read('_routes.json')), { version: 1, include: ['/api/*'], exclude: [] }, 'no static file invokes the function');
  });

  /** A Workers KV namespace in memory, as much of one as the kit uses. */
  const kv = () => {
    const data = new Map();
    return {
      data,
      get: async (key) => (data.has(key) ? JSON.parse(data.get(key)) : null),
      put: async (key, value) => void data.set(key, value),
      delete: async (key) => void data.delete(key),
    };
  };
  const onRequest = pagesHandler(catalogue);
  const call = (url, env) => onRequest({ request: new Request(url), env });

  it('reports nothing on, and answers nothing else, with no variables set', async () => {
    const env = { KIT_STORE: kv() };
    const config = await call('https://ambientnoiser.example/api/config', env);
    assert.equal(config.status, 200);
    const body = await config.json();
    assert.deepEqual(body, { auth: { google: false }, shop: { products: [] } });
    assert.equal(account.readConfig(body), null, 'which the page reads as: nothing to draw');
    assert.equal(config.headers.get('cache-control'), 'public, max-age=60');
    for (const route of ['me', 'auth/google/start', 'checkout', 'portal', 'webhooks/stripe', 'nothing']) {
      assert.equal((await call(`https://ambientnoiser.example/api/${route}`, env)).status, 404, route);
    }
  });

  it('starts a sign-in towards Google once sign-in is configured, and sells nothing without Stripe', async () => {
    const { STRIPE_SECRET_KEY: _key, STRIPE_WEBHOOK_SECRET: _hook, STRIPE_PRICE_SUPPORTER: _price, ...signIn } = envFor('https://ambientnoiser.example/');
    const env = { ...signIn, KIT_STORE: kv() };
    const body = await (await call('https://ambientnoiser.example/api/config', env)).json();
    assert.deepEqual(body, { auth: { google: true }, shop: { products: [] } });
    assert.deepEqual(account.readConfig(body), { supporter: null }, 'the page draws the account and no shop');
    const started = await call('https://ambientnoiser.example/api/auth/google/start?return=%2F', env);
    assert.equal(started.status, 302);
    const google = new URL(started.headers.get('location') ?? '');
    assert.equal(`${google.origin}${google.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(google.searchParams.get('redirect_uri'), 'https://ambientnoiser.example/api/auth/google/callback');
    assert.match(started.headers.get('set-cookie') ?? '', /^__Host-ambientnoiser-oauth=[^;]+; .*HttpOnly/);
  });
});

describe('the static api/config the site publishes for a host with no API', () => {
  it('is, byte for byte, what the kit answers with nothing configured', async () => {
    const kit = await (await pagesHandler(catalogue)({ request: new Request('https://x.example/api/config'), env: {} })).text();
    assert.equal(read('api/config'), `${kit}\n`);
    assert.equal(account.readConfig(JSON.parse(read('api/config'))), null, 'so the page draws nothing there');
  });
});

describe('a host of its own: server/start.mjs through the Node adapter', () => {
  // The public address is the proxy's (deploy/nginx.conf), not the loopback port the API listens
  // on: the kit takes every absolute URL from APP_URL, and the CSRF gate the origin.
  const APP_URL = 'https://ambientnoiser.example/';
  const ORIGIN = 'https://ambientnoiser.example';
  let fakes;
  let api;
  let dataDir;
  const logs = [];

  before(async () => {
    fakes = await createFakes();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambientnoiser-api-'));
    api = await start({ env: envFor(APP_URL), dataDir, port: 0, fetch: fakes.fetch, log: (level, message) => logs.push(`${level}: ${message}`) });
    local = api.url;
  });
  after(async () => {
    await api?.close();
    local = null;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /** One browser's cookies, kept by name as the browser would keep them. */
  const jar = () => {
    const cookies = new Map();
    return {
      header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      take(response) {
        for (const line of response.headers.getSetCookie()) {
          const [pair, ...attrs] = line.split(';');
          const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
          if (attrs.some((a) => /^\s*Max-Age=0$/i.test(a))) cookies.delete(name);
          else cookies.set(name, value);
        }
      },
      has: (name) => cookies.has(name),
    };
  };
  const ask = async (browser, route, init = {}) => {
    const headers = { ...(init.headers ?? {}), ...(browser.header() ? { cookie: browser.header() } : {}) };
    const response = await realFetch(`${api.url}api/${route}`, { redirect: 'manual', ...init, headers });
    browser.take(response);
    return response;
  };
  const signIn = async (browser, person) => {
    const started = await ask(browser, `auth/google/start?return=${encodeURIComponent('/?keep=1')}`);
    assert.equal(started.status, 302);
    const back = fakes.consent(started.headers.get('location'), person);
    assert.equal(`${back.origin}${back.pathname}`, `${ORIGIN}/api/auth/google/callback`, 'Google sends the browser back to the site\'s callback');
    const done = await ask(browser, `auth/google/callback${back.search}`);
    assert.equal(done.status, 302);
    assert.equal(done.headers.get('location'), `${ORIGIN}/?keep=1`, 'and the site sends it back to the page it left');
    assert.ok(browser.has('__Host-ambientnoiser-session'));
  };
  const me = async (browser) => account.readMe(await (await ask(browser, 'me')).json());
  const post = (browser, route, body) => ask(browser, route, {
    method: 'POST', headers: { origin: ORIGIN, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });

  it('is on, and offers "Support this app" at its Stripe price', async () => {
    assert.deepEqual(api.features, { signIn: true, shop: true });
    const config = account.readConfig(await (await ask(jar(), 'config')).json());
    assert.deepEqual(config, {
      supporter: { id: 'supporter', name: 'Support this app', description: catalogue.products[0].description, price: { unitAmount: AMOUNT, currency: 'eur' } },
    });
  });

  it('signs in, sells, grants on the signed webhook alone, signs out and deletes', async () => {
    const browser = jar();
    assert.deepEqual(await me(browser), { user: null, entitlements: [] });
    assert.equal((await post(browser, 'checkout', { product: 'supporter' })).status, 401, 'signed out, nothing is sold');

    await signIn(browser, { sub: '1001', email: 'ada@example.com' });
    assert.deepEqual(await me(browser), { user: { email: 'ada@example.com' }, entitlements: [] });

    const bought = await post(browser, 'checkout', { product: 'supporter' });
    assert.equal(bought.status, 200);
    const checkout = account.checkoutAddress(await bought.json());
    assert.match(checkout ?? '', /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/, 'the page follows Stripe\'s hosted page and nothing else');
    const asked = fakes.sessions.get(new URL(checkout).pathname.split('/').pop());
    assert.equal(asked.get('success_url'), `${APP_URL}?purchase=success`);
    assert.equal(asked.get('cancel_url'), `${APP_URL}?purchase=cancelled`);
    assert.equal(asked.get('metadata[app]'), 'ambientnoiser');
    assert.equal(asked.get('metadata[product]'), 'supporter');
    // What README's "What leaves the device" says Stripe is told: the account id, as the session's
    // client_reference_id and in the payment's metadata, and not the email address.
    assert.equal(asked.get('client_reference_id'), 'google:1001');
    assert.equal(asked.get('metadata[user]'), 'google:1001');
    assert.equal(asked.get('payment_intent_data[metadata][user]'), 'google:1001');
    assert.deepEqual([...asked.values()].filter((v) => v.includes('ada@example.com')), [], 'no email address goes to Stripe');
    assert.deepEqual((await me(browser)).entitlements, [], 'a session created is not a purchase: nothing is granted before Stripe says it was paid');

    const forged = signedDelivery(fakes.paid(checkout), { secret: 'whsec_notTheSiteSecret000000' });
    const refused = await realFetch(`${api.url}api/webhooks/stripe`, { method: 'POST', headers: { 'stripe-signature': forged.signature, 'content-type': 'application/json' }, body: forged.body });
    assert.equal(refused.status, 400, 'an event signed with another secret is refused');
    assert.deepEqual((await me(browser)).entitlements, []);

    const delivery = signedDelivery(fakes.paid(checkout));
    const hook = await realFetch(`${api.url}api/webhooks/stripe`, { method: 'POST', headers: { 'stripe-signature': delivery.signature, 'content-type': 'application/json' }, body: delivery.body });
    assert.equal(hook.status, 200);
    assert.deepEqual((await me(browser)).entitlements, ['supporter'], 'Stripe\'s signed event grants it');
    assert.equal((await post(browser, 'checkout', { product: 'supporter' })).status, 409, 'and it is not sold twice');

    assert.equal((await post(browser, 'auth/logout')).status, 204);
    assert.deepEqual(await me(browser), { user: null, entitlements: [] });
    await signIn(browser, { sub: '1001', email: 'ada@example.com' });
    assert.deepEqual((await me(browser)).entitlements, ['supporter'], 'a purchase belongs to the Google account, not to the browser session');

    const forbidden = await ask(browser, 'me', { method: 'DELETE' });
    assert.equal(forbidden.status, 403, 'deleting without the site\'s Origin is refused (CSRF)');
    const deleted = await ask(browser, 'me', { method: 'DELETE', headers: { origin: ORIGIN } });
    assert.equal(deleted.status, 204);
    assert.deepEqual(await me(browser), { user: null, entitlements: [] });
    await signIn(browser, { sub: '1001', email: 'ada@example.com' });
    assert.deepEqual((await me(browser)).entitlements, [], 'deleting the account deleted the purchase records with it');
    assert.deepEqual(fakes.unexpected, []);
    assert.deepEqual(logs, []);
  });

  it('a second Buy before Stripe\'s webhook is given the open Checkout again, and once it is paid a 409 payment_pending, which the page reads as a payment on its way', async () => {
    // The page's own client (js/account.js) against the real kit: what it does with each answer.
    const browser = jar();
    await signIn(browser, { sub: '1002', email: 'lin@example.com' });
    const pageFetch = async (url, init = {}) => {
      const headers = { ...(init.headers ?? {}), origin: ORIGIN, ...(browser.header() ? { cookie: browser.header() } : {}) };
      const response = await realFetch(url, { method: init.method, body: init.body, redirect: 'manual', headers });
      browser.take(response);
      return response;
    };
    const client = account.client({ fetch: pageFetch, base: api.url });
    const first = await client.checkout('supporter');
    assert.match(first.url ?? '', /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
    const made = fakes.sessions.size;
    assert.deepEqual(await client.checkout('supporter'), first, 'another tab\'s Buy is given the same open session');
    assert.equal(fakes.sessions.size, made, 'and Stripe was asked for no second one');

    const event = fakes.paid(first.url); // paid in Checkout; Stripe's webhook not delivered yet
    assert.equal(await client.checkout('supporter'), 'pending', 'paid, not yet recorded: 409 payment_pending, and no second Checkout');
    assert.equal(fakes.sessions.size, made);
    assert.deepEqual((await client.me()).entitlements, [], 'nothing is granted before the webhook');

    const delivery = signedDelivery(event);
    const hook = await realFetch(`${api.url}api/webhooks/stripe`, { method: 'POST', headers: { 'stripe-signature': delivery.signature, 'content-type': 'application/json' }, body: delivery.body });
    assert.equal(hook.status, 200);
    assert.deepEqual((await client.me()).entitlements, ['supporter']);
    assert.equal(await client.checkout('supporter'), 'owned', 'recorded: 409 already_owned');
    assert.equal(fakes.sessions.size, made);
    assert.deepEqual(fakes.unexpected, []);
    assert.deepEqual(logs, []);
  });

  it('a failed sign-in comes back to the page as ?signin=failed, which the page reads once', async () => {
    const browser = jar();
    const failed = await ask(browser, 'auth/google/callback?code=x&state=y');
    assert.equal(failed.status, 302);
    const back = failed.headers.get('location');
    assert.equal(back, `${APP_URL}?signin=failed`);
    assert.deepEqual(account.landingOf(back), { landing: { signIn: 'failed', purchase: null }, without: '/' });
  });
});

describe('server/start.mjs with nothing set', () => {
  it('reports nothing on, and every other route is a 404', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ambientnoiser-api-off-'));
    const quiet = [];
    const api = await start({ env: {}, dataDir, port: 0, fetch: () => Promise.reject(new Error('no network')), log: (level, message) => quiet.push(message) });
    local = api.url;
    try {
      assert.deepEqual(api.features, { signIn: false, shop: false });
      const config = await realFetch(`${api.url}api/config`);
      assert.equal(await config.text(), read('api/config').trimEnd(), 'the same answer the static file gives');
      for (const route of ['me', 'auth/google/start', 'checkout', 'webhooks/stripe']) assert.equal((await realFetch(`${api.url}api/${route}`)).status, 404, route);
      assert.deepEqual(quiet, [], 'no configuration at all is not a warning');
    } finally {
      await api.close();
      local = null;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
