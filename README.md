# Ambient Noiser

Hour-long, seamlessly looping soundscapes for work, study and sleep — generated live in your browser with the Web Audio API. Every piece is built from simple synths (pads, electric piano, piano, bells, plucks, bass, and three drum kits) and procedural environment sounds (rain, thunder, wind, ocean, creek, fireplace, birds, crickets, wind chimes, café, night train, vinyl crackle), and it changes **mood every few minutes**, like movements in a long song. Nothing is downloaded or uploaded; there are no samples, no accounts and no server.

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

`npm start` listens on loopback only, because it serves the whole checkout. To reach
it from a phone on the same network, opt in with `HOST=0.0.0.0 npm start`: the server
then answers to this machine's addresses, its hostname and mDNS names such as
`laptop.local`, and reads its interfaces again on a miss, so a Wi-Fi joined after the
start still works. Reaching it any other way — a port forward, a tunnel, a name your
router hands out — needs that address in `ALLOWED_HOST` (a comma-separated list, ports
ignored). Any other `Host` gets a 403, and one line on the terminal the first time that
name is seen, which is what keeps a page you visit from reaching the checkout by
pointing its own name at 127.0.0.1. Whatever the address, a file is served only when the
path the filesystem resolves it to is inside the checkout and passes through no dot-named
folder, so `.git` stays out however it is spelled: on Windows that includes `\` and short
names such as `GIT~1`, and anywhere a link that points outside.

Opening `index.html` from disk also works, except for the offline service worker.

### Deploy

The app is also a website, and the website is the files the page loads and nothing else: the
page and its not-found page, the stylesheet, the scripts, the service worker, the manifest and
icons, `robots.txt`, `.well-known/security.txt` and the licence. `node scripts/site.js <folder>`
writes them into an empty folder and `node scripts/site.js --list` names them; the list is the
service worker's shell plus those few files, so nothing else in the repository — notes, tests,
the dev server, the hosting configs — is ever published. Everything still happens in the
visitor's browser: the host only serves files, and nothing the app makes is sent anywhere.

A GitHub Pages workflow is included (`.github/workflows/pages.yml`). Enable **Settings → Pages →
Source: GitHub Actions** and every push to `main` publishes exactly that list, taken out of the
commit.

Any static host will serve the folder. The repository carries the settings of the common ones,
with the same headers in each:

| Host | Build the folder with | Settings it reads |
| --- | --- | --- |
| Netlify | `node scripts/site.js <folder> --host=netlify` | `_headers`, `_redirects` |
| Cloudflare Pages | `node scripts/site.js <folder> --host=cloudflare` | `_headers` |
| Apache | `node scripts/site.js <folder> --host=apache` | `.htaccess` |
| nginx | `node scripts/site.js <folder>` | `deploy/nginx.conf`, copied into the server's config by hand |
| GitHub Pages | the workflow | none: see below |

Serve it over HTTPS only: the Apache and nginx settings redirect plain `http://`, and Netlify,
Cloudflare Pages and GitHub Pages each have a switch for it. Never point a web server at a git
checkout, whose `.git/` holds the whole history. If it happens anyway, the Apache and nginx
settings serve the site's own files and answer 404 for everything else, and `_redirects` does
the same for the repository's files on Netlify; Cloudflare Pages has no 404 rule, so there the
folder is the only protection.

**Response headers.** The same set is in `_headers`, `.htaccess` and `deploy/nginx.conf`, and
`test/website.test.js` fails when one of them says something the others do not:

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self' 'sha256-…'; img-src 'self'; worker-src 'self' blob:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; require-trusted-types-for 'script'; trusted-types ambient-noiser-ticker ambient-noiser-sw; frame-ancestors 'none'; upgrade-insecure-requests` | Only the site's own scripts run, and nothing inline or evaluated. Each source was measured in Chromium with the policy sent as a header: the hash is the not-found page's inline style; `blob:` workers are the background timer (`js/timer.js`), without which the sleep timer, focus timer and queue would fall back to a timer the browser throttles in a background tab; `connect-src 'self'` is the service worker fetching the site's own files, the only network code there is. Trusted Types make an HTML string sink a TypeError, so text from a share link or a stored mix can only ever be text; the two named policies vouch for the timer's `blob:` URL and for `sw.js`, nothing else. |
| `X-Content-Type-Options` | `nosniff` | A file is what its type says. |
| `X-Frame-Options` | `DENY` | With `frame-ancestors 'none'`: no other site can frame the app and steer its buttons (clickjacking). |
| `Referrer-Policy` | `no-referrer` | A share link carries a whole mix in its address; no other site is told it. |
| `Permissions-Policy` | every powerful feature off — camera, microphone, location, sensors, USB, payment and the rest — but `autoplay` and `clipboard-write` for this site | The app plays sound and copies a link, nothing more. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Another window keeps no handle on this one. |
| `Cross-Origin-Resource-Policy` | `same-origin` | Other sites cannot embed the app's files. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Browsers remember to use HTTPS. |
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
controls that do nothing.

