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
project site shares its origin with every other app the account publishes: both the
sweep on activate and every read are scoped to the `ambient-noiser-` `PREFIX`, because
an unscoped `caches.keys()` deletes the co-tenants' offline shells and an unscoped
`caches.match()` can answer with one of their responses.

**Lists that grow from outside are bounded where they are written.** The library is
capped at `MAX_MIXES` in `js/storage.js`, in both `importJSON` and `save` — a .json
someone else wrote otherwise installs as many mixes as fit in the quota, each one
rebuilt as its own list item on every `renderLibrary()`. 'Clear all mixes' is the way
back out; a cap applied where the list is *read* would leave the storage full.

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

The browser suite also feeds itself a hostile share link and library import, and
checks every focusable control has an accessible name.

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
