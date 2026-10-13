// js/account.js: what the page reads from the site's api/ and what it draws, against a fake
// fetch and just enough of a document. The browser suite (test/site.smoke.mjs) drives the same
// module in Chromium against the real kit under the site's policy; this pins each answer the
// page can get, the ones a real server is hard to make give, and what the page does with it.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/account.js');
const { account } = globalThis.AN;

const BASE = 'https://ambientnoiser.example/abientnoiser/';
const CONFIG = {
  auth: { google: true },
  shop: { products: [{ id: 'supporter', name: 'Support this app', description: 'A one-time payment.', mode: 'payment', price: { unit_amount: 300, currency: 'eur' } }] },
};

/** An element: attributes, children, text, `hidden`, `disabled`, click listeners. */
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attributes = {};
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.listeners = [];
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  append(...kids) { for (const k of kids) this.children.push(typeof k === 'string' ? { text: k } : k); }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  get textContent() { return this.children.map((c) => (c instanceof FakeElement ? c.textContent : c.text)).join(''); }
  addEventListener(type, fn) { if (type === 'click') this.listeners.push(fn); }
  /** Clicks, and hands back what the handlers started, so a test can wait for it. */
  click() { return this.disabled ? Promise.resolve() : Promise.all(this.listeners.map((fn) => fn({}))); }
  focus() { FakeElement.focused = this; }
  *walk() { for (const c of this.children) if (c instanceof FakeElement) { yield c; yield* c.walk(); } }
  querySelector(tag) { for (const c of this.walk()) if (c.tagName === tag.toUpperCase()) return c; return null; }
  buttons() { return [...this.walk()].filter((e) => e.tagName === 'BUTTON'); }
  button(label) { return this.buttons().find((b) => b.textContent === label) || null; }
}
const doc = { createElement: (tag) => new FakeElement(tag) };

/** A fetch that answers each `METHOD route` from `routes` (a value, a function of the call, or
 *  an Error to throw), and records every call. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const route = url.startsWith(`${BASE}api/`) ? url.slice(`${BASE}api/`.length) : `OUTSIDE ${url}`;
    const method = init.method || 'GET';
    const call = { method, route, init };
    calls.push(call);
    let answer = routes[`${method} ${route}`];
    if (typeof answer === 'function') answer = await answer(call, calls);
    if (answer === undefined) answer = { status: 404, body: { error: 'not_found' } };
    if (answer instanceof Error) throw answer;
    const text = typeof answer.body === 'string' ? answer.body : answer.body === undefined ? '' : JSON.stringify(answer.body);
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, text: async () => text };
  };
  return { fetch, calls };
}

function page(routes, { href = BASE, leave = () => true, confirmAnswer = true } = {}) {
  const els = {
    section: Object.assign(new FakeElement('section'), { hidden: true }),
    body: new FakeElement('div'),
    thanks: Object.assign(new FakeElement('p'), { hidden: true }),
    privacyLocal: new FakeElement('p'),
    privacyAccount: Object.assign(new FakeElement('p'), { hidden: true }),
  };
  const url = new URL(href);
  const seen = { assigned: [], replaced: [], notes: [], confirms: [], leaves: [], waits: [] };
  const net = fakeFetch(routes);
  const ctl = account.start({
    doc,
    fetch: net.fetch,
    location: { href: url.href, pathname: url.pathname, search: url.search, assign: (to) => seen.assigned.push(to) },
    history: { replaceState: (_s, _t, to) => seen.replaced.push(to) },
    confirm: (message) => { seen.confirms.push(message); return confirmAnswer; },
    note: (message) => seen.notes.push(message),
    leave: (where) => { seen.leaves.push(where); return leave(where); },
    wait: async (ms) => { seen.waits.push(ms); },
    els,
  });
  return { ctl, els, seen, calls: net.calls };
}
const ok = (body) => ({ status: 200, body });
const SIGNED_OUT = ok({ user: null, entitlements: [] });
const ADA = ok({ user: { email: 'ada@example.com' }, entitlements: [] });
const ADA_SUPPORTER = ok({ user: { email: 'ada@example.com' }, entitlements: ['supporter'] });

/** What a visitor sees of the About dialog's account: nothing, or the section's text. */
const drawn = ({ els }) => ({
  section: !els.section.hidden, thanks: !els.thanks.hidden, privacyLocal: !els.privacyLocal.hidden, privacyAccount: !els.privacyAccount.hidden,
  text: els.body.textContent,
});