**Security contact.** `.well-known/security.txt` points to this repository's private
vulnerability report form and to `SECURITY.md`. Its `Expires` date (8 October 2027) is renewed
every year; `npm test` fails once it has passed.

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
npm test                  # node --test: PRNG, theory, composer, styles, app shell, website, dev server
npm run test:conventions  # the repository's shape against CONVENTIONS.md
npm run check             # the two above: the gate before a push
npm run test:musical      # every style's whole loop, checked for wrong notes and wrong timing
npm run test:textures     # each environment texture, checked against the sound it claims to be
npm run test:e2e          # Playwright + Chromium, end to end: the app, then the built website
npm run test:all          # all of the above
```

`test:musical` schedules all eight styles end to end with the synths and drum voices stubbed out — around 58,000 notes and hits — and checks every one is in the key of the movement that asked for it, inside its layer's register, a real MIDI number, and landing on its own step, swung forward and never early. A one-semitone or one-step error anywhere fails it.

`test:textures` renders each of the twelve environment textures on its own and measures where its energy actually sits: rain, creek, birds, crickets, chimes and vinyl must be bright; wind, waves, fire, train and café must be low; thunder is counted rather than measured, being far too rare to catch in a short window. It also checks the tone control genuinely moves the spectrum. It exists because a 50 Hz turntable rumble was quietly carrying 87% of the vinyl layer's energy.

The browser suite renders every style offline and checks levels and onset, that two renders match to within a 16-bit step, that the loop seam and the export's chunk joins are continuous, and that the live transport advances, wraps, seeks and releases its sources. It also covers steering, the movement editor, the focus timer, the queue crossfade, the share card, the visualiser, save/load/share, that the whole working state survives a reload, that the timers keep running with no animation frames at all, that heavy load thins the incidental one-shots without dropping notes, and that a 360px layout has no sideways overflow.

The website suite (`test/site.smoke.mjs`, the second half of `test:e2e`) builds the site with `scripts/site.js`, serves it at `/abientnoiser/` from a server that sends every response the headers `_headers` writes for it, and drives the app in Chromium: play, a style, the mixer, the movement editor, save, copy link, the share image, export and import, a recording, About, the theme, the service worker's install, a share link opened offline, the not-found page and its link home. It fails on any policy or Trusted Types violation, any page error, any console error and any request outside the site, the service worker's included; it also checks that another site cannot frame the app, that the repository's own files are not published, and that the safety net speaks when JavaScript is off, when a script does not load and when one throws while starting. `test/website.test.js` holds the headers equal in every file that writes them, recomputes the style hash, and reads the Apache, nginx and Netlify rules the way each host does to check that every repository file outside the site answers 404.

Both suites run in CI on every push (`.github/workflows/ci.yml`), and a separate job runs `npm audit --omit=dev --audit-level=high` over the lockfile.

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
| `js/visual.js`, `js/card.js`, `js/app.js` | visualiser, share image, UI |
| `sw.js`, `manifest.webmanifest` | offline app shell and the install manifest |
| `404.html`, `robots.txt`, `.well-known/security.txt`, `favicon.svg` | the rest of the website |
| `_headers`, `_redirects`, `.htaccess`, `deploy/nginx.conf` | each host's settings, with the same headers |
| `scripts/site.js` | the website's file list, and the folder a deploy publishes |
| `scripts/serve.js`, `scripts/hosts.js` | the dependency-free dev server, and the `Host` names it answers to |
| `test/` | the node:test suites and the Chromium smoke tests |

## License

MIT
