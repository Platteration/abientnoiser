# Ambient Noiser

Hour-long, seamlessly looping soundscapes for work, study and sleep — generated live in your browser with the Web Audio API. Every piece is built from simple synths (pads, electric piano, piano, bells, plucks, bass, and three drum kits) and procedural environment sounds (rain, thunder, wind, ocean, creek, fireplace, birds, crickets, wind chimes, café, night train, vinyl crackle), and it changes **mood every few minutes**, like movements in a long song. Nothing is downloaded or uploaded, and there are no samples: the music needs no server. A site that runs the optional API (see "Sign in and Support this app") also offers sign-in with Google and a one-time "Support this app" payment; everywhere else, GitHub Pages included, there are no accounts and no server at all.

## Features

**The music**

- **Eight styles**: Ambient Drift, Lo-fi Hip Hop, Deep Focus, Deep Space, Rainy Night, Piano Nocturne, Cassette Synthwave, Late Jazz Trio.
- **Mood movements** — a seeded composer lays the hour out as 8 to 20 movements, one every ~4 minutes by default. Each gets its own key, mode, chord progression, tempo, brightness and density. "Still Water" gives way to "Rising Sky", tension resolves into release, and the arc settles down at both ends so the loop seam is calm.
- **Three drum kits** — dusty lo-fi with swing and ghost notes, jazz brushes with a swung ride and cross-stick, and a straight electro kit with a layered clap. Walking bass for the jazz trio; sidechain pumping under the kick where the style calls for it; tape wow and flutter on the tape-flavoured styles.
- **Seamless looping** — 30 to 120 minute loops, where the last movement flows back into the first.
- **Same seed, same hour** — every random decision comes from a seeded generator, so a seed always reproduces the same piece, each loop is identical, and an export sounds exactly like playback.

**Playing it**

- **Environment mixer** — twelve textures that ride along with the mood: heavier rain and thunder in restless movements, birdsong when the music lifts, chimes tuned to the movement's own key. Nine one-click presets (rainy window, thunderstorm, campfire night, café, seaside, forest creek, night train, chimes, silence).
- **Mood steering** — jump to a calmer or brighter movement, skip ahead, or lock one movement on repeat.
- **Focus timer** — 25+5, 50+10 or 90+20. Breaks step the mix back instead of stopping it, with a chime at each change.
- **Time of day** — fixed or following the clock, colouring moods, brightness, tempo and environment.
- **Edit any movement** — override its mood, key, mode and length. A movement given a length keeps it and the rest share out what is left, so the loop stays exactly as long as you asked for.
- **Queue with crossfade** — line up saved mixes and they fade from one into the next, whole loop by whole loop or on a timer. Good for a working day.
- **Tone** — one control that opens or closes the voice filters, from half to double. The music is deliberately dark (in Ambient Drift the octave above 250 Hz sits about 23 dB below the one below it), which suits pads but may read as dull on some systems; the centre of the slider is the sound as designed, and moving it right raises Ambient Drift's spectral centroid from 230 to 305 Hz and Lo-fi's from 620 to 980.
- **Quiet mode, visualiser, themes** — hide everything but the player, watch slow drifting bands coloured by the current movement, and pick system, dark, light or OLED black.
- **Sleep timer** that fades out rather than cutting, media keys and lock-screen controls, and keyboard shortcuts. Timers keep running while the tab is in the background, which is the whole point — on desktop and on Android. iOS is the exception: Safari suspends a Web Audio session when the screen locks, so playback and the timers stop there until you come back to the tab, and the lock screen shows no controls.
- **Accessible and considerate** — the timeline is a keyboard slider, movement changes are announced, focus is visible, and `prefers-reduced-motion` is honoured. Under heavy load the incidental one-shots thin out so musical notes never drop.

**Keeping it**

- **Save mixes** to a browser library — up to 500 of them, after which Save is refused rather than dropping an older mix, so nothing you saved disappears without you deleting it. Copy a share link that recreates a mix exactly, export or import the library as JSON (one button empties it), and save a picture of a mix as a PNG card.
- **Save as audio** — record what you hear in real time, or export the loop as a WAV rendered offline. Long exports render in five-minute chunks with a progress bar and a cancel button, so even a full hour fits in memory. Rendering is faster than real time, but not by a huge margin once the environment layers are on: roughly 7x for music alone, 3.5x for a typical mix, 2x with all twelve textures running — so a full hour takes something like fifteen to thirty minutes. The cost is the sheer number of short one-shot voices; it is the audio graph, not the composer.
- **Works offline** — the app installs as a PWA and runs with no network at all.

