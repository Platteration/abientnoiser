/* Sign in with Google and "Support this app", on a site that runs the optional API (server/kit,
   on the site's own origin under api/: Cloudflare Pages' function, or server/start.mjs behind
   nginx). Everywhere else, GitHub Pages included, there is no such API and nothing here draws a
   thing: the page asks api/config once, and an answer of "nothing on", a 404, a network error or
   a body that is not the kit's shape leaves the About dialog as it always was. Nothing is stored
   and nothing is asked again.

   Where it is on, the About dialog gains an Account section (Sign in with Google; then "Signed
   in as …", Sign out and Delete account) and the one thing the site sells, "Support this app".
   A purchase is granted by Stripe's signed webhook alone and read back from api/me; what it
   changes is one line of thanks in About and nothing in the app. A visitor who edits the page
   can show themselves that line without paying: it gates no feature, so there is nothing to
   protect, and the server's record of the payment is what a purchase is.

   Everything the server says is read field by field and drawn as text (createElement and
   textContent), never as markup. Sign-in and Checkout are top-level navigations to Google and
   Stripe, which the page's policy does not govern; the only requests are to the site's own api/
   (connect-src 'self'). The service worker answers none of them (sw.js). */
(function (root) {
  const AN = root.AN = root.AN || {};

  /** The product server/catalogue.js sells, and the entitlement a paid one grants. */
  const SUPPORTER = 'supporter';
  /** An id as the kit writes one: a product, an entitlement. */
  const ID = /^[a-z][a-z0-9-]{0,31}$/;
  /** The only place Buy navigates to. */
  const CHECKOUT_ORIGIN = 'https://checkout.stripe.com';
  /** After Checkout sends the visitor back: api/me up to five times over fifteen seconds. */
  const POLL = { tries: 5, everyMs: 3000 };
  /** How long a note from the account stays up, longer than a control's toast. */
  const NOTE_MS = 8000;

  /** The words the account and the shop say, the same in every app that carries the kit. */
  const WORDS = {
    signIn: 'Sign in with Google',
    signedInAs: (email) => `Signed in as ${email}`,
    signedIn: 'Signed in with Google',
    signOut: 'Sign out',
    deleteAccount: 'Delete account',
    signInFailed: "Sign-in didn't complete.",
    buy: 'Buy',
    signInToBuy: 'Sign in to buy',
    owned: 'Owned',
    thanks: (name) => `Thank you — ${name} is unlocked.`,
    paymentPending: 'Payment received. It can take a minute to appear — reload to check.',
  };

  /** What the page asks before it deletes an account, and what it says when something fails. */
  const NOTES = {
    deleteBody: 'Delete your account? This deletes your account on this site, and your support with it: the thank-you in About goes too. The payment itself stays with Stripe. This cannot be undone.',
    deleteFailed: 'The account could not be deleted. Try again.',
    signOutFailed: 'Could not sign out. Try again.',
    unavailable: 'Support is not on sale right now.',
    busy: 'Too many tries for now. Try again in a while.',
    failed: 'The shop could not be reached. Try again.',
  };

  const SIGNED_OUT = Object.freeze({ user: null, entitlements: Object.freeze([]) });

  const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

  /** Text of at most `max` characters with no control character, or null. */
  function text(value, max) {
    return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
  }

  /** A price as Stripe states it, in the currency's smallest unit; null when it is not one. */
  function readPrice(raw) {
    if (!isRecord(raw)) return null;
    const amount = raw.unit_amount;
    const currency = raw.currency;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null;
    if (typeof currency !== 'string' || !/^[a-z]{3}$/.test(currency)) return null;
    return { unitAmount: amount, currency };
  }

  /** `GET api/config`'s body, or null when the feature does not exist: anything that is not the
   *  kit's shape, and a body with sign-in off (the kit sells nothing without it). "Support this
   *  app" is read from the product list when it is there as this app sells it (once, `payment`);
   *  any other product is not this page's to draw. */
  function readConfig(raw) {
    if (!isRecord(raw) || !isRecord(raw.auth) || raw.auth.google !== true) return null;
    const listed = isRecord(raw.shop) && Array.isArray(raw.shop.products) ? raw.shop.products : [];
    let supporter = null;
    for (const item of listed) {
      if (!isRecord(item) || item.id !== SUPPORTER || item.mode !== 'payment') continue;
      const name = text(item.name, 100);
      const description = text(item.description, 500);
      if (!name || description === null) continue;
      supporter = { id: SUPPORTER, name, description, price: readPrice(item.price) };
      break;
    }
    return { supporter };
  }

  /** `GET api/me`'s body, or null when it is not the kit's shape. */
  function readMe(raw) {
    if (!isRecord(raw) || !Array.isArray(raw.entitlements)) return null;
    let user = null;
    if (raw.user !== null) {
      if (!isRecord(raw.user)) return null;
      user = { email: text(raw.user.email, 320) || null };
    }
    const entitlements = [...new Set(raw.entitlements.filter((e) => typeof e === 'string' && ID.test(e)))].slice(0, 50);
    return { user, entitlements };
  }

  /** Stripe's zero-decimal currencies (499 JPY is ¥499) and three-decimal ones (1500 KWD is
   *  1.500 KWD); every other currency is in hundredths. */
  const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
  const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

  /** A price for people to read, in the visitor's locale (undefined: the browser's own); null
   *  when the browser cannot format the currency, and the product is then shown without one. */
  function formatPrice(price, locale) {
    const divisor = ZERO_DECIMAL.has(price.currency) ? 1 : THREE_DECIMAL.has(price.currency) ? 1000 : 100;
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency.toUpperCase() }).format(price.unitAmount / divisor);
    } catch {
      return null;
    }
  }

  /** What the address said on arrival (the kit's `?signin=failed`, Checkout's `?purchase=`), and
   *  the same address without it, or null when there was nothing of ours to take out. Only the
   *  values the kit writes are read and removed; any other `?purchase=` is not ours and stays. */
  function landingOf(href) {
    let url;
    try { url = new URL(href); } catch { return { landing: { signIn: null, purchase: null }, without: null }; }
    const signin = url.searchParams.get('signin');
    const purchase = url.searchParams.get('purchase');
    const landing = {
      signIn: signin === 'failed' ? 'failed' : null,
      purchase: purchase === 'success' || purchase === 'cancelled' ? purchase : null,
    };
    if (landing.signIn) url.searchParams.delete('signin');
    if (landing.purchase) url.searchParams.delete('purchase');
    if (!landing.signIn && !landing.purchase) return { landing, without: null };
    return { landing, without: `${url.pathname}${url.search}${url.hash}` };
  }

  /** The Checkout address `POST api/checkout` answered with, only when it is Stripe's hosted
   *  page over https; anything else is not followed. */
  function checkoutAddress(raw) {
    if (!isRecord(raw) || typeof raw.url !== 'string') return null;
    let url;
    try { url = new URL(raw.url); } catch { return null; }
    return url.origin === CHECKOUT_ORIGIN && url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  }

  /** Asks `me` up to POLL.tries times, POLL.everyMs apart, until it reports `entitlement`: a
   *  purchase is granted by Stripe's webhook, which may land after the visitor is back. */
  async function pollFor(entitlement, me, wait) {
    let last = null;
    for (let i = 0; i < POLL.tries; i += 1) {
      await wait(POLL.everyMs);
      last = await me();
      if (last && last.entitlements.includes(entitlement)) return { held: true, me: last };
    }
    return { held: false, me: last };
  }

  /** The site's api/, beside the page at `base`, through `fetch`. Every answer that is not what
   *  the kit sends reads as "not available"; nothing throws. */
  function client({ fetch, base }) {
    const api = (route) => new URL(`api/${route}`, base).href;
    const body = async (response) => {
      try { return JSON.parse(await response.text()); } catch { return undefined; }
    };
    const call = async (route, init) => {
      try { return await fetch(api(route), { credentials: 'same-origin', ...init }); } catch { return null; }
    };
    return {
      startUrl: (returnPath) => `${api('auth/google/start')}?return=${encodeURIComponent(returnPath)}`,
      async config() {
        const r = await call('config', {});
        return r && r.ok ? readConfig(await body(r)) : null;
      },
      async me() {
        const r = await call('me', { cache: 'no-store' });
        return r && r.ok ? readMe(await body(r)) : null;
      },
      async signOut() {
        const r = await call('auth/logout', { method: 'POST' });
        return !!r && r.status === 204;
      },
      async deleteAccount() {
        const r = await call('me', { method: 'DELETE' });
        return !!r && r.status === 204;
      },
      /** 'signin' (401), 'pending' (409 `payment_pending`: paid, its webhook not yet recorded),
       *  'owned' (any other 409), 'unavailable' (404), 'busy' (429), 'failed' (anything else, a
       *  502 that pressing again may clear and an address that is not Stripe's included), or
       *  { url } to go to. No 409 carries a Checkout address, so none is followed. */
      async checkout(product) {
        const r = await call('checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product }) });
        if (!r) return 'failed';
        if (r.status === 200) {
          const url = checkoutAddress(await body(r));
          return url ? { url } : 'failed';
        }
        if (r.status === 409) {
          const answer = await body(r);
          return isRecord(answer) && answer.error === 'payment_pending' ? 'pending' : 'owned';
        }
        return { 401: 'signin', 404: 'unavailable', 429: 'busy' }[r.status] || 'failed';
      },
    };
  }

  /**
   * The Account section of the About dialog. `o` carries what the page provides:
   *   doc         the document, to build elements with
   *   fetch       the browser's fetch
   *   location    the window's location (href, pathname, search, assign)
   *   history     for taking the kit's flags out of the address
   *   confirm     the page's confirm (window.confirm)
   *   note        shows a short message (the page's toast)
   *   leave       asked before a navigation to Google or Stripe; false keeps the visitor here
   *   wait        a timer, for the poll after a purchase
   *   els         { section, body, thanks, privacyLocal, privacyAccount }
   * Returns `ready`, which resolves to whether the feature is on, and the state, for tests.
   */
  function start(o) {
    const api = client({ fetch: o.fetch, base: o.location.href });
    const { landing, without } = landingOf(o.location.href);
    if (without !== null) o.history.replaceState(null, '', without);
    const state = { config: null, me: SIGNED_OUT, busy: false };
    const els = o.els;

    const el = (tag, attrs, ...children) => {
      const node = o.doc.createElement(tag);
      for (const [name, value] of Object.entries(attrs || {})) node.setAttribute(name, value);
      node.append(...children);
      return node;
    };
    const button = (label, onClick, id) => {
      const b = el('button', { type: 'button', class: 'ghost sm', ...(id ? { id } : {}) }, label);
      b.disabled = state.busy;
      b.addEventListener('click', onClick);
      return b;
    };
    /** Runs one action at a time: every button of the section is drawn disabled while it is out. */
    const act = async (task) => {
      state.busy = true;
      render();
      try { await task(); } finally { state.busy = false; render(); }
    };
    const owns = () => state.me.entitlements.includes(SUPPORTER);

    function render() {
      if (!state.config) return;
      const { config, me } = state;
      els.section.hidden = false;
      els.privacyLocal.hidden = true;
      els.privacyAccount.hidden = false;
      els.thanks.hidden = !owns();
      const parts = [];
      if (me.user) {
        parts.push(el('p', { class: 'signed-in' }, me.user.email ? WORDS.signedInAs(me.user.email) : WORDS.signedIn));
        parts.push(el('div', { class: 'inline wrap' }, button(WORDS.signOut, signOut, 'accountSignOut'), button(WORDS.deleteAccount, deleteAccount, 'accountDelete')));
      } else {
        parts.push(el('div', { class: 'inline wrap' }, button(WORDS.signIn, signIn, 'accountSignIn')));
      }
      const product = config.supporter;
      if (product) {
        const price = product.price ? formatPrice(product.price) : null;
        const heading = el('p', {}, el('strong', {}, product.name));
        if (price) heading.append(` · ${price}`);
        const action = owns()
          ? el('p', { class: 'owned' }, WORDS.owned)
          : me.user ? button(WORDS.buy, buy, 'supportBuy') : button(WORDS.signInToBuy, signIn, 'supportBuy');
        parts.push(el('div', { class: 'product' }, heading, el('p', { class: 'hint' }, product.description), action));
      }
      els.body.replaceChildren(...parts);
    }

    /** Keyboard focus to the section's first control, after a re-render took the one it was on. */
    const refocus = () => {
      const first = els.body.querySelector('button');
      if (first && first.focus) first.focus();
    };

    function signIn() {
      if (!o.leave('signin')) return;
      o.location.assign(api.startUrl(`${o.location.pathname}${o.location.search}`));
    }

    function buy() {
      return act(async () => {
        if (!o.leave('checkout')) return;
        const result = await api.checkout(SUPPORTER);
        if (typeof result === 'object') { o.location.assign(result.url); return; }
        if (result === 'signin') state.me = SIGNED_OUT;
        if (result === 'owned' || result === 'pending') state.me = (await api.me()) || state.me;
        // Paid, and the kit gives no second Checkout for it: say the purchase is on its way.
        if (result === 'pending' && !owns()) o.note(WORDS.paymentPending, NOTE_MS);
        if (result === 'unavailable') o.note(NOTES.unavailable, NOTE_MS);
        if (result === 'busy') o.note(NOTES.busy, NOTE_MS);
        if (result === 'failed') o.note(NOTES.failed, NOTE_MS);
      });
    }

    function signOut() {
      return act(async () => {
        if (await api.signOut()) state.me = SIGNED_OUT;
        else o.note(NOTES.signOutFailed, NOTE_MS);
      }).then(refocus);
    }

    function deleteAccount() {
      if (!o.confirm(NOTES.deleteBody)) return Promise.resolve();
      return act(async () => {
        if (await api.deleteAccount()) state.me = SIGNED_OUT;
        else o.note(NOTES.deleteFailed, NOTE_MS);
      }).then(refocus);
    }

    async function afterPurchase(product) {
      if (owns()) { o.note(WORDS.thanks(product.name), NOTE_MS); return; }
      const { held, me } = await pollFor(SUPPORTER, api.me, o.wait);
      if (me) state.me = me;
      render();
      o.note(held ? WORDS.thanks(product.name) : WORDS.paymentPending, NOTE_MS);
    }

    const ready = (async () => {
      const config = await api.config();
      if (!config) return false;
      state.config = config;
      state.me = (await api.me()) || SIGNED_OUT;
      render();
      if (landing.signIn === 'failed') o.note(WORDS.signInFailed, NOTE_MS);
      if (landing.purchase === 'success' && config.supporter) await afterPurchase(config.supporter);
      return true;
    })();
    return { ready, state, render };
  }

  AN.account = {
    SUPPORTER, WORDS, NOTES, POLL, SIGNED_OUT,
    readConfig, readMe, formatPrice, landingOf, checkoutAddress, pollFor, client, start,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
