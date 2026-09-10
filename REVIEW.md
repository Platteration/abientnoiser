# Ambient Noiser — security & upgrade review (2026-09-09)

Two independent reviewers read every first-party file in this repository; a third then re-read each security or bug claim against the code and tried to refute it. Only claims that survived that check are listed as findings; the ones that did not are recorded at the end so they are not re-raised.

## Status — what has been fixed

All of the following are fixed on `claude/repo-review-security-baiyud`, each with a regression test that was checked by reverting the fix.

**First pass** — every critical and high finding, plus the medium ones that were quick:

`REL-1`

**Second pass** — the remaining medium findings and the low-severity ones that were trivial or small:

`BUG-1`, `SEC-1`, `CI-1`, `SEC-3`, `MISS-2`, `SEC-2`, `BUG-2`, `BUG-3`, `BUG-4`, `MISS-1`, `MISS-3`

An independent reviewer then read each commit and tried to find what was wrong with it, and a second reviewer tried to refute every objection raised. What survived that was fixed in a follow-up commit.

Repository hardening applied here as well: every GitHub Action is pinned to a commit rather than a floating tag, each workflow declares a least-privilege `permissions` block, and a Dependabot config, a licence and a security policy are in place.

The rest of this document is the review as written. Fixed items are left in place so the reasoning behind each change stays with it.

## Summary

Ambient Noiser is a zero-dependency vanilla-JS PWA (~4.1k lines of first-party JS across 13 IIFE modules sharing an `AN` namespace) that composes and performs hour-long looping generative soundscapes with the Web Audio API, deployed to GitHub Pages. It is three days old (27 commits, 2026-09-06 to 09-08) but unusually mature for its age: seeded determinism is a designed-in invariant, CLAUDE.md documents the bugs that actually bit, and there are four test tiers (node unit, musical-validity, spectral texture checks, Playwright e2e) all wired into CI. The most consequential gaps are in the offline/PWA path: the service worker is cache-first with a hand-bumped VERSION string that the deploy workflow never touches, so installed users silently stop receiving updates, and its fetch fallback serves index.html for any failed request including scripts. CI hygiene lags the code (no pinned actions, no permissions block in ci.yml, no Dependabot, no lint config, Node 22 without engines/.nvmrc). Product-wise, "Follow the clock" resolves the daypart once at compose time and never re-follows, and the export story (600 MB WAV per hour) is the obvious next feature. Code quality is high; the main refactors are splitting the 936-line app.js, extracting the ~40 lines of Playwright bootstrap duplicated across three smoke files, and unifying the swing-offset formula that currently exists in five places.

## Attack surface

Ambient Noiser is a fully static, dependency-free PWA (index.html + js/ + css/ + sw.js) served from GitHub Pages (pages.yml) or a 60-line Node dev server (scripts/serve.js); there is no backend, no accounts, and no runtime network traffic beyond loading its own files. The only attacker-controlled inputs are the `?mix=` share link (URL-safe base64 JSON, app.js:39-41 → storage.js:96-102), an imported library JSON file (app.js:904-910 → storage.js:72-85), and the origin's own localStorage (three keys: mixes, autosave, prefs). Outputs are browser downloads (WAV/WebM/PNG/JSON via `AN.download`), a clipboard write for share links, and a MediaRecorder that captures only the app's own output bus (no microphone permission is ever requested). The service worker (sw.js) caches every same-origin GET cache-first, so what a visitor runs is whatever build their browser first cached. Users are anonymous individuals; stored data is mix settings and preferences with no PII. When `npm start` is used the dev server listens on all interfaces and serves the whole checkout (including .git/ and package files) to anyone on the LAN. CI runs on GitHub Actions with major-tag (unpinned) actions; the Pages deploy uploads the entire checkout (tests, scripts, CLAUDE.md) as the site.

## Already done well

- All untrusted input funnels through one validator: `AN.storage.cleanSettings`/`cleanEdits` clamp every numeric field and whitelist ids (js/storage.js:18-53), and every string rendered via innerHTML goes through `escapeHtml` (js/app.js:420, 547, 549, 713, 735) — the browser suite actively feeds a `<img onerror>` payload through both the share link and the import path and asserts nothing executes (test/browser.smoke.mjs:737-798).
- Zero runtime dependencies, no CDN scripts, no inline `<script>`, no third-party network calls; the single devDependency (playwright) is pinned by package-lock.json with integrity hashes and CI installs it with `npm ci` (.github/workflows/ci.yml:22).
- pages.yml declares least-privilege `permissions` and a `concurrency` group, and gates deploy on a test job (.github/workflows/pages.yml:7-14, 29).
- The dev server has a real path-traversal guard (`path.relative(root, file).startsWith('..')`, scripts/serve.js:31), turns malformed percent-escapes into a 400 instead of a crash (serve.js:24-29), and both behaviours are covered by test/server.test.js:27-33.
- Audio resource lifecycle is disciplined: every one-shot is registered via `Graph.track` with `onended` cleanup, `killAll`/`dispose` release sources and the tape oscillators (js/audio/graph.js:267-289), and tests assert source counts return to zero and that a discarded engine really stops (test/browser.smoke.mjs:141-145, 586-599).
- Deadline timers (sleep, focus, queue) run on a Worker-backed ticker with a setInterval fallback, so they survive throttled background tabs (js/timer.js:16-33); the suite verifies this with requestAnimationFrame stubbed out (test/browser.smoke.mjs:402-436).
- localStorage keys are versioned (`ambientnoiser.*.v1`) and every read/write is wrapped in try/catch with a fallback, so a blocked or corrupt store degrades gracefully and `save()` reports failure to the user (js/storage.js:4-13, 58-63; js/app.js:882).
- Download filenames are sanitised to `[a-z0-9-]` before use (`fileStem`, js/app.js:772-773), and the seed is capped at 64 characters both in the input (`maxlength`) and in `cleanSettings`.
- A unit test keeps the service-worker precache list in sync with the files index.html actually loads and checks every precached file exists (test/shell.test.js:27-38).
- Accessibility is treated as a tested requirement: the timeline is a real `role=slider`, movement changes use `aria-live`, and every focusable control must have an accessible name (test/browser.smoke.mjs:450-473, 710-735).

## Findings (13)

| # | Severity | Category | Title | Where | Effort | Status |
|---|---|---|---|---|---|---|
| REL-1 | High | reliability | Service worker is cache-first and VERSION was never bumped: deployed users are frozen on the first build they ever loaded | `sw.js:26` | small | confirmed |
| BUG-1 | Medium | bug | Pure Web Audio playback with no media element: on iOS the music, sleep timer and lock-screen controls stop when the screen locks | `js/app.js:217` | medium | confirmed |
| SEC-1 | Low | security | Prototype-chain keys ("constructor", "__proto__", "toString") pass cleanSettings whitelist checks — a share link can wedge or brick the app, and autosave makes it stick | `js/storage.js:37` | small | confirmed, severity lowered |
| SEC-2 | Low | security | Dev server crashes on a NUL byte in the path, listens on all interfaces, and serves .git/ and project metadata | `scripts/serve.js:35` | trivial | confirmed |
| CI-1 | Low | ci-cd | ci.yml has no permissions block, all 10 actions are major-tag pinned, and the Pages deploy ignores the browser/musical suites | `.github/workflows/ci.yml:1` | small | confirmed |
| BUG-2 | Low | bug | Pause then Play within 350 ms skips the deferred killAll, doubling already-scheduled notes and the section drone | `js/audio/engine.js:374` | trivial | confirmed |
| BUG-3 | Low | bug | importJSON reports success even when localStorage refused the write, and re-importing an export duplicates every mix | `js/storage.js:83` | trivial | confirmed |
| BUG-4 | Low | bug | Global keyboard shortcuts fire on modifier combinations (Cmd/Ctrl+N, Cmd/Ctrl+P, Alt+Arrow) | `js/app.js:914` | trivial | confirmed |
| SEC-3 | Low | security | No Content-Security-Policy even though the page has no inline scripts and needs no external origins | `index.html:3` | small | confirmed |
| MISS-1 | Low | security | The movement list interpolates the attacker-influenced `s.mode` into innerHTML without escapeHtml | `js/app.js:548` | trivial | found by second reviewer |
| MISS-2 | Low | bug | Opening a share link silently overwrites the visitor's own autosaved working mix | `js/app.js:40` | small | found by second reviewer |
| MISS-3 | Low | bug | Four more storage writes discard write()'s failure result, so rename, delete, autosave and preferences fail silently | `js/storage.js:66` | trivial | found by second reviewer |
| MISS-4 | Info | ci-cd | The Pages deploy publishes the entire repository, not a site directory | `.github/workflows/pages.yml:38` | trivial | found by second reviewer |

### REL-1 · Service worker is cache-first and VERSION was never bumped: deployed users are frozen on the first build they ever loaded

**Severity:** High · **Category:** reliability · **Effort:** small · **Where:** `sw.js:26`

