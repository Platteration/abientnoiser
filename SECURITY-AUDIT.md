# abientnoiser — security audit (2026-09-11)

A dedicated security pass, separate from and later than the review in `REVIEW.md`. Specialist reviewers read the repository through a combined lens (L13), each required to *demonstrate* a finding rather than argue for it.

**2 findings** — 2 low. 1 of 2 was reproduced with command output; the other is reasoned from the code.

## Status

Every finding below was fixed on `claude/repo-review-security-baiyud` in ff5569b, each with a regression test that was checked by reverting the fix and confirming the test fails. The findings are kept as written so the reasoning behind each change stays with it.

## Findings

### L13-1 · low — Library import has no ceiling: a ~1 MB file permanently installs 13,000 mixes that renderLibrary() rebuilds on every load, with no bulk delete to undo it

`js/storage.js`:85 · CWE-770 · reproduced

**Who.** Whoever gives the victim a .json file and asks them to import it ("here is my mix library / a backup / a pack of presets") — a plausible social step for an app whose own UI advertises Export library / Import library. The attacker controls the whole file; they need no access to the device or the origin.

**How.** 1. Build a file of the shape importJSON accepts: {"app":"ambientnoiser","version":1,"mixes":[ ... ]} where each entry is the minimum that survives the filter — {"id":"x0","name":"m","createdAt":1,"settings":{"seed":"s","style":"ambient"}}. 2. Put ~13,000 of them in it, which is about 1.0 MB on disk because cleanSettings expands each 60-byte entry into a 321-byte record (the full 17-key levels object). 3. Send it to the victim; they press Import library and choose it. 4. importJSON pushes every entry (no cap anywhere in the loop), write() succeeds because 4.13 MB is inside a browser's ~5 MB localStorage quota, and the toast says "Imported 13000 mixes". 5. From then on every renderLibrary() — on page load, after every save, after every delete, after every import — does list.innerHTML='' and then builds 13,000 <li>, each via its own innerHTML parse plus three querySelector calls and three addEventListener calls: ~91,000 listeners and ~130,000 nodes rebuilt from scratch each time. 6. The only removal affordance is the per-mix ✕ button, which calls confirm() once per mix; index.html has a 'Clear queue' button but nothing that clears the library.

**Why it matters.** Persistent client-side denial of service against the victim's own install: the app spends a large, repeated cost on every load and every save for the life of the origin's storage, and there is no in-app way out — recovery means clearing site data through browser settings. It also consumes essentially the whole localStorage quota, so the visitor's own subsequent saves fail with 'Could not save — this browser is blocking local storage'. No code execution and no data exposure; the imported settings themselves are correctly sanitised by cleanSettings.

**Evidence.**

js/storage.js:84-95 — the import loop has no ceiling, and the only guard is the quota check after it:

      let added = 0, skipped = 0;
      for (const m of incoming) {
        if (!m || !m.settings) continue;
        const id = typeof m.id === 'string' && m.id && m.id.length <= 40 ? m.id : uid();
        if (seen.has(id)) { skipped++; continue; }
        seen.add(id);
        mixes.push({ id, name: String(m.name || 'Imported').slice(0, 60), createdAt: ..., settings: cleanSettings(m.settings) });
        added++;
      }
      if (!write(KEY, mixes)) throw new Error('this browser refused to store the library ...');

js/app.js:739-768 renderLibrary() rebuilds the whole list every time it is called, one innerHTML parse and three addEventListener per mix; js/app.js:67, 917, 945, 764 are its four call sites. index.html:101-109 has 'Clear queue' but no 'Clear library'.

