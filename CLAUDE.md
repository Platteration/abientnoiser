# Ambient Noiser — working notes

Read AGENTS.md first. It holds the working rules every coding agent follows in this repository; this file adds the notes specific to this project.

A static web app with no runtime dependencies that generates hour-long looping soundscapes
with the Web Audio API. No build step and no samples. `npm start` serves it; `index.html`
loads the scripts in dependency order. It is also a website: the host serves the files
`scripts/site.js` lists, with the headers in `_headers`, `.htaccess` and `deploy/nginx.conf` —
everything the app does still happens in the visitor's browser.

There is no server, with one optional exception the owner asked for: a small backend for
**sign in with Google and a "Support this app" payment through Stripe**, which runs only where
the host runs functions on the site's own origin (Cloudflare Pages Functions, or
`server/start.mjs` behind nginx's `location ^~ /api/`) and is off until its variables are set.
It is `server/kit/` (the shared kit, copied byte for byte), driven by `server/catalogue.js`;
see "Sign-in and the shop" below. On GitHub Pages and every other static host nothing of it
runs, and the app looks and behaves as it did before it existed.

## Layout

| File | Role |
| --- | --- |
| `js/guard.js` | the safety net, loaded first: a note in place of the controls when the page cannot start |
| `js/prng.js` | seeded random numbers (`AN.rng`) |
| `js/timer.js` | `AN.ticker` — a worker interval that survives a background tab |
| `js/theory.js` | modes, diatonic chords, voicings |
| `js/composer.js` | styles, moods, dayparts, `AN.compose` → a plan |
| `js/audio/graph.js` | shared `Output`, buses, reverbs, tape path, noise beds |
| `js/audio/synths.js` | pad, drone, bell, electric piano, piano, pluck, bass |
| `js/audio/drums.js` | three kits (`lofi`, `brush`, `electro`) and their patterns |
| `js/audio/ambience.js` | twelve environment textures |
| `js/audio/engine.js` | `Engine` (performs a plan) and `Transport` (scheduler/clock) |
| `js/audio/recorder.js` | live recording, chunked WAV export |
| `js/storage.js` | library, autosave, preferences, share codes |
| `js/install.js` | `AN.installPrompt` — the header's Install button behind `beforeinstallprompt` (Chromium only; Safari never fires it, so the button starts hidden) |
| `js/account.js` | `AN.account` — the About dialog's Account section and "Support this app", drawn only where `api/config` says sign-in is on |
| `js/visual.js`, `js/card.js`, `js/app.js` | visualiser, share image, UI |
| `scripts/serve.js`, `scripts/hosts.js` | the dev server, and the Host names it answers to (loopback; off loopback also this machine's own names, `.local`, and `ALLOWED_HOST`); it serves the website's files (`scripts/site.js`, with `sw.js`'s shell read again on every request) and nothing else of the checkout, and decides that on the path the filesystem resolves (`servable`), not on the address as written, which on Windows reached `.git` through `\` and `GIT~1` |
| `scripts/site.js` | the website: `SHELL` plus `EXTRA`, written into a folder, or listed for the Pages deploy |
| `404.html`, `robots.txt`, `.well-known/security.txt` | the rest of the website |
| `_headers`, `_redirects`, `.htaccess`, `deploy/nginx.conf` | Netlify/Cloudflare, Netlify, Apache and nginx settings: one set of headers |
| `server/kit/` | the shared sign-in, shop and webhook kit: copied verbatim, never edited here (`server/kit/README.md`) |
| `server/catalogue.js`, `server/start.mjs`, `server/package.json` | what the site sells; the API on a host of its own (Node, loopback, behind nginx); `"type": "module"` for both |
| `functions/api/[[path]].js`, `_routes.json` | the API as a Cloudflare Pages Function, and the routes file that sends it `/api/*` alone |
| `api/config` | the answer "nothing on", published with the site for a host that runs no API |
| `tsconfig.json` | type-checks `server/` and `functions/` (`npm run typecheck`) |

## Invariants worth knowing

These are the things that have actually caused bugs here.

**Everything random is seeded.** All decisions come from `AN.rng(seed, ...parts)`,
keyed on things like `(seed, 'step', section, bar, sixteenth)`. `Math.random` belongs
only in `AN.randomSeed`. Adding or removing a draw shifts every later value for that
key, which changes existing seeds — fine, but do it knowingly.

**Scheduling time is not heard time.** `Transport` schedules ~2.5 s ahead of the
clock. `now()` reports the *listener's* position. Anything that changes `baseCtx`
before playback reaches it must defer the clock change via `clockFrom`, or the UI
jumps ahead of the audio. This is how a locked movement repeats.

**Offline is not live.** `graph.offline` is detected from the context. An offline
render schedules a whole chunk in one synchronous turn, so nothing has ended and
`sources.size` only grows — real-time guards like the source cap (`hasRoom`) must not
apply there, or the export silently loses its ambience.

**Swing is a ratio: 0.5 is straight.** A style declaring `swing: [0, 0]` would pull
every odd sixteenth a whole step *early*. `compose` clamps to `[0.5, 0.8]`.

**Tone scales the voice filters, it is not an EQ.** `settings.tone` (0.5–2, centre 1)
multiplies the pad and drone cutoffs and the lo-fi master filter, so it changes what
the voices generate rather than boosting what is not there. Judge it with a spectral
centroid, not a share-of-energy figure: for tonal material the fundamentals dominate
the energy no matter how bright the top is, which made an early measurement of mine
badly misleading.

**Levels multiply three ways**: `layer.input` (the movement's own multiplier) ×
`layer.user` (the mixer) × `engine.duck` (breaks, focus modes). `applyLevels` is the
only thing that should write `user`.

**Bus routing matters.** Pads, arpeggio and drone go through `pump` so the kick can
duck them; drums use the short room impulse, everything else the hall.

**Anything from outside is untrusted.** Share links carry base64 JSON. Everything goes
through `AN.storage.cleanSettings` before use, and nothing is rendered as HTML: `app.js`
builds every element with `h()` (createElement, setAttribute, text as text), and the page's
Trusted Types policy makes `innerHTML` and every other HTML string sink a TypeError, so a
string slipped in later fails loudly rather than parsing. Whitelists are own-property
lookups (`has(TABLE, id)`), never a bare `TABLE[id]`: every name on `Object.prototype` —
`constructor`, `__proto__`, `toString` — is truthy on a plain table and used to pass as a
valid style, mood or mode. A share link is not written to the autosave until the visitor changes something,
so opening one cannot quietly replace the mix they were building.

**Selects hold strings.** `buildSelect` compares with `String(v) === String(current)`.
Comparing with `Number()` silently fails for every string-valued select.

**The service worker's cache name is derived, not typed.** `sw.js` answers the shell
from the cache, so a build only reaches an existing visitor when `VERSION` changes —
and a byte-identical `sw.js` is never even reinstalled. `VERSION` is a hash of the
shell files' contents (`test/shell.test.js` recomputes it and fails when it drifts,
printing the value to paste in), and the Pages deploy re-stamps it with the commit
sha. Shell hits are also revalidated in the background, and navigations match the one
cached document with the query string ignored, so `?mix=…` links do not each add a
copy. Cache Storage is partitioned by *origin*, not by worker scope, and a GitHub Pages
project site shares its origin with every other app the account publishes. The two
scopes differ, and both matter: the sweep on activate deletes only `PREFIX`-named
caches, since an unfiltered `caches.keys()` sweep destroys the co-tenants' offline
shells, while every read goes through *this build's own* `VERSION` cache rather than
the origin-wide `caches.match()`, which can answer with a co-tenant's copy of one of
our URLs. A read scoped to the prefix instead would search every past version's cache,
which is exactly the staleness the derived `VERSION` exists to prevent. And a cache
that will not open counts as a miss, not as a failure: `lookup` heads the fetch
handler's chain, so an uncaught rejection there is a network error for every request
the worker intercepts, the navigation included, online or offline.

**Lists that grow from outside are bounded where they are written — and a bound must
not eat the visitor's own work.** The library is capped in `js/storage.js` at
`MAX_MIXES` records *and* `MAX_BYTES` of serialised JSON, because the count alone does
not bound the size: one record carrying an edit for every movement serialises to fifty
times a plain one. `importJSON` leaves out what does not fit and reports it as `full`.
`save` throws at the ceiling rather than dropping the oldest mix: the tail of a full
library is the visitor's own work, a truncation cannot be undone, and a refusal can —
they delete something they chose. The ceiling is in the library hint and in the heading
count before it ever bites, and the messages quote what this library holds rather than
the constant, because nothing trims a library that is already over the ceiling. A cap
applied where the list is *read* would leave the storage full; 'Clear all mixes' is the
way back out, and `storageRefused()` points at it once the library is what filled the
quota.

**Stored data is untrusted input.** `localStorage` and Cache Storage are keyed by
*origin*, which a GitHub Pages project site shares with every other app the account
publishes, so "only this app writes that key" is not true here. `cleanSettings` on the
way *in* says nothing about what comes back out: `storage.list()` drops a record it
cannot render and cleans the rest, and `str`/`num`/`has` refuse to coerce an object —
`String({toString: 'x'})` throws, as does using one as a property key. `init()` calls
`bind()` before anything draws stored content, and the draw itself goes through
`renderStored()`, which degrades to an empty library with a visible message: with
`renderLibrary()` running first, one unreadable record left every control on the page
unwired, on every load, with no way back from inside the app.

**The policy is written in five places and measured, not guessed.** `_headers`, `.htaccess`,
`deploy/nginx.conf`, and the `<meta>` of `index.html` and `404.html` (which leaves out
`frame-ancestors`, which a meta cannot carry, and `upgrade-insecure-requests`, which would break
`HOST=0.0.0.0 npm start` for a phone on plain http). `test/website.test.js` holds them equal:
change one, change all five. Every source is there because Chromium needed it with the policy
sent as a header: `connect-src 'self'` is the service worker (with `'none'` it installs and
caches nothing, with no error on the page) and the page's requests to the site's own `api/`
(with `'none'`, `api/config` is refused and `test/site.smoke.mjs` fails on it); `worker-src
blob:` is `AN.ticker` (without it the `try` in `timer.js` falls back to `setInterval`,
silently, and the timers stall in a background tab — `test/site.smoke.mjs` checks the worker
exists); the `trusted-types` names are the two `createPolicy` calls, one in `timer.js` and
one in `app.js`'s `workerURL()`, because under Trusted Types `new Worker()` and `serviceWorker.register()` take a TrustedScriptURL, not a
string; the `style-src` hash is `404.html`'s inline style, so editing that style means pasting
the new hash the test prints into all five places (and the shell's `VERSION`, since
`index.html` carries it). Styles go through the style object (`el.style.x = …`), never a
`style=""` attribute, which the policy refuses.

**The website is `scripts/site.js`'s list and nothing else.** `SHELL` from `sw.js` plus
`EXTRA` (the worker, `404.html`, `robots.txt`, `security.txt`, `LICENSE`, `api/config`); the
Pages deploy `git archive`s exactly that list out of the commit, and `test/website.test.js` reads the nginx,
Apache and Netlify rules the way each host does and checks every other repository file answers
404 (nginx and Apache allow a pattern of the site's paths; `_redirects` lists the repository's
own top-level entries, so a new one goes there too). `js/guard.js` loads before everything and
depends on nothing: with `no-js` still on `<html>`, a failed script or stylesheet, or a throw
from one of the site's own scripts before `init()` adds `started` to `<html>`, it shows
`#startNote` and the CSS hides the controls. After `started` the app reports its own failures.
`init()` also takes `no-js` off and sets the note's `hidden` attribute there, because when
`guard.js` or `css/style.css` is the file that failed nothing else does, and the app started
but showed a note saying it had not (with the guard missing, its controls hidden behind it). A failed
script keeps the note up all the same, since `.start-failed .start-note` outranks the attribute;
`test/site.smoke.mjs` aborts each of the three in turn.

**Timers with deadlines use `AN.ticker`, not `requestAnimationFrame`.** Browsers pause
animation frames in hidden tabs, which is exactly when this app is playing. Drawing
may use frames; the sleep timer, focus timer and queue may not.

## Settings

Three localStorage keys, named once in `js/storage.js` (`KEYS`) and pinned as literals by
`test/settings-contract.test.js`: `ambientnoiser.mixes.v1` (the library),
`ambientnoiser.autosave.v1` (the mix being worked on) and `ambientnoiser.prefs.v1` (the
preferences). The preferences record holds `theme` (`system`, `dark`, `light`, `black`),
`visuals` (`on`, `off`, or `null` for "not chosen", which follows `prefers-reduced-motion`
— the Visuals row *is* this app's motion control), `quiet`, `queue` (ids of saved mixes),
`queueEvery` and `crossfade`. `cleanPrefs(raw, fallback)` in the same file is the
validator: every read and every write goes through it, the enum tables (`THEMES`,
`VISUALS`, `QUEUE_MINUTES`, `CROSSFADES`) are looked up by own property, and a field that
does not hold up falls back to its default on its own, never the record as a whole.
`app.js` builds the header selects from those tables and only adds labels. "Reset
preferences" in the header is confirmed with `window.confirm()` and writes the defaults
to `prefs.v1` only: the queue stays (it lists the visitor's own mixes, which is not a
preference), and the library and autosave are other records it never touches. The
About dialog shows `APP_VERSION` from `js/app.js`, which the contract test pins to
`package.json`; it is deliberately not `sw.js`'s `VERSION`, which hashes the shell bytes
rather than naming a release. Header controls that toggle carry `aria-pressed`; one with
no text carries an `aria-label`.

## Sign-in and the shop

The owner asked for every app to be ready for sign in with Google, a shop and webhooks: per-app
functions on the same origin, Stripe Checkout and its webhook, web first. Here that is
`server/kit/`, copied verbatim from the shared kit (`diff -r` against the canonical copy is
empty; a change is made there and copied, never here), with this app's catalogue:

- **What is sold**: one product, `supporter` ("Support this app", one-time), granting the
  entitlement `supporter`, whose Stripe Price is `STRIPE_PRICE_SUPPORTER`. What it changes is
  one line in the About dialog, "Thank you for supporting Ambient Noiser.", and nothing in the
  app. A visitor who edits the page can show themselves that line: it gates nothing, and the
  server's record of the payment is what a purchase is.
- **Where it runs**: `functions/api/[[path]].js` on Cloudflare Pages, which `_routes.json`
  (published by `scripts/site.js --host=cloudflare` alone) limits to `/api/*`; or
  `server/start.mjs` on 127.0.0.1:8788 behind `deploy/nginx.conf`'s `location ^~ /api/` (for
  Apache, a `ProxyPass` in the virtual host, since `.htaccess` cannot proxy). Its one
  `add_header` is the server block's HSTS line, as written there: a location that adds a header
  inherits none of the server block's, which is what keeps the page's headers off the API's
  answers, and `test/website.test.js` allows that one location and no other. Cloudflare's
  documentation (read from the `cloudflare/cloudflare-docs` sources: `pages/configuration/headers.mdx`,
  `redirects.mdx`, `functions/routing.mdx`) says `_headers` and `_redirects` are not applied to
  what a Function serves, so the kit sends its own headers; a Pages project on the Free plan
  that has used its daily Functions allowance and fails open serves static assets in place of
  the Function, which here is `api/config` saying nothing is on.
- **Off until keyed**: with no variables, `api/config` answers `{"auth":{"google":false},…}`
  and every other route is a 404. The site also publishes that same answer as a static file,
  `api/config`, so on a host with no API (GitHub Pages, Netlify, a folder) the page's one
  question is answered rather than logged as a 404; `test/api.test.mjs` holds the file equal
  to what the kit answers.
- **The page** (`js/account.js`, loaded before `js/app.js`, started at the end of `init()`):
  asks `api/config` once, relative to the page, and on a 404, a network error, a body that is
  not the kit's shape or sign-in off draws nothing, stores nothing and asks nothing again.
  Where sign-in is on, the About dialog swaps its privacy sentence for the exact one and draws
  an Account section: "Sign in with Google" (a top-level navigation to
  `api/auth/google/start?return=<this page>`), or "Signed in as …", Sign out and Delete account
  (confirmed with `window.confirm`); and "Support this app" with Stripe's price and Buy, "Sign
  in to buy" or "Owned". Buy follows the Checkout address only when it is
  `https://checkout.stripe.com/…`. Back from Google with `?signin=failed`, or from Stripe with
  `?purchase=`, the flag leaves the address at once; after `?purchase=success` the page asks
  `api/me` five times over fifteen seconds for the thank-you. Leaving for Google or Stripe asks
  first when a recording, a WAV export or an unsaved shared mix would be lost (`leaveFor` in
  `app.js`); the working mix is saved on the way out, as on any unload. Everything the server
  says is read field by field and drawn with `createElement` and text. No storage key is
  added: the account is held in memory and in the API's `__Host-` cookie.
- **The service worker** answers nothing under `api/` and caches nothing of it, a navigation
  included (`API` in `sw.js`): the sign-in start and Google's redirect back to the callback are
  navigations in its scope, and answered with the cached page, as every other navigation is
  offline, the callback would never reach the API. `test/shell.test.js` drives the handler
  for it, and the browser suite runs the sign-in through a real worker.
- **The policy does not change**: `connect-src 'self'` was already there, and Google and
  Stripe are top-level navigations, which the policy does not govern. Nothing of Google's or
  Stripe's is loaded.
- **Tests**: the kit's self-test (`server/kit/selftest.mjs`) runs in `npm test`;
  `test/api.test.mjs` drives the catalogue through both entry points with the fakes of
  `test/api-fakes.mjs` injected through the kit's `fetch` (never a variable that points the kit
  at another host); `test/account.test.js` drives `js/account.js` against a fake fetch and
  document; `test/site.smoke.mjs` runs the whole flow in Chromium under the site's policy with
  the kit mounted at `/abientnoiser/api/` (sign in, buy, the signed webhook, the thank-you,
  sign out, sign in again, delete) and a host whose `api/config` is a 404; and
  `test/hosts.smoke.mjs` puts `server/start.mjs` behind the real nginx and an Apache
  `ProxyPass`. What the owner sets up is in `server/kit/README.md` and README's "Sign in and
  Support this app".

## Tests

```bash
npm run typecheck      # tsc over server/ and functions/: the kit and this app's API entry points
npm test               # node --test: PRNG, theory, composer, styles, app shell, website, dev server, account, API, and the kit's self-test
npm run test:musical   # every style's whole loop checked for wrong notes and wrong timing
npm run test:textures  # each texture checked against the sound it claims to be
npm run test:e2e       # Playwright + Chromium, end to end: the app, then the built website; then nginx and Apache
npm run test:conventions  # the repository's shape against CONVENTIONS.md
npm run check          # typecheck + npm test + test:conventions: the gate before a push
npm run test:all
```

`test:musical` stubs the synths and drum voices and checks every scheduled note and
hit: in key, in register, a real MIDI number, and landing on its own step — swung
forward only, never early. When adding a musical invariant, mutation-test it: break
the code deliberately and confirm the suite fails. Derive a bound from something other
than the value under test, or a bug will excuse itself (the swing bug did exactly
that).

The browser suite also feeds itself a hostile share link, a hostile library import and
a hostile *stored* library (then clicks Play, because "no exception was logged" is not
the same as "the app still works"), and checks every focusable control has an
accessible name. It drives the service worker against a planted co-tenant cache with
the dev server killed, which is the only way to tell a worker that reads its own cache
from one that reads the origin's — a regex over `sw.js` cannot. `test/shell.test.js`
loads `sw.js` with its globals stubbed and drives the real fetch handler for the cases
a browser will not stage on demand, such as a cache that refuses to open.

`test/site.smoke.mjs` builds the site and serves it at `/abientnoiser/`, as Pages serves a
project site, sending each response the headers `_headers` gives it and answering a missing
address with `404.html`; it drives the main flow and fails on any violation (collected from every
document through an exposed binding, since a navigation drops a page's own record), page error,
console error or request outside the site. Its Trusted Types probes are violations by design, so
they run in pages of their own whose reports are not counted. It also reads
`document.featurePolicy.allowedFeatures()` back and fails on anything but `autoplay`,
`clipboard-write` and the client hints, so a Playwright whose Chromium knows a new feature fails
it until the feature is denied in `_headers`, `.htaccess` and `deploy/nginx.conf`.

`test/hosts.smoke.mjs` (the last part of `test:e2e`) loads `deploy/nginx.conf` into the nginx
installed where it runs and the built site's `.htaccess` into Apache, over https and behind a
proxy that sends `X-Forwarded-Proto`, and reads every file of the site and a checkout's files
planted beside it back off the real servers. A file that only website.test.js reads can still
fail to load (`http2 on;` is nginx 1.25.1 and later; Ubuntu 24.04 ships 1.24) or send something
other than it says (Apache's `env=HTTPS` is mod_ssl's alone, so behind a proxy HSTS never went
out). Where nginx or Apache is missing it says so and passes, unless `CI` is set.

`test:textures` is the only check on how things actually sound. Nobody has heard this
app; spectral balance is the closest available proxy. It puts the piece into a bright
morning movement so even the rare textures fire, rather than hoping one lands inside
the window.

The browser suite spawns the dev server on a random port and waits for it to answer.
It asserts against measured behaviour (levels, source counts, render times), so widen
a bound only when you have measured that the old one was wrong.

Playwright, TypeScript and `@types/node` are the only dependencies, all of them for
development: Playwright for the browser suites, TypeScript for `npm run typecheck`, which the
conventions test requires once the kit's `.d.ts` files are in the tree (the kit passes this
repository's strict `tsconfig.json` unchanged). The site ships none of them; the lockfile pins
the versions, and CI installs with `npm ci`.

## Things deliberately not done

- **Export speed.** Roughly 7x real time for music alone, 3.5x for a typical mix, 2x
  with all twelve textures. The cost is node lifecycle in the audio graph, not the
  composer. Shortening one-shot lifetimes and skipping offline teardown both measured
  as noise. Baking one-shots into pre-rendered buffers would roughly halve the node
  count, at the cost of changing how the ambience sounds.
- **Bit-exact renders.** Two renders of the same settings differ by far less than a
  16-bit step; Chromium's own float mixing is not reproducible run to run.
- **Payments beyond one "Support this app".** The owner asked for sign-in and a shop
  through an optional backend that runs only where the host runs functions (see "Sign-in
  and the shop"). It sells one thing, which changes nothing in the app; no feature is paid.

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. The repository's check command (`npm run check`, or
`ruff check .` then `pytest -q` in a Python repository) is the gate before a push. To
change a convention, change it in every repository in one pass and update the hashes in
the test.