sw.js answers every same-origin GET from the cache first and only falls back to the network on a miss, and nothing ever revalidates a hit. The only invalidation is deleting old caches when `VERSION` changes. `git log -- sw.js` shows `VERSION` has been `'ambient-noiser-v2'` since the SW was introduced (f5f9128), and 10 later commits changed js/, css/ or index.html without touching it — including "Fix eight bugs found in review", "Fix five more bugs found in a second review" and the lock/vinyl fixes. Any browser that visited the Pages site (or installed the PWA) after the first deploy will keep executing that exact build indefinitely: the SW file is byte-identical so the browser never installs a new worker, and the shell files never hit the network again. There is also no `updatefound`/`controllerchange` handling in app.js, so even after a bump an open page is never told to reload. Secondary: navigations with a query string (`/?mix=...`) miss the cache (search is part of the key) and are then stored by `c.put(req, copy)`, so every share link opened while online adds another permanent copy of index.html to the cache.

Evidence:

```
sw.js:2 `const VERSION = 'ambient-noiser-v2';`
sw.js:26-27 `caches.match(req).then((hit) => hit || fetch(req).then((res) => {
  if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }`
git: VERSION identical in f5f9128, 63c121e, 80076b4; `git log 80076b4..HEAD -- js css index.html | wc -l` = 10
```

**Recommendation.** Make the cache name derive from the build instead of a hand-edited constant: in pages.yml before `upload-pages-artifact` run `sed -i "s/ambient-noiser-v2/ambient-noiser-${GITHUB_SHA::8}/" sw.js` (or write a `build.json` and read it in sw.js), and add a unit test in test/shell.test.js that hashes the SHELL files' contents and fails if the hash embedded in sw.js is stale. Also switch the shell to stale-while-revalidate (return the hit, but `fetch(req)` in `e.waitUntil` and `cache.put` the fresh copy), use `caches.match(req, { ignoreSearch: true })` for `req.mode === 'navigate'` and never `put` navigation responses (the precached `./index.html` is the only copy needed), and in app.js listen for `navigator.serviceWorker.addEventListener('controllerchange', ...)` / `reg.addEventListener('updatefound', ...)` to show a "New version — reload" toast. Bump VERSION immediately as a stopgap so current users get today's fixes.

### BUG-1 · Pure Web Audio playback with no media element: on iOS the music, sleep timer and lock-screen controls stop when the screen locks

**Severity:** Medium · **Category:** bug · **Effort:** medium · **Where:** `js/app.js:217`

Playback is an AudioContext graph only; there is no HTMLMediaElement anywhere. WebKit on iOS restricts Web Audio sessions from playing in the background: when the user locks the phone or switches apps the AudioContext is interrupted and JavaScript (including the Worker ticker in timer.js) is frozen, so the sleep-to-music and focus-timer use cases the README advertises ("Sleep timer", "media keys and lock-screen controls", "Timers keep running while the tab is in the background, which is the whole point") do not work on iPhone/iPad. `navigator.mediaSession` metadata/handlers (app.js:219-249) are only surfaced by iOS for a playing media element, so the lock-screen controls will not appear either. On resume, `resumeIfInterrupted` (app.js:811-817) and `Transport.play()` (engine.js:351) only call `ctx.resume()` when `ctx.state === 'suspended'`, but Safari reports the non-standard `'interrupted'` state after a call/Siri/backgrounding, so those paths do nothing and the app can show 'playing' while silent until a reload. Desktop browsers and Android Chrome are unaffected. The graph already creates a `MediaStreamAudioDestinationNode` (graph.js:29-32) that could drive a media element, so the fix is contained.

Evidence:

```
js/app.js:219-227 `if (!('mediaSession' in navigator)) return; ... navigator.mediaSession.metadata = new MediaMetadata({`
js/app.js:813-815 `if (engine.ctx.state === 'suspended' && engine.ctx.resume) { engine.ctx.resume()...`
js/audio/engine.js:351 `if (ctx.state === 'suspended' && ctx.resume) ctx.resume();`
js/audio/graph.js:30-31 `this.recordDest = ctx.createMediaStreamDestination(); this.node.connect(this.recordDest);`
index.html: no `<audio>`/`<video>` element
```

**Recommendation.** Do the state check unconditionally — change both app.js:813 and engine.js:350 to `if (ctx.state !== 'running' && ctx.resume)` so Safari's 'interrupted' state is resumed. But do NOT route the mix through `<audio srcObject = recordDest.stream>`: MediaStreamAudioDestinationNode playback through a media element is unreliable on iOS Safari (and recordDest is feature-gated at graph.js:29, so it may not exist at all), and it would double or reroute the audio path the visualiser and recorder depend on. The reliable pattern is a separate, tiny looping near-silent audio file kept playing purely to hold the iOS audio session and drive Media Session: add `<audio id="sink" loop playsinline preload="auto" src="silence.m4a">` (a few hundred bytes, added to sw.js SHELL), call `sink.play()` inside the same user gesture as ensureEngine(), and `sink.pause()` with the transport. Leave the Web Audio graph connected to ctx.destination as it is. Verify on a real locked iPhone, and soften README.md:24 to name the platforms that actually work if any gap remains.

### SEC-1 · Prototype-chain keys ("constructor", "__proto__", "toString") pass cleanSettings whitelist checks — a share link can wedge or brick the app, and autosave makes it stick

**Severity:** Low (reported as medium, adjusted after review) · **Category:** security · **Effort:** small · **Where:** `js/storage.js:37`

`cleanSettings` and `cleanEdits` validate `style`, `daypart`, `edits[i].mood` and `edits[i].mode` with a truthiness lookup on plain object literals (`AN.STYLES[s.style]`, `AN.MOODS[e.mood]`, `AN.theory.MODES[e.mode]`, `AN.DAYPARTS[s.daypart]`). Inherited `Object.prototype` members are truthy, so `"constructor"`, `"__proto__"`, `"toString"`, `"hasOwnProperty"` etc. survive as 'valid' ids. Verified with node: `cleanSettings({style:'constructor', daypart:'constructor', edits:{0:{mood:'constructor', mode:'constructor'}}})` returns them all unchanged, and `AN.compose` then either throws (`style`/`daypart`/`mood` = constructor → "Cannot read properties of undefined (reading '0'/'includes'/'filter')") or, for `mode`, succeeds with `chordTones` = `[NaN, NaN, NaN]` and chord names `'undefined'`. Realistic impact for a recipient of a crafted `?mix=` link: (a) `edits[0].mode = "constructor"` — the page loads normally, but pressing Play makes `S.pad` set `o.frequency.value = NaN`, which throws TypeError inside `Transport.step()` before `this.cursor` advances, so every 120 ms tick re-throws on the same step: the UI says playing, the app is silent, and nothing surfaces the error. `beforeunload`/any fader change then autosaves the poisoned edit, so the app stays broken on every reload until the user discovers "Reset all movement edits". (b) `style`/`daypart`/`mood` = "constructor" — `compose()` throws inside `init()` before `bind()`, leaving a dead page for that link; via the library-import path (`importJSON` → Load), `applySettings` replaces `state.settings` before the throw, so the next autosave bricks every subsequent load until localStorage is cleared by hand. No code execution or data exposure is possible (the attacker can only pick from Object.prototype property names, none of which contain HTML metacharacters), so this is denial-of-service against a music app, not an integrity issue.

Evidence:

```
js/storage.js:26-27 `if (AN.MOODS[e.mood]) clean.mood = e.mood;
      if (AN.theory.MODES[e.mode]) clean.mode = e.mode;`
js/storage.js:37 `const style = AN.STYLES[s.style] ? s.style : 'ambient';`
js/storage.js:46 `daypart: AN.DAYPARTS[s.daypart] ? s.daypart : ...`
js/composer.js:229,235,303,312 same truthy lookups; js/audio/engine.js:464-465 `while (this.cursor < limit ...) this.step();` with no try/catch, and `this.cursor += stepLen` only after `onStep` returns (engine.js:514).
node check: `mode=constructor => compose OK ... chords= [ 'undefined', 'undefined' ]`, `chordTones: [ NaN, NaN, NaN ]`, `scaleNotes throws: scale.includes is not a function`
```

**Recommendation.** As written (an `Object.hasOwn` helper used at storage.js:26,27,37,46 and composer.js:228,302,311, plus try/catch around AN.compose and Transport.step). One addition: js/app.js:548 interpolates `${s.mode}` into innerHTML WITHOUT escapeHtml, so the same whitelist is the only thing standing between a share link and stored markup — fix that line at the same time (see MISS-1).

*Reviewer note (confirmed, severity lowered):* The mechanism is exactly as described and I reproduced it. AN.STYLES, AN.MOODS, AN.DAYPARTS and AN.theory.MODES are all plain object literals (composer.js:33, 134, 163; theory.js:7), and cleanSettings/cleanEdits validate with bare truthy lookups, so Object.prototype keys pass. Running the real modules under node: cleanSettings({style:'constructor', daypart:'constructor', edits:{0:{mood:'constructor', mode:'__proto__'}}}) returns every one of those values unchanged, and AN.compose on it throws 'Cannot read properties of undefined (reading \'0\'' (composer.js:276 `rng.int(style.tempo[0], style.tempo[1])`). With only edits[0].mode='constructor', compose SUCCEEDS and produces chordNames ['undefined','undefined'] and chordTones [NaN, NaN, NaN], while theory.scaleNotes throws 'scale.includes is not a function' — so the page loads and only breaks at play time, as claimed. The wedge is real: Transport.step() (engine.js:508-513) calls engine.onStep() and only then does `this.cursor += stepLen`, and scheduleUntil/schedule (engine.js:461-478) have no try/catch, so a throwing step is retried on every 120 ms ticker callback forever. Persistence is real too: `window.addEventListener('beforeunload', autosave)` (app.js:925) writes the poisoned settings to localStorage on unload. I also verified the hostile-input browser test does NOT cover this — its payload is '"><img src=x onerror=...>', not a prototype key (test/browser.smoke.mjs:737-745). Downgrading to low on severity only: there is no code execution, no data exposure and no cross-user effect; the attacker can only choose from Object.prototype property names; the victim must open an attacker's link; the app has no accounts, sessions or privileges; and recovery is a visible in-app 'Reset all movement edits' button or clearing site data. That is a self-recoverable single-visitor DoS on a static music toy, which is a low, not a medium. The fix is still worth doing exactly as recommended.

### SEC-2 · Dev server crashes on a NUL byte in the path, listens on all interfaces, and serves .git/ and project metadata

**Severity:** Low · **Category:** security · **Effort:** trivial · **Where:** `scripts/serve.js:35`

`decodeURIComponent('/%00')` succeeds (only malformed escapes are caught), the resulting path contains `\0`, and in Node 22 `fs.stat` throws `ERR_INVALID_ARG_VALUE` synchronously (verified: `SYNC THROW -> ERR_INVALID_ARG_VALUE - The argument 'path' must be a string ... without null bytes`). The throw happens inside the request handler with no `uncaughtException` handler, so the process exits on a single `GET /%00`. `server.listen(port)` with no host binds every interface, so anyone on the same Wi-Fi can do this — and the browser/musical/texture suites all spawn this server and abort with a bare connection error if it dies mid-run. The same LAN peer can also read `/.git/config`, `/.git/HEAD`, `/package-lock.json`, `/CLAUDE.md` etc., because the traversal guard only blocks paths outside the root. The existing test covers `%zz` and `..` but not `%00`.

Evidence:

```
scripts/serve.js:25 `url = decodeURIComponent(req.url.split('?')[0]);`
scripts/serve.js:30-35 `let file = path.join(root, url === '/' ? 'index.html' : url); ... fs.stat(file, (err, st) => {`
scripts/serve.js:61 `server.listen(port, () => console.log(...))`
test/server.test.js:27 `assert.equal((await get('/%zz')).status, 400, ...)` (no `%00` case)
```

**Recommendation.** After decoding add `if (url.includes('\0') || /(^|\/)\.(git|github)(\/|$)|^\/(node_modules|test|scripts)\//.test(url)) { res.writeHead(400/404); return res.end(); }`; bind to loopback by default: `server.listen(port, process.env.HOST || '127.0.0.1', ...)`; optionally add `process.on('uncaughtException', (e) => console.error(e))` so a future bug degrades a request rather than the whole test run. Add `assert.equal((await get('/%00')).status, 400)` and `assert.equal((await get('/.git/HEAD')).status, 404)` to test/server.test.js.

### CI-1 · ci.yml has no permissions block, all 10 actions are major-tag pinned, and the Pages deploy ignores the browser/musical suites

**Severity:** Low · **Category:** ci-cd · **Effort:** small · **Where:** `.github/workflows/ci.yml:1`

ci.yml declares no `permissions:`, so its GITHUB_TOKEN gets the repository default (write, unless the repo setting was changed) on every push and pull_request run, while nothing in the job needs more than `contents: read`. All actions in both workflows are referenced by floating major tags (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`), and there is no Dependabot/Renovate config, so a compromised tag would run with that token and, in pages.yml, with `id-token: write`/`pages: write`. Separately, pages.yml's `deploy` job only `needs: test`, whose test job runs `npm test` (unit only); the musical, texture and end-to-end suites run in the independent Tests workflow, so a push to main that fails them still publishes to the live site — which contradicts the README's implication that CI protects every push.

Evidence:

```
.github/workflows/ci.yml:1-9 `name: Tests\non:\n  push:\n    branches: ['**']\n  pull_request:` — no `permissions:` key anywhere in the file
.github/workflows/pages.yml:21-22 `- uses: actions/checkout@v4\n      - uses: actions/setup-node@v4`
.github/workflows/pages.yml:26-28 `deploy:\n    needs: test` where `test` runs only `npm test` (line 24)
```

**Recommendation.** As written. Minor correction to the surrounding narrative: actions/upload-pages-artifact excludes .git and .github from the tarball, so the deploy does not publish git history — but it does publish everything else in the checkout (see MISS-4), which is worth fixing in the same change.

### BUG-2 · Pause then Play within 350 ms skips the deferred killAll, doubling already-scheduled notes and the section drone

**Severity:** Low · **Category:** bug · **Effort:** trivial · **Where:** `js/audio/engine.js:374`

`pause()` defers `killAll`/`stopTextures` by 350 ms and stamps `gen`; `play()` increments `gen` again, so if the user un-pauses inside that window (double-tap on Space, a bouncing media key, a fast click) the timeout sees a mismatched `gen` and never kills anything. The 2.5 s of steps that were already scheduled before the pause keep sounding, the master gain ramps back up, and `_enter(this.position, t, true)` re-schedules the same steps from the pause position — every note in the lookahead plays twice, and `enterSection` starts a second drone that overlaps the first for the remainder of the movement (`dur: remaining - 4`), i.e. a +6 dB, phasing low end in the ambient/space styles for minutes.

Evidence:

```
js/audio/engine.js:373-380 `const gen = ++this.gen;\n      setTimeout(() => {\n        if (this.gen !== gen) return;\n        ... this.engine.graph.killAll(now);`
js/audio/engine.js:353-355 `this.playing = true;\n      this.gen++;\n      this._enter(this.position, t, true);`
js/audio/engine.js:106-110 `S.drone(g, g.layers.drone, { ... dur: remaining - 4,`
```

**Recommendation.** In `play()`, flush any pending pause before re-entering: keep the timer id (`this.pendingKill = setTimeout(...)`) and at the top of `play()` do `if (this.pendingKill) { clearTimeout(this.pendingKill); this.pendingKill = null; this.engine.graph.killAll(ctx.currentTime); this.engine.stopTextures(ctx.currentTime); }` (the master gain is at ~0 by then, so the cut is inaudible), or simply call `killAll` unconditionally in `play()` when `graph.sources.size > 0`. Add a browser check that toggles play twice 100 ms apart and asserts `sources.size` afterwards is no larger than a single fresh start.

### BUG-3 · importJSON reports success even when localStorage refused the write, and re-importing an export duplicates every mix

**Severity:** Low · **Category:** bug · **Effort:** trivial · **Where:** `js/storage.js:83`

`save()` checks `write()`'s return value and the UI toasts 'Could not save — this browser is blocking local storage' (app.js:882), but `importJSON` discards it: on quota exhaustion (a few hundred mixes, or Safari private mode) or blocked storage, `write(KEY, mixes)` silently returns false and the function still returns `added`, so the user sees 'Imported 40 mixes' while the library is unchanged. Every imported mix also gets a fresh `uid()`, so the natural 'export as backup, import to restore' flow appends duplicates of everything already present instead of restoring.

Evidence:

```
js/storage.js:83-84 `write(KEY, mixes);\n      return added;`
js/storage.js:80 `mixes.push({ id: uid(), name: ..., createdAt: ..., settings: cleanSettings(m.settings) });`
js/app.js:907 `try { const n = AN.storage.importJSON(await f.text()); renderLibrary(); toast(`Imported ${n} mix...`)`
```

**Recommendation.** `if (!write(KEY, mixes)) throw new Error('This browser refused to store the library (out of space or storage blocked)');` so the existing catch shows the failure. Skip incoming mixes whose `(name, JSON.stringify(settings))` already exists, or keep `m.id` when it is a string not already in the library, and report `{ added, skipped }` in the toast.

### BUG-4 · Global keyboard shortcuts fire on modifier combinations (Cmd/Ctrl+N, Cmd/Ctrl+P, Alt+Arrow)

**Severity:** Low · **Category:** bug · **Effort:** trivial · **Where:** `js/app.js:914`

The document-level keydown handler matches on `e.key` alone. Cmd+N / Ctrl+N (new window) and Cmd+P / Ctrl+P (print) therefore also skip to the next/previous movement (an audible seek that kills the lookahead and restarts the movement), Alt+Left/Right (history navigation on some platforms) nudges the transport 30 s, and Ctrl+Q toggles quiet mode. Users hit these constantly while working with the app open in a background window that still has focus.

Evidence:

```
js/app.js:914-924 `document.addEventListener('keydown', (e) => {\n      const tag = (e.target.tagName || '').toLowerCase();\n      if (tag === 'input' || ...) return;\n      if (e.key === ' ' ...) ... else if (e.key === 'ArrowRight') nudge(30); ... else if (e.key === 'n' || e.key === 'N') jumpMovement(1);`
```

**Recommendation.** `if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;` as the first line of the handler. Note the timeline's own keydown handler (app.js:864-874) has the same gap for Home/End/PageUp/PageDown/Arrow keys and should get the same guard.

### SEC-3 · No Content-Security-Policy even though the page has no inline scripts and needs no external origins

**Severity:** Low · **Category:** security · **Effort:** small · **Where:** `index.html:3`

The app is an ideal CSP candidate: all scripts are same-origin files, the only external-looking resources are a `data:` favicon, a `blob:` Worker (timer.js) and `blob:` download URLs, and every untrusted string is escaped — but there is no policy at all. GitHub Pages cannot send headers, yet a `<meta http-equiv>` CSP works for everything except `frame-ancestors`. Today the only sinks are the `innerHTML` templates in app.js, which escape correctly; a CSP turns a future slip in one of those templates (or in a share-link field added later) from script execution into a console error. Without it, the app is also embeddable and script-injectable from any origin that can get a bug in.

Evidence:

```
index.html:3-13 `<head>` contains only charset, viewport, title, description, theme-color, icon, manifest, stylesheet — no `Content-Security-Policy` meta.
js/timer.js:19-20 `const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })); worker = new Worker(url);`
js/app.js:546 `<span class="swatch" style="background:hsl(${s.hue} ...)"></span>` (inline style attribute inside innerHTML)
```

**Recommendation.** The proposed policy is right, with one correction: `worker-src blob:` alone will not do — Chrome falls back through `child-src` to `script-src` for workers only when worker-src is absent, but a blob: worker also needs the blob URL to be creatable, so keep `worker-src blob:` AND add `blob:` nowhere else. Also note that `img-src 'self' data:` is required for the data: favicon and `media-src blob:` is not actually needed (nothing plays a blob: URL today; downloads use an <a download> which CSP does not gate) — but leaving both in is harmless. Add the meta, then run `npm run test:browser`, which fails on any page error and will catch a directive that is too strict.

### MISS-1 · The movement list interpolates the attacker-influenced `s.mode` into innerHTML without escapeHtml

**Severity:** Low · **Category:** security · **Effort:** trivial · **Where:** `js/app.js:548`

renderPlan builds each movement row with a template literal assigned to `li.innerHTML`, and every user-influenced field in it goes through escapeHtml — except `${s.mode}`. `s.mode` originates in the settings object, which for a `?mix=` share link or an imported library file is entirely attacker-supplied: composer.js:311 copies `edit.mode` straight onto the section whenever `AN.theory.MODES[edit.mode]` is truthy. Today that whitelist is the only thing preventing stored markup, and it happens to be safe because the values that slip through it are Object.prototype property names ('constructor', '__proto__', 'toString'), none of which contain HTML metacharacters. That makes this a single-mistake-away vulnerability rather than a live one: fix SEC-1's whitelist with `Object.hasOwn` and it is unreachable; widen the mode set later (a custom-mode feature, a user-named mode) or relax the check and `?mix=` becomes stored XSS on the origin, with the payload persisted by the beforeunload autosave. `s.mode` is also rendered unescaped into `$('nowMeta').textContent` — that one is safe because it is textContent, which is the pattern the rest of this template should follow.

Evidence:

```
js/app.js:544-548 `li.innerHTML = `<button type="button" class="jump" ...>${AN.formatTime(s.start)}</button>\n        <span class="swatch" style="background:hsl(${s.hue} ...)"></span>\n        <span class="sname">${escapeHtml(s.name)}...</span>\n        <button type="button" class="edit" ...>✎</button>\n        <span class="sinfo">${s.keyName} ${s.mode} · ${escapeHtml(s.chordNames.join(' – '))} · ${s.tempo} bpm · ${AN.formatTime(s.length)}</span>`;`  — note escapeHtml on s.name and s.chordNames but not on s.mode
js/composer.js:311 `if (edit && AN.theory.MODES[edit.mode]) mode = edit.mode;`
js/storage.js:27 `if (AN.theory.MODES[e.mode]) clean.mode = e.mode;`
```

**Recommendation.** Wrap it: `${escapeHtml(s.mode)}`. While there, audit the other three innerHTML templates for the same omission (app.js:419, 546, 712 are already correct) and consider building this row with createElement/textContent the way renderQueue's buttons are, so the escaping is structural rather than remembered.

### MISS-2 · Opening a share link silently overwrites the visitor's own autosaved working mix

**Severity:** Low · **Category:** bug · **Effort:** small · **Where:** `js/app.js:40`

init() resolves settings as `(fromUrl && decodeShare(fromUrl)) || loadAutosave() || defaultSettings('ambient')`, so a `?mix=` link replaces state.settings outright — and `window.addEventListener('beforeunload', autosave)` then writes those foreign settings over the `ambientnoiser.autosave.v1` key when the tab closes (any fader move, preset click or recompose does it sooner). The visitor's unsaved work-in-progress mix — seed, style, mixer balance, per-movement edits — is gone with no prompt and no undo, and there is nothing in the UI that says a link is about to take over. Named mixes in the library survive, so this is bounded, but 'click a friend's link, lose the mix you were building' is a real data-loss path and it is one line of intent away from being fixed. It also compounds SEC-1: it is the mechanism by which a hostile link's poisoned edits become permanent.

Evidence:

```
js/app.js:39-41 `const fromUrl = new URLSearchParams(location.search).get('mix');\n    state.settings = (fromUrl && AN.storage.decodeShare(fromUrl)) || AN.storage.loadAutosave() || AN.defaultSettings('ambient');\n    if (fromUrl) history.replaceState(null, '', location.pathname);`
js/app.js:335 `function autosave() { AN.storage.autosave(state.settings); }`
js/app.js:925 `window.addEventListener('beforeunload', autosave);`
js/storage.js:86 `autosave(settings) { write(AUTO, cleanSettings(settings)); },`
```

**Recommendation.** When `fromUrl` is set, remember the previous autosave before overwriting: read it once at init and, if it differs, either write the incoming link to a separate key and offer a 'Keep my mix / Use the shared mix' toast, or (simplest) suppress the beforeunload autosave for a link-loaded session until the user edits something, and toast 'Playing a shared mix — save it to keep it'.

### MISS-3 · Four more storage writes discard write()'s failure result, so rename, delete, autosave and preferences fail silently

**Severity:** Low · **Category:** bug · **Effort:** trivial · **Where:** `js/storage.js:66`

BUG-3 covers importJSON, but the same defect is at four further call sites: `rename` (line 66), `remove` (line 68), `autosave` (line 86) and `setPref` (line 88) all call `write(...)` and throw the boolean away. write() returns false for a blocked store (Safari private browsing, a browser configured to reject site data) or a full one (storage.js:11-13). Only `save()` propagates the failure, and only app.js:882 surfaces it. The visible consequences: a rename or a delete appears to work until the next renderLibrary reads the unchanged list back; every preference (theme, quiet mode, visualiser, queue, crossfade) silently reverts on reload; and the autosave the whole 'pick up where you left off' behaviour depends on quietly does nothing forever. Because the app already has the right pattern and the right toast, this is a consistency gap rather than a design problem.

Evidence:

```
js/storage.js:64-68 `rename(id, name) {\n      const mixes = this.list().map((m) => (m.id === id ? Object.assign({}, m, { name: String(name).slice(0, 60) }) : m));\n      write(KEY, mixes);\n    },\n    remove(id) { write(KEY, this.list().filter((m) => m.id !== id)); },`
js/storage.js:86-88 `autosave(settings) { write(AUTO, cleanSettings(settings)); },\n    prefs() { ... },\n    setPref(key, value) { const p = this.prefs(); p[key] = value; write(PREFS, p); },`
js/storage.js:11-13 `function write(key, value) { try { root.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }`
js/app.js:880-882 `const saved = AN.storage.save(name, state.settings); renderLibrary(); if (!saved) return toast('Could not save — this browser is blocking local storage');` (the pattern that exists but is used once)
```

**Recommendation.** Return the boolean from rename/remove/autosave/setPref and have the callers toast the existing 'Could not save — this browser is blocking local storage' message. Simplest: detect blocked storage once at init (a probe write to a throwaway key) and show a single persistent notice, so every later failure is already explained rather than reported five different ways.

### MISS-4 · The Pages deploy publishes the entire repository, not a site directory

**Severity:** Info · **Category:** ci-cd · **Effort:** trivial · **Where:** `.github/workflows/pages.yml:38`

`actions/upload-pages-artifact` is given `path: .`, so everything in the checkout except .git and .github becomes a public URL on the Pages origin: scripts/serve.js (the dev server's source), the whole test/ directory including browser.smoke.mjs, package.json, package-lock.json, README.md, and CLAUDE.md with its internal notes on which invariants have caused bugs. Nothing there is secret and none of it is loaded by the page, so the immediate impact is nil — but the default is wrong in two ways that will matter later: every file added to the repo from now on is published unless someone remembers, and sw.js's cache-first fetch handler applies to any same-origin GET (sw.js:24-27), so anything a visitor happens to request from those paths is cached permanently under the same never-bumped VERSION as REL-1 describes.

Evidence:

```
.github/workflows/pages.yml:35-38 `- uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .`
sw.js:24-27 `if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }`
`git ls-files` — test/, scripts/, CLAUDE.md, package-lock.json all live at the repo root that is uploaded
```

**Recommendation.** Add a step before the upload that assembles the site — `mkdir -p _site && cp -r index.html manifest.webmanifest sw.js icon.svg css js _site/` — and set `path: _site`. That also pairs naturally with REL-1's fix: rewrite the sw.js VERSION into the copy in _site with `sed -i "s/ambient-noiser-v2/ambient-noiser-${GITHUB_SHA::8}/" _site/sw.js`, so the deployed cache name follows the build without ever touching the working tree.

## Upgrades

| Value | Effort | Upgrade | Now | Move to |
|---|---|---|---|---|
| high | small | Tie the service-worker cache version to each deploy | /home/user/abientnoiser/sw.js hard-codes `VERSION = 'ambient-noiser-v2'` and serves every same-origin GET cache-first (`caches.match(req).then(hit => hit \|\| fetch(...))`), including index.html. pages.yml never modifies it; 27 commits have produced two bumps. | In pages.yml, stamp the version before upload (`sed -i "s/ambient-noiser-v2/ambient-noiser-${GITHUB_SHA::8}/" sw.js`), or switch navigations/index.html to network-first with cache fallback and keep cache-first only for hashed assets. Pair with the update-toast feature so the new worker is actually adopted. |
| high | trivial | Fix the service-worker fetch fallback and un-awaited cache write | sw.js `fetch` handler: `.catch(() => caches.match('./index.html'))` fires for every failed GET, so a failed `js/engine.js` request returns HTML as a script. `caches.open(VERSION).then(c => c.put(req, copy))` is not inside `e.waitUntil`, so the worker can be terminated before the write lands. | Only fall back to index.html when `req.mode === 'navigate'`; otherwise return the error. Wrap the put in `e.waitUntil(...)`. |
| high | small | Pin GitHub Actions to SHAs, add permissions/concurrency/timeouts to ci.yml, cache Playwright browsers | ci.yml and pages.yml use floating tags (actions/checkout@v4, setup-node@v4, configure-pages@v5, upload-pages-artifact@v3, deploy-pages@v4 - 0 of 10 pinned). ci.yml has no `permissions:` block, no `concurrency`, no `timeout-minutes`, and runs `npx playwright install --with-deps chromium` uncached on every push. It also triggers on both `push: branches: ['**']` and `pull_request`, so same-repo PRs run twice. | Pin each action to a full commit SHA with a `# vX.Y.Z` comment (Dependabot keeps them fresh); move to the v5 majors of checkout/setup-node. Add `permissions: contents: read` at workflow level in ci.yml, `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`, `timeout-minutes: 15` on the browser job, and `actions/cache` on `~/.cache/ms-playwright` keyed on package-lock.json. Drop the `push` trigger to `main` only or drop `pull_request`. |
| medium | trivial | Add Dependabot for npm and github-actions | No .github/dependabot.yml. The only dependency is playwright ^1.56.1 (lockfile pins 1.56.1); actions are on floating tags. | `.github/dependabot.yml` with two `package-ecosystem` entries (npm, github-actions), weekly, grouped. Once actions are SHA-pinned, Dependabot rewrites the SHA and the version comment together. |
| medium | trivial | Declare a Node version (engines + .nvmrc) and move CI to Node 24 LTS | ci.yml and pages.yml use `node-version: 22`; package.json has no `engines`, there is no .nvmrc. The sibling phonogeometry repo does declare `engines`. Node 24 has been Active LTS since October 2025; 22 is in maintenance. | Add `"engines": { "node": ">=22" }` and an `.nvmrc` containing `24`, and set `node-version-file: .nvmrc` in both workflows (or a 22/24 matrix on the unit job). The tests already use `fetch`, `node --test` and top-level await, so 22 is the real floor. |
| medium | small | Add ESLint (flat config) and a lint step in CI | No eslint.config.*, no Prettier, no lint script. The commit 'Remove dead code and clear lint warnings' (c5055b5) shows linting was done ad hoc with whatever was on the developer machine. Sibling repos collectcollect and notenote already have eslint.config.mjs to copy from. | `eslint.config.mjs` with `@eslint/js` recommended, browser + node globals, `AN`/`AmbientNoiser` declared as globals, `no-unused-vars` on; `npm run lint` and a `lint` job in ci.yml. Optionally `// @ts-check` plus a `jsconfig.json` with `checkJs` and a small `types/an.d.ts` so `tsc --noEmit` type-checks the `AN` namespace without adopting TypeScript. |
| medium | medium | Run the browser suites with @playwright/test instead of the bespoke check() harness | test/browser.smoke.mjs (809 lines), musical.smoke.mjs and texture.smoke.mjs each spawn the server, poll for readiness, launch Chromium and run a flat sequence of `check(ok, msg)` calls against one shared page. One thrown exception aborts every later check; there are no retries, traces, HTML report, or per-test isolation. | Keep the assertions, move them into `test.describe`/`test` blocks under `@playwright/test` with a `webServer` entry in playwright.config.js (it already knows how to spawn scripts/serve.js and wait for a URL), `retries: 1` in CI, `trace: 'on-first-retry'`. The three files become spec files sharing fixtures. |
| medium | small | Make the manifest installable on iOS/Android with PNG icons and richer metadata | manifest.webmanifest lists only icon.svg (sizes 'any') for both `any` and `maskable`; index.html points `apple-touch-icon` at icon.svg (iOS ignores SVG there and shows a page screenshot); `<link rel="icon">` is a second, inline data-URI SVG duplicating the artwork; `theme-color` is dark-only although a light theme exists. No `id`, `screenshots`, `lang`. | Generate icon-192.png, icon-512.png, icon-512-maskable.png and apple-touch-icon-180.png from icon.svg (the sibling phonogeometry has a `tools/make-icons.js` and `icons/` layout to copy), add `id: "/"`, `lang: "en"`, a screenshot or two, and a second `<meta name="theme-color" media="(prefers-color-scheme: light)" content="#eef1f7">`. Point `rel=icon` at icon.svg and drop the data URI. |
| medium | small | Add a Content-Security-Policy meta tag | No CSP. GitHub Pages cannot set headers, but nothing in index.html restricts sources. The app uses a blob: Worker (js/timer.js AN.ticker), blob: downloads, a data: favicon, and one inline `style=` attribute built into innerHTML in app.js renderPlan (line 545). | `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src blob:; img-src 'self' data: blob:; media-src blob:; connect-src 'self'; object-src 'none'; base-uri 'none'">`. Replace the inline swatch style with `el.style.background = ...` so `style-src` can later drop `'unsafe-inline'`. Note AN.ticker's setInterval fallback already anticipates a strict CSP. |
| medium | small | Accessibility: name icon-only buttons with aria-label and expose toggle state | Icon-only buttons rely on `title` for their accessible name: `#dice` (🎲), queue `.up`/`.out`, library `.enqueue` (＋)/`.del` (✕), movement `.edit` (✎) in js/app.js lines 421-422, 544-547, 715-717 and index.html. `title` is not reliably announced by mobile screen readers and is invisible on touch. Toggle buttons (#lock, #quiet, #record, the `.style` cards) change text but expose no `aria-pressed`. The a11y check in browser.smoke.mjs accepts `title` as a name, so it cannot catch this. | Add `aria-label` to every icon-only button (keep `title` as tooltip), `aria-pressed` on #lock/#quiet/#record and the style cards (or make the style grid a `role="radiogroup"`), and tighten the test's `nameOf` so `title` alone fails. |
| medium | small | Gate the Pages deploy on the full suite and publish a filtered artifact | pages.yml runs only `npm test` (node unit tests) before deploying and uploads `path: .` - test/, scripts/, package-lock.json, CLAUDE.md and .github/ all go to the public site. The musical, texture and browser suites run in ci.yml but do not block deployment. | Either add the browser job to pages.yml (it needs `npm ci` + `playwright install`), or trigger pages.yml with `workflow_run` on the Tests workflow succeeding. Copy index.html, css/, js/, icon.svg, manifest.webmanifest, sw.js into `dist/` (a five-line `cp` step) and upload that. |
| medium | large | Consider ES modules instead of 13 ordered classic scripts | index.html loads 13 `<script src>` tags in dependency order; each file is an IIFE writing into `root.AN`. Node tests `require()` the files and read `globalThis.AN`. No `'use strict'` anywhere. sw.js SHELL must mirror the script list by hand (guarded by test/shell.test.js). | `<script type="module" src="js/app.js">` with real `import`/`export`; no bundler needed (static import graph works on Pages and offline once the SW caches the module files). Tests `import` modules directly. This is optional - the IIFE design is coherent and documented - but it buys strict mode, tree-shaking-free dead-code detection by ESLint, and removes the ordering contract. |
| medium | large | Pre-render ambience one-shots into cached AudioBuffers to speed up export | Every drip/crackle/click is a live BufferSource -> BiquadFilter -> Gain -> StereoPanner chain (js/audio/ambience.js `Texture.burst`); CLAUDE.md measures export at 2x real time with all textures on and attributes it to node lifecycle. graph.js already has `cachedBuffer()` per sample rate. | For each texture, bake N variants of its burst (filtered noise + envelope) into AudioBuffers once per sampleRate via a tiny OfflineAudioContext at Graph construction, then `burst()` becomes BufferSource -> Gain -> Panner (no biquad). Keep the current path behind a flag and let test/texture.smoke.mjs confirm the spectral claims still hold. |
| low | trivial | Replace deprecated escape()/unescape() in share-code base64 | js/storage.js lines 93 and 99: `btoa(unescape(encodeURIComponent(json)))` and `decodeURIComponent(escape(atob(b64)))` - Annex B functions, deprecated, and the only place in the codebase using them. | `btoa(String.fromCharCode(...new TextEncoder().encode(json)))` (chunked for long strings) and `new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))`. Keep the URL-safe substitutions. Add a Node unit test with a unicode seed (é, emoji) to prove the round-trip before and after. |
| low | trivial | Add CHANGELOG, git tags and a single version source; add SECURITY.md | package.json says 1.0.0, sw.js says v2, there are no git tags and no CHANGELOG. Sibling chesscheatser and selfreportle keep a CHANGELOG.md; simplacad has a SECURITY.md. | Keep a Keep-a-Changelog CHANGELOG.md, tag releases (`v1.1.0`), and derive the SW cache name from the deploy SHA (see the SW upgrade) so the hand-maintained `v2` disappears. A five-line SECURITY.md pointing at GitHub private vulnerability reporting. |

- **Tie the service-worker cache version to each deploy** (high value, small, `/home/user/abientnoiser/sw.js`). Anyone who installed the PWA or simply revisited keeps the old shell forever unless the string is bumped by hand; a shipped bug fix is invisible to them. This is the single highest-leverage change for a Pages-deployed PWA.
- **Fix the service-worker fetch fallback and un-awaited cache write** (high value, trivial, `/home/user/abientnoiser/sw.js`). Offline correctness: a partial cache plus a flaky connection currently yields a page whose scripts are HTML, producing a blank app with SyntaxErrors instead of the offline shell. test/shell.test.js checks the SHELL list but not this behaviour.
- **Pin GitHub Actions to SHAs, add permissions/concurrency/timeouts to ci.yml, cache Playwright browsers** (high value, small, `/home/user/abientnoiser/.github/workflows/ci.yml`). Unpinned actions are the standard supply-chain hole; the browser job installs Chromium from scratch every run (~1 min) and a hung Playwright process has no ceiling.
- **Add Dependabot for npm and github-actions** (medium value, trivial, `/home/user/abientnoiser/.github/dependabot.yml`). Playwright releases monthly and its pinned Chromium goes stale; the CLAUDE.md note that the lockfile pins 'the version these suites were written against' is a reason to bump deliberately via PR, not to never bump.
- **Declare a Node version (engines + .nvmrc) and move CI to Node 24 LTS** (medium value, trivial, `/home/user/abientnoiser/package.json`). One source of truth for the runtime; contributors and the two workflows stop drifting.
- **Add ESLint (flat config) and a lint step in CI** (medium value, small, `/home/user/abientnoiser/package.json`). The codebase relies on cross-file globals (`AN.theory`, `AN.STYLES`) with no compiler; a typo in a namespace member is a runtime error only the browser suite can catch.
- **Run the browser suites with @playwright/test instead of the bespoke check() harness** (medium value, medium, `/home/user/abientnoiser/test/browser.smoke.mjs`). Playwright is already the only devDependency; the runner adds isolation, reporting and CI annotations for free and deletes ~120 lines of duplicated bootstrap.
- **Make the manifest installable on iOS/Android with PNG icons and richer metadata** (medium value, small, `/home/user/abientnoiser/manifest.webmanifest`). Home-screen install on iOS currently gets no icon; Chrome's richer install UI needs screenshots; the light theme flashes a dark status bar.
- **Add a Content-Security-Policy meta tag** (medium value, small, `/home/user/abientnoiser/index.html`). The share-link and library-import paths are attacker-controlled by design (CLAUDE.md, browser test 'hostile share link'); a CSP turns any future escapeHtml miss from script execution into a console error.
- **Accessibility: name icon-only buttons with aria-label and expose toggle state** (medium value, small, `/home/user/abientnoiser/js/app.js`). The README claims 'accessible and considerate'; this closes the gap between that claim and what a VoiceOver user actually hears.
- **Gate the Pages deploy on the full suite and publish a filtered artifact** (medium value, small, `/home/user/abientnoiser/.github/workflows/pages.yml`). A regression in the audio graph can currently ship to production with green unit tests; the deployed site also exposes internal files it has no reason to.
- **Consider ES modules instead of 13 ordered classic scripts** (medium value, large, `/home/user/abientnoiser/index.html`). Modernisation with real but modest payoff; do it only if the app.js split (see code quality) is happening anyway, since both touch the same boundaries.
- **Pre-render ambience one-shots into cached AudioBuffers to speed up export** (medium value, large, `/home/user/abientnoiser/js/audio/ambience.js`). Roughly halves node count per one-shot; the texture spectrum suite exists precisely so this change can be made safely. CLAUDE.md lists it as 'deliberately not done' for sound reasons, so treat as opt-in.
- **Replace deprecated escape()/unescape() in share-code base64** (low value, trivial, `/home/user/abientnoiser/js/storage.js`). Deprecated API in the one path that parses attacker-controlled input; the replacement is also what the eventual `Uint8Array.fromBase64` migration expects.
- **Add CHANGELOG, git tags and a single version source; add SECURITY.md** (low value, trivial, `/home/user/abientnoiser/CHANGELOG.md`). Share links and library exports are versioned (`version: 1` in exportAll) - when cleanSettings changes shape you will want to know which release changed it.

## Features worth adding

- **Make 'Follow the clock' actually follow the clock** (high value, small). `daypart: 'auto'` is resolved exactly once in AN.compose (js/composer.js line 233: `settings.daypart === 'auto' ? AN.daypartAt(new Date()) : ...`), so a piece started at 10:55 stays 'morning' through the afternoon and every loop after. Hook: in app.js `newEngine()` the transport already gets an `onLoop` callback; when `state.settings.daypart === 'auto'` and `AN.daypartAt() !== state.plan.daypart`, call `recompose()` at the seam (position 0, so no audible jump) and toast 'Now coloured for afternoon'. Also re-check in `tickLogic` for locked movements, which never reach the seam.
- **'New version available' toast with one-tap reload** (high value, small). Hook: `registerServiceWorker()` in js/app.js. Keep the registration, listen for `reg.addEventListener('updatefound')` -> `installing.onstatechange === 'installed' && navigator.serviceWorker.controller`, then show the existing `toast()` with a Reload action; on `controllerchange` do `location.reload()` once. Requires the SW VERSION to change per deploy (see upgrades). Because sw.js already calls `skipWaiting()` + `clients.claim()`, without a toast the swap happens silently mid-session.
- **Compressed export (Opus) via WebCodecs AudioEncoder** (high value, large). A full hour of 16-bit WAV is ~605 MB (`buildWavLengths` shows `~${v*10.1} MB`); Record already produces webm/opus but only in real time. `AN.renderWav` yields one AudioBuffer per chunk; add an alternative sink that feeds each chunk's frames into `new AudioEncoder({ codec: 'opus', sampleRate, numberOfChannels: 2, bitrate: 96000 })` as `AudioData` and writes the encoded packets through a minimal Ogg page writer (~150 lines, no dependency) or a WebM `SimpleBlock` writer. Feature-detect `'AudioEncoder' in window` and keep WAV as the fallback. This is the largest item here but it is the thing that makes 'save the whole hour' practical on a phone.
- **Export a single movement or range as WAV** (medium value, small). `AN.renderWav` in js/audio/recorder.js already renders arbitrary piece positions (`engine.transport.renderRange(total, from - lead)`), but the loop `from = i * chunkLen` is hard-wired to start at 0 and the UI only offers 'Length'. Add `opts.from` (piece seconds) to renderWav, and an 'Export this movement' button in `buildEditor()` in app.js that calls `AN.renderWav(settings, section.length, { from: section.start })`. The lead-in logic already handles mid-movement starts.
- **Re-roll one movement without changing the seed ('Try another')** (medium value, small). The movement editor overrides mood/key/mode/length but cannot ask for a different variation of the same movement. Add an integer `variant` to per-movement edits: js/storage.js `cleanEdits` accepts `Number.isInteger(e.variant) && e.variant >= 0`; js/composer.js line 304 becomes `AN.rng(seed, styleId, 'section', i, edit && edit.variant || 0)`; app.js `buildEditor` gets a '↻ Try another' button that does `setEdit(index, 'variant', (e.variant || 0) + 1)`. Survives share links automatically because edits are already encoded.
- **User-saved environment presets** (medium value, small). `PRESETS` in js/app.js is a hard-coded array of nine. Add a 'Save environment' button beside the presets that stores `{ name, levels }` (ambience layers only) into `AN.storage.prefs().presets`; `buildPresets()` renders `PRESETS.concat(prefs().presets || [])` with a delete affordance on user ones. Reuses `refreshMixer()`/`applyLevels` exactly as the built-ins do.
- **Lock-screen artwork in Media Session** (medium value, trivial). `updateMediaSession()` in js/app.js sets title/artist/album but no `artwork`, so Android/iOS lock screens and desktop media overlays show a blank tile. Add `artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }]` (needs the PNG icons from the manifest upgrade; SVG is not accepted by iOS here). Optionally draw a per-mix tile from the share-card code in js/card.js at 256x256 and pass it as a blob: URL.
- **Web Share API for links and share cards** (medium value, small). `copyShare()` in js/app.js always uses the clipboard and the `#card` handler always downloads. On mobile, prefer `navigator.share({ title, url })` and, for the card, `navigator.canShare({ files: [new File([blob], 'mix.png', { type: 'image/png' })] })` -> `navigator.share({ files })`, falling back to the existing paths. Small branch in two functions; the toast copy already exists.
- **Screen Wake Lock while playing in quiet mode** (medium value, small). Quiet mode is designed as an ambient display (full-screen visualiser, css `body.quiet .visual { position: fixed }`), but the screen dims and locks normally. Hook: in `setQuiet()` and `updatePlayButton()` in js/app.js, when quiet && playing request `navigator.wakeLock.request('screen')`, release on pause/exit, and re-request on `visibilitychange` (the lock is dropped when the tab hides). Guard for missing API.
- **Seed history with 'previous seed'** (medium value, small). Every 🎲 roll discards the previous seed; the only recovery is a saved mix. In the `$('dice')` handler and `$('seed')` change handler in js/app.js, push the outgoing seed onto `prefs().recentSeeds` (cap 20) and add a '↶ Previous' button next to the dice that pops it and calls `recompose()`. A small 'Recent seeds' datalist on the `#seed` input (`<input list="recentSeeds">`) gives the whole history for free.
- **Wake-up mode and 'sleep until HH:MM'** (medium value, small). The sleep timer (`tickSleep` in js/app.js) only counts minutes down. Add (a) a clock-time option ('until 07:00') by storing an absolute `Date` instead of `Date.now() + min*60000`, and (b) a mirror-image wake-up mode: at a set time, `transport.play({ fade: N*60 })` from master gain 0 - `Transport.play` already accepts a fade length and ramps the master from 0. Both run on the existing `AN.ticker(500, tickLogic)` so they work in a background tab.
- **Recording pause/resume and a hang guard** (low value, small). `Recorder` in js/audio/recorder.js wraps MediaRecorder but exposes only start/stop; `stop()` calls `rec.stop()` unconditionally and never resolves if `rec.state === 'inactive'` (stream ended, tab discarded), leaving the UI stuck on '■ Stop'. Add `pause()`/`resume()` (MediaRecorder supports both), resolve immediately when already inactive, and surface a second button in the 'Save as audio' block of index.html.
- **Keyboard shortcut overlay on '?'** (low value, trivial). index.html's footer lists three shortcuts; the README table lists eight (N/P, Home/End/PgUp/PgDn on the timeline, Esc). Add a `?` key in the document keydown handler in js/app.js that toggles a small `<dialog>` listing them all; generate it from one table shared with the footer so they cannot drift.

## Code quality

- **Extract the Playwright bootstrap duplicated across three smoke suites** (high value, small, `/home/user/abientnoiser/test/browser.smoke.mjs`). test/browser.smoke.mjs, test/musical.smoke.mjs and test/texture.smoke.mjs each open with the same ~40 lines: the `require('playwright')` with a hard-coded fallback to `/opt/node22/lib/node_modules` (a developer-machine path that should not be in the repo), random-port spawn of scripts/serve.js, stdout/stderr capture, the readiness poll, `check()`, and the identical try/catch/finally with `serverGone` reporting. Move to test/harness.mjs exporting `withApp(async ({ page, browser, check }) => {...})` and delete the `/opt/node22` fallback (npm ci is the supported path). Or adopt @playwright/test with a `webServer` config, which removes it entirely.
- **Add Node unit tests for storage.js, recorder.js pure functions, theory.js and composer edge cases** (high value, small, `/home/user/abientnoiser/test/composer.test.js`). `npm test` covers prng/theory/composer/styles/shell/server; the untrusted-input layer is only exercised end-to-end in Chromium. All of the following are pure JS runnable under `node --test` with a 10-line localStorage stub: test/storage.test.js - cleanSettings clamps (volume 12 -> 1, durationMin 'x' -> 60, unknown style -> 'ambient', unknown level keys dropped, negative -> 0, daypart 'auto' kept, bogus daypart -> null); cleanEdits (index > 400 dropped, non-integer key dropped, minutes rounded to 0.5 and capped at 60, keyRoot -1 -> 11, unknown mood/mode dropped, empty edit removed); encodeShare/decodeShare round-trip with a unicode seed and with `+`/`/` in the base64; decodeShare of junk -> null; importJSON accepts a bare array and `{mixes}`, throws 'Not a mix library file' otherwise; save() returns null when setItem throws. test/recorder.test.js - `AN.wavHeader(frames, ch, sr)` byte offsets and RIFF size; `AN.pcm16` with a fake `{numberOfChannels, length, getChannelData}`: interleave order, `skip`, clipping, -1 -> -32768 and 1 -> 32767. test/theory.test.js additions - `nearestOctave` stays inside [low, high] and picks the nearer octave; `scaleNotes` bounds inclusive; `chordQuality` for dim/aug/m7b5; `keyName(-1) === 'B'`. test/composer.test.js additions - a pinned movement keeps its exact length and total still equals duration; pinned sum exceeding duration hits the scale-to-fit branch; edits keyed '3' and 3 both apply; `daypartAt` boundaries at 4:59/5:00/10:59/11:00/16:59/17:00/21:59/22:00; sectionMin > durationMin still yields >= 2 sections; `chordNames[i] === chordName(keyRoot, mode, progression[i], chordSize)`. test/prng.test.js additions - `weighted` with all-zero weights returns the last item; `poisson(40)` (gaussian path) is never negative; `shuffle` is a permutation; `hashString('')` known vector.
- **Split the 936-line app.js UI module** (medium value, medium, `/home/user/abientnoiser/js/app.js`). app.js owns init, theme, visualiser wiring, service worker, quiet mode, media session, steering, the focus timer, the sleep timer, the queue/crossfade engine swap, the movement editor, the library, share/card, recording and WAV export, plus all keyboard handling. Each of these has 2-6 functions and its own slice of `state`. Split along the existing `// ----------` section comments into js/ui/timers.js (pomodoro + sleep + tickLogic), js/ui/queue.js (saveQueue/renderQueue/enqueue/crossfadeTo/advanceQueue/tickQueue), js/ui/editor.js, js/ui/library.js, js/ui/mediaSession.js, each an IIFE attaching to `AmbientNoiser`, leaving app.js as init + bind. sw.js SHELL and index.html script order follow (test/shell.test.js guards that).
- **Break the 809-line sequential browser suite into isolated tests** (medium value, medium, `/home/user/abientnoiser/test/browser.smoke.mjs`). Roughly 45 checks run in one try block against one shared page, and several mutate app state that later checks depend on (e.g. the 'load' section calls `AmbientNoiser.applySettings` and the queue section saves two library mixes that the persist section then counts with `library >= 1`). One throw (say, a Playwright timeout on `#play`) aborts everything after it with a single stack trace. Group into independent blocks that each open a fresh page (the suite already does this for `phone`, `prefsPage`, `persist`, `shared`), and emit TAP or use the Playwright runner so CI can annotate individual failures.
- **One definition of the swing offset instead of five** (medium value, trivial, `/home/user/abientnoiser/js/audio/engine.js`). `(swing - 0.5) * 2 * stepLen` on odd sixteenths appears in js/audio/engine.js:139, js/audio/drums.js:204 and :237, test/styles.test.js:78 and test/musical.smoke.mjs:111. CLAUDE.md records that this exact formula caused the 'swing 0 pulls notes early' bug. Add `AN.swingOffset(swing, sixteenth, stepLen)` next to `AN.formatTime` in composer.js (or theory.js), use it in the engine and both kit steps, and have the tests import it for the upper bound while keeping their absolute 'never early' lower bound, as the musical suite's comment insists.
- **localStorage write failures are swallowed everywhere except save()** (medium value, small, `/home/user/abientnoiser/js/storage.js`). `write()` returns false when the browser refuses storage, but only `save()` checks it. `rename`, `remove`, `autosave`, `setPref` ignore the result, and `importJSON` returns `added` (so app.js toasts 'Imported 3 mixes') even when `write(KEY, mixes)` failed and nothing persisted. Make `importJSON` return `write(...) ? added : -1` (or throw), have `rename/remove` return the boolean, and let app.js reuse its existing 'this browser is blocking local storage' toast.
- **Recorder.stop() can hang forever; constructor naming is misleading** (medium value, trivial, `/home/user/abientnoiser/js/audio/recorder.js`). `stop()` sets `rec.onstop` then calls `rec.stop()`; if `rec.state` is already 'inactive' (the MediaStream ended, or the tab was discarded and restored) MediaRecorder throws InvalidStateError, the promise never resolves, and `toggleRecord` in app.js awaits forever with the button stuck on '■ Stop'. Guard: `if (rec.state === 'inactive') return resolve(this.chunks.length ? new Blob(...) : null)`. Separately, the constructor takes `output` (an AN.Output) but stores it as `this.graph`, which reads as if it were an AN.Graph.
- **Engine holds a private settings object that drifts from state.settings** (medium value, small, `/home/user/abientnoiser/js/audio/engine.js`). `Engine.setPlan` does `Object.assign(this.settings, settings)` onto the object the engine was constructed with, while app.js replaces `state.settings` wholesale in `applySettings` and `setEdit` (`state.settings = AN.storage.cleanSettings(...)`). After either call `engine.settings !== state.settings`; `Transport.play` ramps to `engine.settings.volume` and `engine.levels` is a third copy. It works today because every mutation path happens to write both, but it is one missed `Object.assign` from a volume or level regression. Either make the engine read settings through a getter (`opts.getSettings`) or pass explicit `{ volume, levels }` on every call and drop `this.settings`.
- **Deduplicate the chord-tone-in-scale filter** (low value, trivial, `/home/user/abientnoiser/js/audio/engine.js`). `scale.filter((m) => chord.tones.some((tn) => ((m - chord.keyMidi - tn) % 12 + 12) % 12 === 0))` is written identically in `walkBass` (line 227) and `playMelody` (line 257). Add `T.chordNotesIn(scale, keyMidi, tones)` to js/theory.js with a unit test, and use it in both.
- **Merge the identical voice-output helpers in synths.js and drums.js** (low value, trivial, `/home/user/abientnoiser/js/audio/synths.js`). `output(graph, layer, pan)` in js/audio/synths.js:7 and `out(graph, layer, pan)` in js/audio/drums.js:7 both create a Gain -> panner -> layer.input chain and return the pair under different key names (`{out,p}` vs `{g,p}`). Move to `Graph.prototype.voiceOut(layer, pan)` in js/audio/graph.js and use it from synths, drums and the Creek/Birds one-shots in ambience.js, which build the same chain inline.
- **One section-colour function for timeline, list and share card** (low value, trivial, `/home/user/abientnoiser/js/card.js`). `hsl(${s.hue} 45% ${28 + s.intensity * 30}%)` appears in js/app.js:530 (timeline segment), js/app.js:545 (list swatch, as an inline style attribute inside innerHTML) and js/card.js:113 (card strip); `updateNow` uses a fourth variant `hsl(${s.hue} 45% 40%)` for the badge. Add `AN.sectionColor(section, { lightness })` in composer.js or visual.js; setting `el.style.background` instead of the inline attribute also removes the only `style=` string in the app (relevant to the CSP upgrade).
- **Lock-button rendering is duplicated in three places** (low value, trivial, `/home/user/abientnoiser/js/app.js`). `$('lock').classList.toggle/remove('active')` plus `$('lock').textContent = '🔓 Lock'` is repeated in `setLock` (line 290-291), `recompose` (351-352) and `crossfadeTo` (456-457). The commit 'clear the lock button on a crossfade' (90b0316) was a bug caused by exactly this. Extract `renderLock(on)` and call it from all three, with `aria-pressed` set in the same place.
- **defaultSettings() and cleanSettings() produce different shapes** (low value, trivial, `/home/user/abientnoiser/js/composer.js`). `AN.defaultSettings` returns `{ seed, style, durationMin, sectionMin, levels, volume }` with no `daypart` or `edits`, whereas `cleanSettings` always emits both. `init()` in app.js uses the default without cleaning, so `state.settings.edits` is undefined on first run and `editOf()` has to create it lazily, and `daypart` is undefined rather than null. Return `cleanSettings({...})` from `defaultSettings` (cleanSettings lives in storage.js, which loads after composer.js, so either move `cleanSettings` into composer.js or clean in `init`).
- **Name the unexplained magic numbers** (low value, small, `/home/user/abientnoiser/js/audio/engine.js`). Several timing constants have no name or comment: the 350 ms delay before `killAll` in `Transport.pause` (engine.js:379), `fade * 1000 + 400` in `dispose` (442), the `t + 0.6` texture stop in `Engine.applyLevels` (60), `MIN_LEN = 30` in composer.js (has a name, no rationale), the 0.08 intensity threshold in app.js `steer`, the 4-second 'restart current movement' window in `jumpMovement`, the 120 ms scheduler ticker and 500 ms logic ticker, and `v * 10.1` MB in `buildWavLengths` (44100*2ch*2B*60s). The well-commented ones (`lookahead = 2.5`, `softLimit = 130`, `SLEEP_FADE = 20`) show the house style; give the rest the same treatment as named constants at the top of each file.
- **Credit and explain the non-obvious DSP and maths** (low value, trivial, `/home/user/abientnoiser/js/audio/graph.js`). graph.js `buildNoise` uses Paul Kellet's pink-noise filter coefficients (0.99886/0.0555179 etc.) with no attribution; prng.js does credit cyrb53 and mulberry32, so this is an inconsistency. visual.js line 80 `((target - hue + 540) % 360) - 180` (shortest arc around the hue circle) and composer.js line 289 `0.22 + 0.55 * Math.abs(Math.sin(Math.PI * peaks * phase))` (the intensity arc with one or two peaks, low at both ends so the loop seam is calm) deserve a one-line comment each; `Rng.weighted` returning the last item on rounding is fine but undocumented.
- **Dev server, service worker and PRNG are copy-pasted across sibling repos** (low value, medium, `/home/user/abientnoiser/scripts/serve.js`). scripts/serve.js and sw.js are near-copies of /home/user/phonogeometry/server.js and sw.js (same shape, different hardening: this repo has the abort/traversal fixes, phonogeometry has --https and .mjs types); the mulberry32 PRNG exists in four other repos (sudokuoku, battleshiple, notenote, chesscheatser, all TypeScript). Fixes land in one copy at a time - the 'harden the dev server' commit (3af570c) here never reached phonogeometry. Consider a tiny private `@platteration/devkit` (serve, sw template, rng) or at minimum a template repo, so the next vanilla PWA starts from the hardened versions.
- **Generate the SW SHELL list instead of hand-maintaining it** (low value, small, `/home/user/abientnoiser/sw.js`). sw.js SHELL is a hand-typed list of 19 paths that test/shell.test.js cross-checks against index.html on every run. The test already contains a `pageAssets()` parser; reuse it in a `scripts/build-sw.js` step (run in pages.yml before upload) that writes both the SHELL array and the SHA-stamped VERSION, and keep the test as the local guard. This removes the last hand-synchronised list in the repo.

## Shared across all Platteration repositories

The same gaps recur in every repository; fixing them once as a template and copying it is cheaper than fixing them fourteen times.

### CI and supply chain

1. **No workflow sets `permissions:`** (except the two Pages deploy jobs). Add `permissions: { contents: read }` at the top of every workflow so the `GITHUB_TOKEN` handed to third-party actions cannot write to the repository.
2. **No action is pinned to a commit SHA** (0 of 50 `uses:` lines across the fourteen repositories). `actions/checkout@v4` follows a movable tag; pin to the full 40-character SHA with the version in a comment, and let Dependabot bump it.
3. **No repository has Dependabot or Renovate.** Add `.github/dependabot.yml` with `npm` (or `pip`) and `github-actions` ecosystems, weekly.
4. **No CI step runs `npm audit`** (two workflows pass `--no-audit` explicitly). Add `npm audit --audit-level=high` after `npm ci`; for the Expo apps the current transitive advisories are build-time only (`uuid` via `xcode` via `@expo/config-plugins`), so gate on `high` rather than `moderate` until Expo ships the fix.
5. **`tvsham` runs `npm ci || npm install` in CI and in its Dockerfile.** The fallback silently discards the lockfile guarantee; drop it and fix the lockfile instead.
6. **`selfreportle`, `simplacad` and `phonogeometry` have no lockfile** and install Playwright ad hoc in CI. Add a `package-lock.json` (even with devDependencies only) and use `npm ci`.
7. **Enable secret scanning and push protection** in each repository's settings; nothing is committed today, and this keeps it that way.

### Repository hygiene

8. **Ten repositories have no `LICENSE`** (battleshiple, collectcollect, drawdraw, multidcheckers, multidconnect4, notenote, randostats, selfreportle, simplacad, tvsham). Without one, nobody else may legally use or contribute to the code. The siblings that have one use MIT.
9. **Only `simplacad` has a `SECURITY.md`.** Copy it to the others with a private reporting address.
10. **No repository has a `main` branch.** In all fourteen the default branch is the original `claude/...` feature branch, so branch protection, Dependabot targets and the two GitHub Pages workflows (`abientnoiser`, `chesscheatser` both trigger on `main`/`master`) all point at a branch that does not exist; those deploys have never run. Create `main` from the current branch, make it the default, and protect it.
11. **`drawdraw` is the one repository still on Expo SDK 53** (the rest are on 57). Its eight high-severity `npm audit` findings (`image-size`, `metro`) disappear with the SDK upgrade; it is also the only app not written in TypeScript and the only one pinned to Node 20 in CI.
12. **`multidcheckers` and `multidconnect4` are near-identical copies** (same branch name, same 65-file layout, same dependencies). The timeline/multiverse engine, persistence and share code should live in one shared package so fixes land in both.

### A hardened workflow to copy

```yaml
name: CI
on:
  push:
    branches: ["**"]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@<full-sha> # v4
      - uses: actions/setup-node@<full-sha> # v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npm run lint --if-present
      - run: npm run typecheck --if-present
      - run: npm test
```