test('no API on the host: a 404, a network error, a body that is not JSON or nothing on draws nothing, stores nothing and asks again for nothing', async () => {
  for (const [label, answer] of [
    ['404', { status: 404, body: '<!DOCTYPE html><title>Page not found</title>' }],
    ['network error', new TypeError('Failed to fetch')],
    ['not JSON', { status: 200, body: 'not json' }],
    ['502 from a proxy with no API behind it', { status: 502, body: '<html>Bad Gateway</html>' }],
    ['nothing on (the static api/config)', ok({ auth: { google: false }, shop: { products: [] } })],
    ['a shop without sign-in', ok({ auth: { google: false }, shop: CONFIG.shop })],
    ['another shape', ok({ auth: { google: 'yes' } })],
    ['an array', ok([CONFIG])],
    ['the config, but answered as an error', { status: 404, body: CONFIG }],
  ]) {
    const p = page({ 'GET config': answer, 'GET me': ADA });
    assert.equal(await p.ctl.ready, false, label);
    assert.deepEqual(drawn(p), { section: false, thanks: false, privacyLocal: true, privacyAccount: false, text: '' }, `${label}: About is as it always was`);
    assert.deepEqual(p.calls.map((c) => `${c.method} ${c.route}`), ['GET config'], `${label}: one question, never api/me`);
  }
});

test('the page asks its own api/ beside it, and nothing else', async () => {
  const p = page({ 'GET config': ok(CONFIG), 'GET me': SIGNED_OUT }, { href: `${BASE}?x=1#y` });
  await p.ctl.ready;
  assert.deepEqual(p.calls.map((c) => `${c.method} ${c.route}`), ['GET config', 'GET me']);
  assert.equal(p.calls[1].init.cache, 'no-store', 'api/me is never answered from the HTTP cache');
  for (const c of p.calls) assert.equal(c.init.credentials, 'same-origin');
});

test('signed out: the account offers sign-in, the shop "Sign in to buy", and the exact privacy sentence', async () => {
  const p = page({ 'GET config': ok(CONFIG), 'GET me': SIGNED_OUT });
  assert.equal(await p.ctl.ready, true);
  const seen = drawn(p);
  assert.deepEqual({ ...seen, text: undefined }, { section: true, thanks: false, privacyLocal: false, privacyAccount: true, text: undefined });
  assert.deepEqual(p.els.body.buttons().map((b) => b.textContent), ['Sign in with Google', 'Sign in to buy']);
  assert.match(seen.text, /Support this app · €3\.00A one-time payment\./);
  // "Sign in to buy" signs in: a top-level navigation to the API, coming back to this page
  await p.els.body.button('Sign in to buy').click();
  await p.els.body.button('Sign in with Google').click();
  assert.deepEqual(p.seen.assigned, Array(2).fill(`${BASE}api/auth/google/start?return=%2Fabientnoiser%2F`));
  assert.deepEqual(p.seen.leaves, ['signin', 'signin']);
});

test('signing in asks the page first, and stays when it says no', async () => {
  const p = page({ 'GET config': ok(CONFIG), 'GET me': SIGNED_OUT }, { leave: () => false });
  await p.ctl.ready;
  await p.els.body.button('Sign in with Google').click();
  assert.deepEqual(p.seen.assigned, []);
});

test('the return path is the page with its query, and the API takes it from there', async () => {
  const p = page({ 'GET config': ok(CONFIG), 'GET me': SIGNED_OUT }, { href: `${BASE}index.html?keep=1` });
  await p.ctl.ready;
  await p.els.body.button('Sign in with Google').click();
  assert.deepEqual(p.seen.assigned, [`${BASE}api/auth/google/start?return=${encodeURIComponent('/abientnoiser/index.html?keep=1')}`]);
});