Measured output of the reproduction below, running the real js/storage.js against a localStorage stub with a real 5 MB browser quota:

  bytes of one cleaned mix record: 321
  n=  1000  file=0.08MB  added 1000  stored=0.32MB / 1000 mixes  import 9 ms
  n=  5000  file=0.39MB  added 5000  stored=1.59MB / 5000 mixes  import 21 ms
  n= 12000  file=0.94MB  added 12000 stored=3.81MB / 12000 mixes import 50 ms
  n= 13000  file=1.02MB  added 13000 stored=4.13MB / 13000 mixes import 45 ms
          renderLibrary() would build 13000 <li> (4 buttons + 3 listeners each = 91000 listeners); list()+scan alone 28 ms
  n= 20000  file=1.57MB  THREW: this browser refused to store the library (out of space, or storage is blocked)  stored=nothing

The n=20000 row is the useful control: past the quota the write fails and nothing is stored, which is exactly why an attacker aims at ~13,000 — the largest payload that sticks.

**Fix.** Bound the list where it is written, the way HISTORY_LIMIT-style caps are normally applied. In js/storage.js add `const MAX_MIXES = 500;` and inside importJSON's loop, before the push: `if (mixes.length >= MAX_MIXES) { skipped++; continue; }` — then the existing toast already reports `${skipped} already here`, so widen that wording to cover 'the library is full'. Apply the same ceiling in save() (it unshifts, so `mixes.length = Math.min(mixes.length, MAX_MIXES)` after the unshift drops the oldest). Separately add a 'Clear all mixes' button beside Export/Import in index.html:112-116 wired to a single confirm() plus `write(KEY, [])`, so a library that did get filled can be emptied without clearing site data. A regression test belongs in test/composer.test.js: import 2×MAX_MIXES entries and assert `AN.storage.list().length === MAX_MIXES`.


### L13-2 · low — The service worker's activate handler deletes every Cache on the origin, not only the ones it owns

`sw.js`:25 · CWE-668 · reasoned

**Who.** Any other application published by the same account on the shared *.github.io origin — including, symmetrically, this one. The 'attacker' here need not be hostile: the defect is that Ambient Noiser exercises a privilege (destroying Cache Storage) that reaches every co-tenant app, and any co-tenant that ships the same pattern can do the same back to it.

**How.** 1. pages.yml deploys this app to the account's GitHub Pages, i.e. https://<account>.github.io/abientnoiser/ — a project path on an origin shared by every other Pages site the account publishes (chesscheatser already has its own pages.yml, and phonogeometry and notenote both ship service workers of their own). 2. Cache Storage is partitioned by origin, not by service-worker scope, so `caches.keys()` inside /abientnoiser/sw.js enumerates the cache names of every app on <account>.github.io. 3. On activate the handler keeps exactly one name — its own VERSION — and deletes all the rest. 4. Because the Pages deploy re-stamps VERSION with ${GITHUB_SHA:0:8} on every push (pages.yml:45), VERSION changes on every deploy, so a new worker activates and re-runs this sweep every time the app is shipped, not only when the shell actually changed. 5. Any other PWA of the account that the visitor had installed for offline use loses its precache and stops working offline until it is next opened online; a co-tenant app that copies this same activate handler wipes Ambient Noiser's cache in return.

**Why it matters.** Availability of every other same-origin app's offline mode, repeatedly and silently. Each affected app must be re-opened while online to rebuild its shell cache; a user who installed one as a PWA and opens Ambient Noiser on a flight finds the other one blank. Nothing is read, nothing is forged, and no data is lost beyond the caches themselves — this is an over-broad destructive privilege rather than a compromise. The blast radius is zero if the app ever gets its own origin (custom domain), which is exactly why the scope of the sweep, not the sweep itself, is the defect.

**Evidence.**

sw.js:22-28 —

  self.addEventListener('activate', (e) => {
    e.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
        .then(() => self.clients.claim())
    );
  });

`keys` is every cache name in the origin's CacheStorage; the only survivor is this worker's own VERSION. Contrast the cache name itself, sw.js:7, which is correctly namespaced: `const VERSION = 'ambient-noiser-18337f098e73';` — the prefix that makes ownership decidable exists and is simply not used in the filter. Same for the localStorage keys, js/storage.js:4-6, which are all namespaced `ambientnoiser.*.v1`; Cache Storage is the one store this app treats as its own.