| Key | Action |
| --- | --- |
| `Space` | play / pause |
| `←` `→` | skip 30 seconds |
| `N` `P` | next / previous movement |
| `Q` `Esc` | quiet mode |
| `Home` `End` `PgUp` `PgDn` | on the focused timeline: start, end, back or forward five minutes |

## How it works

```
seed + style + time of day + edits
        │
        ▼
    composer ──► plan (movements: key, mode, tempo, chords, layer levels, ambience weights)
        │
        ▼   transport walks 16th-note steps 2.5 s ahead of the clock
        │
   ┌────┴─────────────────┬──────────────────────┐
 synths                 drums                 ambience
 pad · drone · bell    lo-fi · brush        rain · thunder · wind · waves · creek
 piano · e-piano       · electro            fire · birds · crickets · chimes
 pluck · bass                               café · train · vinyl
   └────┬─────────────────┴──────────────────────┘
        ▼
 layer gains (mood x mixer x duck) ─► pump bus ─► tape wobble ─► filter ─► saturation
        └─► sends ─► hall / room reverb ──────────────────────────────► compressor ─► output
```

Every random decision is drawn from a generator keyed on `seed + movement + bar + step`, which is what makes a seed reproducible, a loop identical to the last, and an offline export the same as what you heard.

## Running it

A static site with no build step and no dependencies.

```bash
npm start            # serves http://localhost:5173
# or: python3 -m http.server 5173
```

`npm start` serves the website and nothing else of the checkout: the files
`scripts/site.js` lists (see Deploy), with the service worker's shell read again on every
request, so a module added to it is served without a restart; anything else is a 404. It
listens on loopback only. To reach it from a phone on the same network, opt in with
`HOST=0.0.0.0 npm start`: the server then answers to this machine's addresses, its
hostname and mDNS names such as `laptop.local`, and reads its interfaces again on a miss,
so a Wi-Fi joined after the start still works. Reaching it any other way — a port forward,
a tunnel, a name your router hands out — needs that address in `ALLOWED_HOST` (a
comma-separated list, ports ignored). Any other `Host` gets a 403, and one line on the
terminal the first time that name is seen, which is what keeps a page you visit from
reaching the server by pointing its own name at 127.0.0.1. Whatever the address, a file is
served only when the path the filesystem resolves it to is one of the site's files, so
`.git`, the notes and the tests stay out however they are spelled: on Windows that
includes `\` and short names such as `GIT~1`, and anywhere a link that points elsewhere.

Opening `index.html` from disk also works, except for the offline service worker.

### Deploy

The app is also a website, and the website is the files the page loads and nothing else: the
page and its not-found page, the stylesheet, the scripts, the service worker, the manifest and
icons, `robots.txt`, `.well-known/security.txt` and the licence. `node scripts/site.js <folder>`
writes them into an empty folder and `node scripts/site.js --list` names them; the list is the
service worker's shell plus those few files (and `api/config`, the answer "no sign-in here" for
a host that runs no API), so nothing else in the repository — notes, tests, the dev server, the
hosting configs, the API's code — is ever published. Everything the app does still happens in
the visitor's browser: the host serves files, and nothing the app makes is sent anywhere. The
one optional exception, sign-in and a payment, is below.

A GitHub Pages workflow is included (`.github/workflows/pages.yml`). Enable **Settings → Pages →
Source: GitHub Actions** and every push to `main` publishes exactly that list, taken out of the
commit.

Any static host will serve the folder. The repository carries the settings of the common ones,
with the same headers in each:

| Host | Build the folder with | Settings it reads |
| --- | --- | --- |
| Netlify | `node scripts/site.js <folder> --host=netlify` | `_headers`, `_redirects` |
| Cloudflare Pages | `node scripts/site.js <folder> --host=cloudflare` | `_headers`, and `_routes.json` for the optional API |
| Apache | `node scripts/site.js <folder> --host=apache` | `.htaccess` |
| nginx | `node scripts/site.js <folder>` | `deploy/nginx.conf`, copied into the server's config by hand (any nginx from 1.9.5: Debian 12's 1.22 and Ubuntu 24.04's 1.24 load it); delete its `location ^~ /api/` block unless `server/start.mjs` runs (below) |
| GitHub Pages | the workflow | none: see below |

**Apache** reads `.htaccess` only where the server configuration lets it, and no `.htaccess` can
set that part itself. Give the folder `AllowOverride FileInfo Indexes Options` (or
`AllowOverride All`): the file sets `DirectoryIndex`, which needs `Indexes`, and with `FileInfo
Options` alone Apache 2.4.58 answers every request 500 (measured). Load `mod_rewrite` and
`mod_headers` (`a2enmod rewrite headers`), which a stock Debian or Ubuntu Apache leaves off:
nothing in the file is wrapped in `<IfModule>`, so without them every request is a 500 and the
error log names the directive, where a wrapped rule was skipped without a word and the folder went out
with no headers and no allow-list. And set `ServerTokens Prod` in the server configuration, so no
answer names Apache's version.

Serve it over HTTPS only: the Apache and nginx settings redirect plain `http://`, and Netlify,
Cloudflare Pages and GitHub Pages each have a switch for it. Never point a web server at a git
checkout, whose `.git/` holds the whole history. If it happens anyway, the Apache and nginx
settings serve the site's own files and answer 404 for everything else, and `_redirects` does
the same for the repository's files on Netlify; Cloudflare Pages has no 404 rule, so there the
folder is the only protection.