test('signed in: "Signed in as", Sign out, Delete account and Buy, which goes to Stripe\'s Checkout and nowhere else', async () => {
  const checkout = (url) => ok({ url });
  const routes = { 'GET config': ok(CONFIG), 'GET me': ADA, 'POST checkout': checkout('https://checkout.stripe.com/c/pay/cs_test_1') };
  const p = page(routes);
  await p.ctl.ready;
  assert.deepEqual(p.els.body.buttons().map((b) => b.textContent), ['Sign out', 'Delete account', 'Buy']);
  assert.match(p.els.body.textContent, /^Signed in as ada@example\.com/);
  await p.els.body.button('Buy').click();
  const post = p.calls.find((c) => c.route === 'checkout');
  assert.equal(post.method, 'POST');
  assert.deepEqual(JSON.parse(post.init.body), { product: 'supporter' });
  assert.equal(post.init.headers['Content-Type'], 'application/json', 'the one body the kit reads is JSON, which a form cannot send');
  assert.deepEqual(p.seen.leaves, ['checkout']);
  assert.deepEqual(p.seen.assigned, ['https://checkout.stripe.com/c/pay/cs_test_1']);

  // Stripe's hosted Checkout, exactly: not a lookalike host, not another stripe.com host, not
  // another port of the right one
  for (const url of ['https://evil.example/c/pay/cs_1', 'http://checkout.stripe.com/c/pay/cs_1', 'https://checkout.stripe.com.evil.example/c', 'https://user@checkout.stripe.com/c', 'javascript:alert(1)', '//checkout.stripe.com/c',
    'https://evilstripe.com/c', 'https://files.stripe.com/c', 'https://checkout.stripe.com:8443/c']) {
    routes['POST checkout'] = checkout(url);
    const q = page(routes);
    await q.ctl.ready;
    await q.els.body.button('Buy').click();
    assert.deepEqual(q.seen.assigned, [], `${url} is not followed`);
    assert.deepEqual(q.seen.notes, ['The shop could not be reached. Try again.']);
  }
});

test('Buy that the visitor cancels at the question creates no Checkout Session', async () => {
  const p = page({ 'GET config': ok(CONFIG), 'GET me': ADA, 'POST checkout': ok({ url: 'https://checkout.stripe.com/c/pay/cs_1' }) }, { leave: () => false });
  await p.ctl.ready;
  await p.els.body.button('Buy').click();
  assert.deepEqual(p.calls.filter((c) => c.route === 'checkout'), []);
  assert.deepEqual(p.seen.assigned, []);
});

test('each refusal of Buy says what happened', async () => {
  for (const [status, want] of [[404, ['Support is not on sale right now.']], [429, ['Too many tries for now. Try again in a while.']], [502, ['The shop could not be reached. Try again.']], [500, ['The shop could not be reached. Try again.']]]) {
    const p = page({ 'GET config': ok(CONFIG), 'GET me': ADA, 'POST checkout': { status, body: { error: 'x' } } });
    await p.ctl.ready;
    await p.els.body.button('Buy').click();
    assert.deepEqual(p.seen.notes, want, String(status));
    assert.deepEqual(p.seen.assigned, []);
  }
  // 401: the session ended meanwhile; 409: it was bought meanwhile (another tab)
  let mes = 0;
  const expired = page({ 'GET config': ok(CONFIG), 'GET me': ADA, 'POST checkout': { status: 401, body: { error: 'unauthorized' } } });
  await expired.ctl.ready;
  await expired.els.body.button('Buy').click();
  assert.deepEqual(expired.els.body.buttons().map((b) => b.textContent), ['Sign in with Google', 'Sign in to buy']);
  const bought = page({ 'GET config': ok(CONFIG), 'GET me': () => (mes++ ? ADA_SUPPORTER : ADA), 'POST checkout': { status: 409, body: { error: 'already_owned' } } });
  await bought.ctl.ready;
  await bought.els.body.button('Buy').click();
  assert.match(bought.els.body.textContent, /Owned$/);
  assert.equal(bought.els.thanks.hidden, false);
});