That the origin is shared: .github/workflows/pages.yml:32-51 deploys to GitHub Pages with no custom domain, and README.md:57 documents that as the deployment route; /home/user/chesscheatser/.github/workflows/pages.yml does the same for a second app, and /home/user/phonogeometry/sw.js:17 and /home/user/notenote/public/sw.js are further service workers from the same account.

VERSION churn on every deploy: .github/workflows/pages.yml:45 —
  sed -i "s/^const VERSION = .*/const VERSION = 'ambient-noiser-${GITHUB_SHA:0:8}';/" sw.js
so the activate sweep runs again on every push to main, whether or not the shell changed.

Not executed: this sandbox has no Chromium and no ms-playwright download cache, so the two-apps-one-origin demonstration could not be run. The behaviour of caches.keys() being origin-scoped rather than scope-scoped is specified, not inferred.

**Fix.** Delete only this app's own caches: in sw.js:25 change
  keys.filter((k) => k !== VERSION)
to
  keys.filter((k) => k !== VERSION && k.startsWith('ambient-noiser-'))
Hoist the prefix into a constant next to VERSION (`const PREFIX = 'ambient-noiser-';  const VERSION = PREFIX + '18337f098e73';`) so the deploy's sed at pages.yml:45 and test/shell.test.js's `ambient-noiser-${shellHash()}` both keep matching. Add an assertion to test/shell.test.js beside the existing 'revalidates hits' test: read sw.js and require the activate handler's filter to mention the prefix, so a future edit cannot widen it back.


## Checked and sound

What the reviewers tried and could not break. Recorded so it is not re-raised, and so a future change that undoes one of these is recognisable as a regression.