**Response headers.** The same set is in `_headers`, `.htaccess` and `deploy/nginx.conf`, on every
path of the site, and `test/website.test.js` fails when one of them says something the others do
not; `test/hosts.smoke.mjs` loads the nginx and Apache files into real servers and reads the
headers back off every response:

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self' 'sha256-…'; img-src 'self'; worker-src 'self' blob:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; require-trusted-types-for 'script'; trusted-types ambient-noiser-ticker ambient-noiser-sw; frame-ancestors 'none'; upgrade-insecure-requests` | Only the site's own scripts run, and nothing inline or evaluated. Each source was measured in Chromium with the policy sent as a header: the hash is the not-found page's inline style; `blob:` workers are the background timer (`js/timer.js`), without which the sleep timer, focus timer and queue would fall back to a timer the browser throttles in a background tab; `connect-src 'self'` is the service worker fetching the site's own files, and the page asking the site's own `api/` whether sign-in is on (and, where it is, the account's requests), the only network code there is. Trusted Types make an HTML string sink a TypeError, so text from a share link or a stored mix can only ever be text; the two named policies vouch for the timer's `blob:` URL and for `sw.js`, nothing else. |
| `X-Content-Type-Options` | `nosniff` | A file is what its type says. |
| `X-Frame-Options` | `DENY` | With `frame-ancestors 'none'`: no other site can frame the app and steer its buttons (clickjacking). |
| `Referrer-Policy` | `no-referrer` | A share link carries a whole mix in its address; no other site is told it. |
| `Permissions-Policy` | every feature Chromium knows off — camera, microphone, location, sensors, USB, payment, local network access, the ad and attribution APIs, the on-device AI models, `unload` and the rest — but `autoplay` and `clipboard-write` for this site, and the client hints, which only say what the browser tells this same site | The app plays sound and copies a link, nothing more. The website suite reads the allowed features back in Chromium and fails on any other, so a feature a newer Chromium adds is denied in all three files before the suite passes. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Another window keeps no handle on this one. |
| `Cross-Origin-Resource-Policy` | `same-origin` | Other sites cannot embed the app's files. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Browsers remember to use HTTPS. Every host sends it with no condition, Apache included: a condition on https (`env=HTTPS`, `%{HTTPS}`) reads what mod_ssl alone sets, so behind a proxy that ended TLS it was never sent. A browser ignores it on a plain `http://` answer, which is only ever the redirect to https. |
| `Cache-Control` | `no-cache` | No file name carries a version, so every load revalidates (an unchanged file costs a 304) and a deploy never mixes old scripts with new HTML. The service worker keeps the offline copy. |