test('a 409 from Checkout unlocks nothing the server has not reported: api/me is asked again, and only what it says is drawn', async () => {
  // The kit answers 409 when it holds the entitlement; but what is drawn comes from api/me alone.
  // One that still reports none (a record deleted meanwhile, a 409 for some other reason) leaves
  // Buy where it was, and no thank-you.
  const p = page({ 'GET config': ok(CONFIG), 'GET me': ADA, 'POST checkout': { status: 409, body: { error: 'already_owned' } } });
  await p.ctl.ready;
  await p.els.body.button('Buy').click();
  assert.deepEqual(p.calls.map((c) => `${c.method} ${c.route}`), ['GET config', 'GET me', 'POST checkout', 'GET me'], 'the 409 is answered by asking api/me, not by drawing a purchase');
  assert.deepEqual(p.els.body.buttons().map((b) => b.textContent), ['Sign out', 'Delete account', 'Buy']);
  assert.doesNotMatch(p.els.body.textContent, /Owned/);
  assert.equal(p.els.thanks.hidden, true, 'no thank-you in About');
  assert.deepEqual(p.seen.assigned, []);
});

test('a supporter reads the thank-you in About and "Owned" in place of Buy', async () => {
  const p = page({ 'GET config': ok(CONFIG), 'GET me': ADA_SUPPORTER });
  await p.ctl.ready;
  assert.equal(p.els.thanks.hidden, false);
  assert.deepEqual(p.els.body.buttons().map((b) => b.textContent), ['Sign out', 'Delete account']);
  assert.match(p.els.body.textContent, /Owned$/);
});

test('an account the server holds no email for says "Signed in with Google"', async () => {
  for (const user of [{}, { email: 42 }, { email: 'ada@example.com\nX' }]) {
    const p = page({ 'GET config': ok(CONFIG), 'GET me': ok({ user, entitlements: [] }) });
    await p.ctl.ready;
    assert.match(p.els.body.textContent, /^Signed in with Google/, JSON.stringify(user));
  }
});

test('Sign out ends the session and draws the signed-out account; a failure says so', async () => {
  const p = page({ 'GET config': ok(CONFIG), 'GET me': ADA_SUPPORTER, 'POST auth/logout': { status: 204 } });
  await p.ctl.ready;
  await p.els.body.button('Sign out').click();
  assert.deepEqual(p.calls.filter((c) => c.method === 'POST').map((c) => c.route), ['auth/logout']);
  assert.equal(p.calls.find((c) => c.route === 'auth/logout').init.body, undefined, 'no body: the CSRF gate needs only the Origin the browser sends');
  assert.deepEqual(p.els.body.buttons().map((b) => b.textContent), ['Sign in with Google', 'Sign in to buy']);
  assert.equal(p.els.thanks.hidden, true, 'the thank-you is the account\'s, and goes with it');
  assert.equal(FakeElement.focused, p.els.body.button('Sign in with Google'), 'keyboard focus lands on the section, not on nothing');

  for (const answer of [new TypeError('Failed to fetch'), { status: 403, body: { error: 'forbidden' } }, { status: 500, body: { error: 'internal' } }]) {
    const failing = page({ 'GET config': ok(CONFIG), 'GET me': ADA, 'POST auth/logout': answer });
    await failing.ctl.ready;
    await failing.els.body.button('Sign out').click();
    assert.deepEqual(failing.seen.notes, ['Could not sign out. Try again.'], String(answer.status || answer));
    assert.match(failing.els.body.textContent, /^Signed in as/, 'a session the server did not end is not drawn as ended');
  }
});

test('Delete account is confirmed first, says the support goes with it, and deletes nothing when declined', async () => {
  const declined = page({ 'GET config': ok(CONFIG), 'GET me': ADA_SUPPORTER, 'DELETE me': { status: 204 } }, { confirmAnswer: false });
  await declined.ctl.ready;
  await declined.els.body.button('Delete account').click();
  assert.equal(declined.seen.confirms.length, 1);
  assert.match(declined.seen.confirms[0], /^Delete your account\?.*thank-you in About goes too.*payment itself stays with Stripe.*cannot be undone/);
  assert.deepEqual(declined.calls.filter((c) => c.method === 'DELETE'), []);

  const accepted = page({ 'GET config': ok(CONFIG), 'GET me': ADA_SUPPORTER, 'DELETE me': { status: 204 } });
  await accepted.ctl.ready;
  await accepted.els.body.button('Delete account').click();
  assert.deepEqual(accepted.calls.filter((c) => c.method === 'DELETE').map((c) => c.route), ['me']);
  assert.deepEqual(accepted.els.body.buttons().map((b) => b.textContent), ['Sign in with Google', 'Sign in to buy']);
  assert.equal(accepted.els.thanks.hidden, true);

  const failing = page({ 'GET config': ok(CONFIG), 'GET me': ADA, 'DELETE me': { status: 403, body: { error: 'forbidden' } } });
  await failing.ctl.ready;
  await failing.els.body.button('Delete account').click();
  assert.deepEqual(failing.seen.notes, ['The account could not be deleted. Try again.']);
});

