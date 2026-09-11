# Ambient Noiser — working notes

A static, dependency-free web app that generates hour-long looping soundscapes with
the Web Audio API. No build step, no server, no samples. `npm start` serves it;
`index.html` loads the scripts in dependency order.

## Layout

| File | Role |
| --- | --- |
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
| `js/visual.js`, `js/card.js`, `js/app.js` | visualiser, share image, UI |

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

**Levels multiply three ways**: `layer.input` (the movement's own multiplier) ×
`layer.user` (the mixer) × `engine.duck` (breaks, focus modes). `applyLevels` is the
only thing that should write `user`.

**Bus routing matters.** Pads, arpeggio and drone go through `pump` so the kick can
duck them; drums use the short room impulse, everything else the hall.

**Anything from outside is untrusted.** Share links carry base64 JSON. Everything goes
through `AN.storage.cleanSettings` before use, and anything rendered into HTML goes
through `escapeHtml`. Whitelists are own-property lookups (`has(TABLE, id)`), never a
bare `TABLE[id]`: every name on `Object.prototype` — `constructor`, `__proto__`,
`toString` — is truthy on a plain table and used to pass as a valid style, mood or
mode. A share link is not written to the autosave until the visitor changes something,
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

**Timers with deadlines use `AN.ticker`, not `requestAnimationFrame`.** Browsers pause
animation frames in hidden tabs, which is exactly when this app is playing. Drawing
may use frames; the sleep timer, focus timer and queue may not.

## Tests

```bash
npm test               # node --test: PRNG, theory, composer, styles, app shell, dev server
npm run test:musical   # every style's whole loop checked for wrong notes and wrong timing
npm run test:textures  # each texture checked against the sound it claims to be
npm run test:browser   # Playwright + Chromium, end to end
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

`test:textures` is the only check on how things actually sound. Nobody has heard this
app; spectral balance is the closest available proxy. It puts the piece into a bright
morning movement so even the rare textures fire, rather than hoping one lands inside
the window.

The browser suite spawns the dev server on a random port and waits for it to answer.
It asserts against measured behaviour (levels, source counts, render times), so widen
a bound only when you have measured that the old one was wrong.

Playwright is the only dependency and only for tests; the lockfile pins the version
these suites were written against, and CI installs with `npm ci`.

## Things deliberately not done

- **Export speed.** Roughly 7x real time for music alone, 3.5x for a typical mix, 2x
  with all twelve textures. The cost is node lifecycle in the audio graph, not the
  composer. Shortening one-shot lifetimes and skipping offline teardown both measured
  as noise. Baking one-shots into pre-rendered buffers would roughly halve the node
  count, at the cost of changing how the ambience sounds.
- **Bit-exact renders.** Two renders of the same settings differ by far less than a
  16-bit step; Chromium's own float mixing is not reproducible run to run.
- **Payments.** Any paid tier needs a backend and business decisions; nothing here
  assumes one.