**GitHub Pages sends no headers.** The page carries the same policy in a `<meta>` tag, and the
referrer policy in another, so the scripts, styles, workers and Trusted Types rules hold there
too. A `<meta>` cannot carry `frame-ancestors`, so on Pages another site can frame the app; and
nosniff, the permissions, the cross-origin and HTTPS headers need a host that sends headers
(Netlify, Cloudflare Pages, Apache, nginx). `upgrade-insecure-requests` is left out of the
`<meta>` on purpose, so that `HOST=0.0.0.0 npm start` still serves a phone over plain `http://`
on the local network; Pages forces HTTPS by itself.

**One origin per app.** A Pages project site lives under `platteration.github.io`, an origin it
shares with every other app the account publishes, and storage, caches and service workers
belong to the origin: a script injected into any one of those apps can read and rewrite this
one's saved mixes. The app already treats what it reads back as untrusted and keeps its keys and
caches prefixed, but that limits the damage rather than preventing it. Give it an origin of its
own: a custom domain or subdomain (Settings → Pages → Custom domain), or any host above on a
domain of its own. `robots.txt` and `.well-known/security.txt` are only read at a domain's root,
so they do their job there and nothing under a Pages project path.

**Not-found page.** Every host above answers an address the site does not have with `404.html`,
which carries its own look (an inline style the policy allows by its hash) and loads nothing by a
relative path but the icon, so it renders at any address. Its one link, back to the app, is
`./`: right for any address one level below the site's root, which is what a mistyped page
name is. The Apache setting names it from the document root (`ErrorDocument 404 /404.html`); for
a site in a sub-folder, put the folder in front.

**If the page cannot start.** `js/guard.js` loads first and depends on nothing. With JavaScript
off, with a file that did not load, or with a script that threw before the app started, the
visitor reads a short note saying so where the controls would have been, rather than a page of
controls that do nothing. When the file that did not load is the safety net itself or the
stylesheet, the app still starts, and then shows its controls (unstyled, without the stylesheet)
with no note.