- Whitelist coverage across every table a share link can reach is complete. I enumerated every dynamic lookup into AN.STYLES, AN.MOODS, AN.DAYPARTS and AN.theory.MODES and drove 4,000 randomised hostile settings objects (prototype names, NaN/Infinity, 1e308, '1e400', arrays, nested objects, numeric-string keys, edits indexed by '__proto__' and 401) through the real cleanSettings -> compose pipeline: zero escapes. Every gate is Object.prototype.hasOwnProperty (storage.js:20,31,32,42,51; composer.js:11,195,233,239,307,316), every cleaned field lands inside its documented range (style in STYLES, daypart in DAYPARTS or 'auto' or null, durationMin 5-240, sectionMin 1-15, volume 0-1, levels 0-1, edit.keyRoot an integer 0-11, edit.minutes 0.5-60, seed a string <= 64 chars), and every composed section carries a real mode, a real mood, a finite tempo/intensity/hue and chord names free of 'undefined'/'NaN'. Sections tile [0, duration) with no gap and no overlap in every run, and sectionAt() returned the containing section for every probe position.
- Prototype pollution: there is none. All eight Object.assign call sites (app.js:125,377; engine.js:33,49,56,87; storage.js:71; composer.js:202) take their keys from first-party constants or from an already-cleaned levels object whose 17 keys are fixed, so no attacker-chosen '__proto__' ever reaches a [[Set]]. cleanEdits keys its output by Number(key) validated with Number.isInteger, so 'constructor'/'__proto__' become NaN and are dropped. The three JSON.parse results that come from outside (share link, imported file, prefs) are only ever read field-by-field, never spread or merged.
- HTML sinks. Every innerHTML template in app.js was read against what actually reaches it: renderPlan (app.js:581-585) now escapes name, keyName, mode and chordNames — MISS-1's missing ${s.mode} is fixed — and the remaining raw interpolations (s.hue, s.intensity, s.tempo, v, m.settings.durationMin) are numbers clamped by cleanSettings or derived from first-party MOODS/STYLES tables. renderLibrary (748) and renderQueue (456) escape name and seed, and their raw ${st.icon}/${st.name} come from AN.STYLES keyed by an already-whitelisted style id. escapeHtml (app.js:771) covers & < > " ' which is sufficient for both the text and the quoted-attribute contexts it is used in. Everything else is textContent, a DOM property assignment (d.title, o.value), or CSSOM setProperty, none of which parse markup.
- The Content-Security-Policy is as restrictive as this app can be. script-src 'self' with no 'unsafe-inline'/'unsafe-eval'/wildcard and no inline <script> anywhere; base-uri 'none' and form-action 'none' close the two classic bypasses; object-src 'none'; connect-src 'self' matches an app that makes no fetches at all. worker-src 'self' blob: is exactly right and non-obvious — 'self' is required for navigator.serviceWorker.register('sw.js') and blob: for the timer.js ticker worker; dropping either breaks a real feature. style-src 'unsafe-inline' is genuinely needed today by the style="background:hsl(...)" attributes in the renderPlan/buildStyles templates, and is not exploitable because the only values interpolated there are first-party numbers. frame-ancestors is absent because a meta tag cannot set it and GitHub Pages cannot send headers; with no authenticated action, no credential and a confirm() in front of the only destructive button, the clickjacking value of framing this page is nil.
- Service-worker caching, beyond the finding above. Navigations match the single cached document with ignoreSearch and are never stored under their own URL, so ?mix= links no longer accumulate copies (sw.js:45-57); the DOC constant and the SHELL entries are relative and resolve against the worker's own scope, so the precached './' and the revalidation key are the same entry. The subresource cache cannot grow without bound: the worker's scope is the app directory, the page requests only the 19 precached shell files and fetches nothing else (connect-src 'self', zero fetch()/XHR in js/), and opaque/non-ok responses are not stored. revalidate()'s Request reconstruction is inside a try/catch and its whole chain ends in .catch, so a redirected or unputtable response cannot reject an unhandled promise.
- The service worker's offline fallback still answers ANY failed same-origin GET with the cached document, not just navigations (sw.js:60) — the half of REL-1 the fix did not narrow. I chased it and it is not a security defect: the document served is first-party fixed HTML, GitHub Pages sends X-Content-Type-Options: nosniff so it cannot be executed as a script, object-src is 'none', and the page embeds no frames or media whose type confusion could matter. It is a confusing failure mode, not a hole.
- Recorder and WAV export. The MediaRecorder is attached only to Output.recordDest, a MediaStreamAudioDestinationNode fed from the app's own master gain; getUserMedia, navigator.mediaDevices and navigator.permissions appear nowhere in the tree, so the README's 'no microphone permission is ever requested' is true. Download filenames cannot escape: fileStem() strips everything outside [a-z0-9-] and the stem is prefixed 'ambient-noiser-', so an attacker-chosen 64-character seed cannot produce a path separator, a leading dot or a second extension. wavHeader's setUint32 cannot silently wrap — the UI caps an export at durationMin <= 240, i.e. 2.54 GB of data, against a 4 GB field — and pcm16 writes exactly n*channels*2 bytes into an ArrayBuffer of that size. renderWav deep-copies the settings before composing, so a fader moved mid-export cannot step a chunk boundary, and each chunk's OfflineAudioContext is bounded at lead+len <= 320 s.
- A share link cannot make the app burn unbounded memory or time. compose() is bounded at 240 movements (duration <= 14400 s, sectionLen >= 60 s) and measured at 74 ms worst case over 4,000 hostile inputs; the pinned-length rebalance always rescales to sum exactly to duration, and a targeted search (240 movements, all but a handful pinned to the 60-minute maximum) could not produce a zero-length or negative-length movement in 100 seeds. Transport.scheduleUntil carries a 100,000-step guard and stepLen is bounded to 0.113-0.375 s by the tempo clamp, so a 2.5 s lookahead is ~7 steps; the section-change branch can only rewind the cursor by at most one step during forward play. Every ambience tick's while-loop advances by a term that is not divided by the section multiplier (crickets: on >= 0.35 s; train: >= 1.45 s), so the per-step windows admit at most one or two iterations. The live source cap (graph.hasRoom, softLimit 130) holds, and it correctly does not apply offline, which is the CLAUDE.md 'Offline is not live' invariant.
- The autosave/share-link invariant holds. init() sets state.fromShare from decodeShare's result and autosaveOnExit() suppresses the write while it is set (app.js:41,372,967), autosave() clears the flag as soon as the visitor changes anything, and no code path writes ambientnoiser.autosave.v1 during a link-only visit — I traced all six autosave() callers and all of them are user actions. decodeShare wraps atob/escape/JSON.parse in one try/catch and returns null on any malformed code, in which case the visitor's own autosave is used. The cleaned settings object is bounded at roughly 25 KB (401 edits maximum), so a share link cannot fill the quota either.
- The other CLAUDE.md invariants are intact: every write to layer.user goes through applyLevels (graph.setUserLevel has exactly three call sites, all in engine.applyLevels); pads/arp/drone route to 'pump' and drums alone use the room impulse (engine.js:9-10,29-30); swing is clamped to [0.5, 0.8] (composer.js:284); the deadline timers all run on AN.ticker while only drawing uses requestAnimationFrame; buildSelect compares with String(v) === String(current) (app.js:92); and the sw.js VERSION is the derived shell hash that test/shell.test.js recomputes, which I confirmed passes.
- The dev server survived everything I threw at it over a raw socket and stayed up: %00 at the root and mid-path, %2e%2e and ..%2f and .%2e encodings, /%252e%252e double-encoding, an absolute-URI request line (GET http://evil.example/../../../../etc/passwd), //etc/passwd, 200 stacked ../ segments, a 6,000-character path, invalid UTF-8 (%c0%ae), OPTIONS *, and a POST — traversal attempts got 403, dotfiles 404, NUL 400, and /index.html still returned 200 afterwards. It binds 127.0.0.1 unless HOST says otherwise (serve.js:14) and blocks every path component beginning with a dot (serve.js:39), so .git and .github stay unreachable. It does serve the rest of the checkout, including node_modules/, scripts/ and test/, to anything that can reach the port — but the port is loopback, the content is a public repository, there is no state-changing route, and no CORS header is set, so a cross-origin page cannot read a response without a DNS-rebinding step that would still yield only public source.
- The localStorage-as-untrusted-input path is sound. loadAutosave() runs cleanSettings; list() returns records whose settings were cleaned at both write points (save and importJSON); prefs() is read raw but every consumer validates — visuals is checked against the literal 'on'/'off', theme falls back to the select's first option when unrecognised, queueEvery/crossfade go through Number(...) || default, and queue is filtered to ids that exist in the library. No prefs value is ever used as an object key or a table lookup.
- Two bare table lookups survive that CLAUDE.md's 'never a bare TABLE[id]' rule would forbid — setStyle's `if (!AN.STYLES[id]) return` (app.js:375) and the `AN.STYLES[m.settings.style] || AN.STYLES.ambient` fallbacks (app.js:453,745) — but neither is reachable with an outside value: setStyle is not exported on window.AmbientNoiser and its only caller passes Object.keys(AN.STYLES), and the renderers' style ids have already been through cleanSettings. Likewise compose() does not re-validate edits[i].minutes numerically, and I confirmed by running it that AN.compose on an *uncleaned* settings object yields NaN section boundaries — but all five production call sites (app.js:44,385,489; recorder.js:68 via a deep copy of state.settings) pass a cleaned object, so there is no path to it. Recorded as defence-in-depth, not reported as findings.
- Also considered and dismissed: window.AmbientNoiser exposes state and a dozen functions to any same-origin script, which buys an attacker nothing they would not already have; MediaMetadata carries the attacker-chosen seed into OS media controls as plain text, which is a 64-character spoofing surface behind a 'Ambient Noiser · seed ' prefix; storage.js:15 uses Math.random for mix ids, which is outside the CLAUDE.md rule but is not a security token (ids are local list keys, never shared or authorised against); and pages.yml still uploads `path: .` so test/, scripts/ and CLAUDE.md are published — already recorded as the still-unfixed MISS-4 in REVIEW.md, and nothing published there has an HTML content type or an injection point.