test('one action at a time: the buttons are disabled while one is out', async () => {
  let release;
  const p = page({ 'GET config': ok(CONFIG), 'GET me': ADA, 'POST checkout': () => new Promise((r) => { release = () => r({ status: 429, body: {} }); }) });
  await p.ctl.ready;
  const first = p.els.body.button('Buy').click();
  await new Promise((r) => setImmediate(r));
  assert.ok(p.els.body.buttons().every((b) => b.disabled), 'every button of the section is disabled while Buy is out');
  await p.els.body.button('Buy').click();
  release();
  await first;
  assert.equal(p.calls.filter((c) => c.route === 'checkout').length, 1, 'a second click did not start a second Checkout Session');
  assert.ok(p.els.body.buttons().every((b) => !b.disabled));
});

test('?signin=failed: said once, where sign-in is on, and taken out of the address either way', async () => {
  const on = page({ 'GET config': ok(CONFIG), 'GET me': SIGNED_OUT }, { href: `${BASE}?signin=failed&keep=1` });
  assert.deepEqual(on.seen.replaced, ['/abientnoiser/?keep=1'], 'the flag leaves the address at once, so a reload does not repeat it');
  await on.ctl.ready;
  assert.deepEqual(on.seen.notes, ["Sign-in didn't complete."]);

  const off = page({ 'GET config': { status: 404 } }, { href: `${BASE}?signin=failed` });
  await off.ctl.ready;
  assert.deepEqual(off.seen.replaced, ['/abientnoiser/']);
  assert.deepEqual(off.seen.notes, [], 'a site with no sign-in says nothing about one');

  const none = page({ 'GET config': ok(CONFIG), 'GET me': SIGNED_OUT }, { href: `${BASE}?purchase=later` });
  await none.ctl.ready;
  assert.deepEqual(none.seen.replaced, [], 'a value the kit does not write is not ours to take out');
});

test('?purchase=success: api/me is asked up to five times over fifteen seconds for the thank-you', async () => {
  let asked = 0;
  const later = page({ 'GET config': ok(CONFIG), 'GET me': () => (++asked >= 4 ? ADA_SUPPORTER : ADA) }, { href: `${BASE}?purchase=success` });
  await later.ctl.ready;
  assert.deepEqual(later.seen.replaced, ['/abientnoiser/']);
  assert.deepEqual(later.seen.waits, [3000, 3000, 3000], 'three waits of three seconds: the webhook landed then');
  assert.deepEqual(later.seen.notes, ['Thank you — Support this app is unlocked.']);
  assert.equal(later.els.thanks.hidden, false);
  assert.match(later.els.body.textContent, /Owned$/);

  const never = page({ 'GET config': ok(CONFIG), 'GET me': ADA }, { href: `${BASE}?purchase=success` });
  await never.ctl.ready;
  assert.deepEqual(never.seen.waits, [3000, 3000, 3000, 3000, 3000], 'five tries over fifteen seconds, then it stops');
  assert.equal(never.calls.filter((c) => c.route === 'me').length, 6);
  assert.deepEqual(never.seen.notes, ['Payment received. It can take a minute to appear — reload to check.']);

  const already = page({ 'GET config': ok(CONFIG), 'GET me': ADA_SUPPORTER }, { href: `${BASE}?purchase=success` });
  await already.ctl.ready;
  assert.deepEqual(already.seen.waits, []);
  assert.deepEqual(already.seen.notes, ['Thank you — Support this app is unlocked.']);

  const cancelled = page({ 'GET config': ok(CONFIG), 'GET me': ADA }, { href: `${BASE}?purchase=cancelled` });
  await cancelled.ctl.ready;
  assert.deepEqual(cancelled.seen.replaced, ['/abientnoiser/']);
  assert.deepEqual(cancelled.seen.notes, [], '?purchase=cancelled: nothing but taking it out of the address');
});