**Security contact.** `.well-known/security.txt` lists two contacts: this repository's private
vulnerability report form and, for when the repository does not offer that form (it is off until
the owner switches it on in the repository's settings), its issues, where a reporter asks for a
private channel without the details. Its policy is `SECURITY.md` as it is on `main`, the branch
the Pages deploy publishes. Its `Expires` date (8 October 2027) is renewed every year; `npm test`
fails once it has passed.

### Sign in and Support this app

The owner asked for the website to be ready for sign-in with Google, a shop and Stripe's
webhooks. The backend for it is optional and runs only where the host runs functions on the
site's own origin; it is **off until its variables are set**, and on GitHub Pages, Netlify or a
plain folder nothing of it runs and the app is exactly as described above.

- **What it does.** With it on, the About dialog gains an Account section: "Sign in with
  Google", then "Signed in as …", Sign out and Delete account. It sells one thing, **Support
  this app**, a one-time payment through Stripe Checkout that changes nothing in the app: a
  supporter reads "Thank you for supporting Ambient Noiser." in About. A purchase is granted by
  Stripe's signed webhook alone. The thank-you is drawn in the visitor's own browser, so anyone
  who edits the page can show it to themselves; it gates nothing.
- **What leaves the device.** Nothing, unless the visitor signs in or buys. Then Google tells
  the site an account id and (if verified) an email address, and Stripe handles the payment and
  is told the account id with it (the kit sends it as the Checkout Session's
  `client_reference_id` and in the payment's metadata, which is how its webhook finds the
  account); the site keeps the account id, the email address while the visitor is signed in,
  what was bought, Stripe's customer id and, for 30 days, the Checkout Session it last gave the
  visitor, so that a second Buy is given that one rather than a second payment. Mixes, the queue
  and preferences are never sent. Delete account removes all of it but the payment, which stays
  with Stripe under the account id it was made with, and the count of checkouts started in the
  last hour, which names the account id and expires by itself within two hours.
- **How it runs.** `server/kit/` is the shared kit (sign-in, sessions, Checkout, the webhook),
  copied unchanged; `server/catalogue.js` is what this site sells. On **Cloudflare Pages**
  (the reference host) `functions/api/[[path]].js` runs it and `_routes.json` in the published
  folder (`node scripts/site.js <folder> --host=cloudflare`) limits it to `/api/*`. Cloudflare
  applies neither `_headers` nor `_redirects` to what a Function answers, so the kit sends its
  own headers (`server/kit/README.md`, "Hosting"). **Self-hosted**, `node server/start.mjs`
  listens on 127.0.0.1:8788 with its records under `KIT_DATA_DIR` (outside the web root), and
  `deploy/nginx.conf`'s `location ^~ /api/` hands it the site's `/api/`. With that process not
  running, nginx answers `/api/` 502 (with the site's not-found page and every header) and logs
  a refused connection for every page view, so where the API is not run, delete that block: the
  folder's `api/config` then answers that nothing is on. For Apache, `ProxyPass` is server
  configuration, so the API goes in the virtual host, with `mod_proxy` and `mod_proxy_http`;
  these lines also send the Strict-Transport-Security header there (a proxied answer never reads
  `.htaccess`) and answer an API that is not running with the site's not-found page rather than
  Apache's own (for a site in a sub-folder, put the folder in front of `/404.html`):

  ```apache
  ProxyPass "/api/" "http://127.0.0.1:8788/api/"
  <Location "/api/">
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
  </Location>
  ErrorDocument 502 /404.html
  ErrorDocument 503 /404.html
  ErrorDocument 504 /404.html
  ```
- **What the owner sets up**: a Google OAuth client (Web application) whose redirect URI is the
  site's address followed by `api/auth/google/callback`; in Stripe, a product with a one-time
  Price whose id goes in `STRIPE_PRICE_SUPPORTER`, and a webhook endpoint at the site's address
  followed by `api/webhooks/stripe`; on Cloudflare a KV namespace bound as `KIT_STORE`; and the
  variables `APP_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_SUPPORTER`. Step by step, the
  webhook's events and what each variable must look like: `server/kit/README.md`, "Owner's
  checklist". Give the site an origin of its own first (see "One origin per app" above): every
  page on the origin can act for a signed-in visitor through `api/`.
- **The page and the service worker.** The page asks `api/config` once; a 404, an error or
  "nothing on" draws nothing and stores nothing. The service worker never answers or caches
  anything under `api/`, the sign-in's navigations included. The policy is unchanged:
  `connect-src 'self'` covers the site's own `api/`, and Google and Stripe are pages the
  visitor is sent to, not resources the page loads.

**Launch checklist**, with `SITE` the https address:

```sh
curl -sI http://SITE/ | head -1                        # a 301 to https
curl -sI https://SITE/ | grep -i -E 'content-security|strict-transport|nosniff|frame-options|referrer|permissions|cross-origin|cache-control'
curl -sI https://SITE/.git/HEAD | head -1               # 404
curl -sI https://SITE/README.md | head -1               # 404
curl -s  https://SITE/js/ | grep -c 'Page not found'    # 1: the not-found page, not a file list
curl -sI https://SITE/.well-known/security.txt | head -1 # 200
```

Then open the site, press play, save and share a mix, and check that the browser console shows
no `Content Security Policy` or `Trusted Type` lines.

## Development

```bash
npm run typecheck         # tsc over server/ and functions/ (the optional API)
npm test                  # node --test: PRNG, theory, composer, styles, app shell, website, CI's runner, dev server, account, API and the kit's self-test
npm run test:conventions  # the repository's shape against CONVENTIONS.md
npm run check             # the three above: the gate before a push
npm run test:musical      # every style's whole loop, checked for wrong notes and wrong timing
npm run test:textures     # each environment texture, checked against the sound it claims to be
npm run test:e2e          # Playwright + Chromium, end to end: the app, then the built website; then nginx and Apache
npm run test:all          # all of the above
```

`test:musical` schedules all eight styles end to end with the synths and drum voices stubbed out — around 58,000 notes and hits — and checks every one is in the key of the movement that asked for it, inside its layer's register, a real MIDI number, and landing on its own step, swung forward and never early. A one-semitone or one-step error anywhere fails it.

`test:textures` renders each of the twelve environment textures on its own and measures where its energy actually sits: rain, creek, birds, crickets, chimes and vinyl must be bright; wind, waves, fire, train and café must be low; thunder is counted rather than measured, being far too rare to catch in a short window. It also checks the tone control genuinely moves the spectrum. It exists because a 50 Hz turntable rumble was quietly carrying 87% of the vinyl layer's energy.

The browser suite renders every style offline and checks levels and onset, that two renders match to within a 16-bit step, that the loop seam and the export's chunk joins are continuous, and that the live transport advances, wraps, seeks and releases its sources. It also covers steering, the movement editor, the focus timer, the queue crossfade, the share card, the visualiser, save/load/share, that the whole working state survives a reload, that the timers keep running with no animation frames at all, that heavy load thins the incidental one-shots without dropping notes, and that a 360px layout has no sideways overflow.

The website suite (`test/site.smoke.mjs`, the second half of `test:e2e`) builds the site with `scripts/site.js`, serves it at `/abientnoiser/` from a server that sends every response the headers `_headers` writes for it, and drives the app in Chromium: play, a style, the mixer, the movement editor, save, copy link, the share image, export and import, a recording, About, the theme, the service worker's install, a share link opened offline, the not-found page and its link home; then, with the API mounted at `/abientnoiser/api/` and a fake Google and Stripe behind it, signing in, buying, Stripe's signed webhook, the thank-you, signing out and in again and deleting the account, through the real service worker, and a host whose `api/config` is a 404. It fails on any policy or Trusted Types violation, any page error, any console error and any request outside the site, the service worker's included; it also checks that another site cannot frame the app, that the repository's own files are not published, that the safety net speaks when JavaScript is off, when a script does not load and when one throws while starting, and that it stays quiet when the file that did not load is its own or the stylesheet and the app starts anyway. `test/website.test.js` holds the headers equal in every file that writes them and on every path of the site, recomputes the style hash, and reads the Apache, nginx and Netlify rules the way each host does to check that every repository file outside the site answers 404. The hosts suite (`test/hosts.smoke.mjs`, the last part of `test:e2e`) runs the real thing: `deploy/nginx.conf` in the nginx installed where it runs and the built site's `.htaccess` in the Apache installed there (over https, and behind a proxy that ended TLS), serving the site with a checkout's files planted beside it, and checks every file of the site answers 200 with every header and everything else the not-found page; with `server/start.mjs` behind nginx's `location ^~ /api/` and an Apache virtual host set up with the lines above, it checks `/api/` is the API's, with the API's own headers and HSTS, and once the API has stopped, that both answer `/api/` with the site's not-found page and every header; and with that nginx location deleted, that nginx serves the folder's `api/config`. It says so and passes where nginx or Apache is not installed, unless `CI` is set; GitHub's Ubuntu 24.04 runner has both.

The suites run in CI on every push (`.github/workflows/ci.yml`), and a separate job runs `node .github/audit/npm-audit.mjs`, the audit gate the platteration repositories share: `npm audit --omit=dev` over the lockfile, failing on every high or critical advisory that `.github/audit/accepted.json` does not accept. This repository keeps no such list, so it accepts none, and today the production tree it audits is empty. Every job of CI and of the Pages deploy runs on `ubuntu-24.04`, not `ubuntu-latest`, which becomes Ubuntu 26.04 from 19 October 2026: the Playwright the lockfile pins (1.56.1) has no Chromium build for 26.04, and its browser install fails there. `test/ci.test.js` asks the locked Playwright whether it has a build for the release each job names, so raising Playwright is what lets the runner move on. Every official action is pinned by commit at a release that runs on Node 24.

## Project layout

| File | Role |
| --- | --- |
| `js/guard.js` | the safety net: a note in place of the controls when the page cannot start |
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
| `js/install.js` | the header's Install button behind `beforeinstallprompt` |
| `js/account.js` | the About dialog's Account section and "Support this app", where the site runs its API |
| `js/visual.js`, `js/card.js`, `js/app.js` | visualiser, share image, UI |
| `sw.js`, `manifest.webmanifest` | offline app shell and the install manifest |
| `404.html`, `robots.txt`, `.well-known/security.txt`, `favicon.svg` | the rest of the website |
| `_headers`, `_redirects`, `.htaccess`, `deploy/nginx.conf` | each host's settings, with the same headers |
| `server/kit/`, `server/catalogue.js`, `server/start.mjs` | the optional API: the shared kit, what this site sells, and its start script for a host of its own |
| `functions/api/[[path]].js`, `_routes.json`, `api/config` | the API as a Cloudflare Pages Function, its routes, and the "nothing on" answer for a host without it |
| `scripts/site.js` | the website's file list, and the folder a deploy publishes |
| `scripts/serve.js`, `scripts/hosts.js` | the dependency-free dev server, and the `Host` names it answers to |
| `test/` | the node:test suites and the Chromium smoke tests |

## License

MIT