test('?purchase=success on a site that sells nothing: the flag leaves the address, and nothing is awaited, asked or said', async () => {
  // Sign-in on and no product (Stripe's variables not set, or this app's product not among the
  // listed ones): there is no purchase to wait for, so no "Payment received" on a site with no shop.
  for (const [label, shop] of [['no products', { products: [] }], ['no shop at all', undefined], ['only another app\'s product', { products: [{ ...CONFIG.shop.products[0], id: 'pro' }] }]]) {
    const p = page({ 'GET config': ok({ auth: { google: true }, ...(shop ? { shop } : {}) }), 'GET me': ADA }, { href: `${BASE}?purchase=success` });
    assert.equal(await p.ctl.ready, true, label);
    assert.deepEqual(p.seen.replaced, ['/abientnoiser/'], `${label}: the flag still leaves the address`);
    assert.deepEqual(p.seen.waits, [], `${label}: no wait`);
    assert.deepEqual(p.calls.map((c) => `${c.method} ${c.route}`), ['GET config', 'GET me'], `${label}: api/me once, as on any load, and not polled`);
    assert.deepEqual(p.seen.notes, [], `${label}: no note`);
    assert.doesNotMatch(p.els.body.textContent, /Support this app|Owned/, `${label}: no shop drawn`);
    assert.equal(p.els.thanks.hidden, true, `${label}: no thank-you`);
  }
});

test('what the server says is read field by field, and what does not hold up is left out', () => {
  const product = (over) => ({ auth: { google: true }, shop: { products: [{ ...CONFIG.shop.products[0], ...over }] } });
  assert.deepEqual(account.readConfig(CONFIG), { supporter: { id: 'supporter', name: 'Support this app', description: 'A one-time payment.', price: { unitAmount: 300, currency: 'eur' } } });
  assert.deepEqual(account.readConfig(product({ price: undefined })).supporter.price, null, 'a product Stripe could not price is still sold');
  for (const bad of [{ id: 'constructor' }, { id: 'pro' }, { mode: 'subscription' }, { name: '' }, { name: 'x'.repeat(101) }, { name: 'a\u0000b' }, { description: 'x'.repeat(501) }, { name: { toString: () => 'x' } }]) {
    assert.deepEqual(account.readConfig(product(bad)), { supporter: null }, JSON.stringify(bad));
  }
  for (const price of [{ unit_amount: -1, currency: 'eur' }, { unit_amount: 1.5, currency: 'eur' }, { unit_amount: 300, currency: 'EUR' }, { unit_amount: '300', currency: 'eur' }, null]) {
    assert.equal(account.readConfig(product({ price })).supporter.price, null, JSON.stringify(price));
  }
  const parsed = JSON.parse('{"user":null,"entitlements":["supporter","__proto__","constructor","toString","supporter",7,"Pro"]}');
  assert.deepEqual(account.readMe(parsed), { user: null, entitlements: ['supporter', 'constructor'] }, 'ids as the kit writes them, once each');
  for (const bad of [null, [], { user: null }, { user: 'ada', entitlements: [] }, { user: [], entitlements: [] }]) assert.equal(account.readMe(bad), null, JSON.stringify(bad));
});

test('prices are formatted in the currency\'s own unit', () => {
  assert.equal(account.formatPrice({ unitAmount: 300, currency: 'eur' }, 'en-US'), '€3.00');
  assert.equal(account.formatPrice({ unitAmount: 499, currency: 'jpy' }, 'en-US'), '¥499');
  assert.equal(account.formatPrice({ unitAmount: 1500, currency: 'kwd' }, 'en-US'), 'KWD\u00a01.500');
});

test('the address flags: only the kit\'s values, the rest of the address kept', () => {
  assert.deepEqual(account.landingOf(`${BASE}?purchase=success&a=1#h`), { landing: { signIn: null, purchase: 'success' }, without: '/abientnoiser/?a=1#h' });
  assert.deepEqual(account.landingOf(`${BASE}?signin=ok`), { landing: { signIn: null, purchase: null }, without: null });
  assert.deepEqual(account.landingOf('not a url'), { landing: { signIn: null, purchase: null }, without: null });
});
