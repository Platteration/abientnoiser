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
- **Quiet mode, visualiser, themes** — hide everything but the player, watch slow drifting bands coloured by the current movement, and pick system, dark, light or OLED black.
- **Sleep timer** that fades out rather than cutting, media keys and lock-screen controls, and keyboard shortcuts. Timers keep running while the tab is in the background, which is the whole point — on desktop and on Android. iOS is the exception: Safari suspends a Web Audio session when the screen locks, so playback and the timers stop there until you come back to the tab, and the lock screen shows no controls.
- **Accessible and considerate** — the timeline is a keyboard slider, movement changes are announced, focus is visible, and `prefers-reduced-motion` is honoured. Under heavy load the incidental one-shots thin out so musical notes never drop.

**Keeping it**

- **Save mixes** to a browser library, copy a share link that recreates one exactly, export or import the library as JSON (up to 500 mixes, and one button empties it), and save a picture of a mix as a PNG card.
- **Save as audio** — record what you hear in real time, or export the loop as a WAV rendered offline. Long exports render in five-minute chunks with a progress bar and a cancel button, so even a full hour fits in memory. Rendering is faster than real time, but not by a huge margin once the environment layers are on: roughly 7x for music alone, 3.5x for a typical mix, 2x with all twelve textures running — so a full hour takes something like fifteen to thirty minutes. The cost is the sheer number of short one-shot voices; it is the audio graph, not the composer.
- **Works offline** — the app installs as a PWA and runs with no network at all.

| Key | Action |
| --- | --- |
| `Space` | play / pause |
| `←` `→` | skip 30 seconds |
| `N` `P` | next / previous movement |
| `Q` `Esc` | quiet mode |
| `Home` `End` `PgUp` `PgDn` | on the focused timeline: start, end, back or forward five minutes |

## Run it

A static site with no build step and no dependencies.

```bash
npm start            # serves http://localhost:5173
# or: python3 -m http.server 5173
```

`npm start` listens on loopback only, because it serves the whole checkout. To reach
it from a phone on the same network, opt in with `HOST=0.0.0.0 npm start`.

Opening `index.html` from disk also works, except for the offline service worker.

### Deploy

A GitHub Pages workflow is included (`.github/workflows/pages.yml`). Enable **Settings → Pages → Source: GitHub Actions** and every push to `main` publishes the app.

## Tests

```bash
npm test               # node --test: PRNG, theory, composer, styles, app shell, dev server
npm run test:musical   # every style's whole loop, checked for wrong notes and wrong timing
npm run test:textures  # each environment texture, checked against the sound it claims to be
npm run test:browser   # Playwright + Chromium, end to end
npm run test:all       # all four
```

`test:musical` schedules all eight styles end to end with the synths and drum voices stubbed out — around 58,000 notes and hits — and checks every one is in the key of the movement that asked for it, inside its layer's register, a real MIDI number, and landing on its own step, swung forward and never early. A one-semitone or one-step error anywhere fails it.

`test:textures` renders each of the twelve environment textures on its own and measures where its energy actually sits: rain, creek, birds, crickets, chimes and vinyl must be bright; wind, waves, fire, train and café must be low; thunder is counted rather than measured, being far too rare to catch in a short window. It exists because a 50 Hz turntable rumble was quietly carrying 87% of the vinyl layer's energy.

The browser suite renders every style offline and checks levels and onset, that two renders match to within a 16-bit step, that the loop seam and the export's chunk joins are continuous, and that the live transport advances, wraps, seeks and releases its sources. It also covers steering, the movement editor, the focus timer, the queue crossfade, the share card, the visualiser, save/load/share, that the whole working state survives a reload, that the timers keep running with no animation frames at all, that heavy load thins the incidental one-shots without dropping notes, and that a 360px layout has no sideways overflow.

Both suites run in CI on every push (`.github/workflows/ci.yml`).

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

| File | Role |
| --- | --- |
| `js/prng.js` | seeded random numbers |
| `js/timer.js` | worker-driven ticker that survives a background tab |
| `js/theory.js` | modes, diatonic chords, voicings |
| `js/composer.js` | styles, moods, dayparts, plan generation |
| `js/audio/graph.js` | shared output, buses, reverbs, tape path, noise beds |
| `js/audio/synths.js` | pad, drone, bell, electric piano, piano, pluck, bass |
| `js/audio/drums.js` | three kits and their patterns |
| `js/audio/ambience.js` | twelve environment textures |
| `js/audio/engine.js` | performance logic and the transport / scheduler |
| `js/audio/recorder.js` | live recording and chunked WAV export |
| `js/storage.js` | library, autosave, preferences, share codes |
| `js/visual.js` | canvas visualiser |
| `js/card.js` | share card image |
| `js/app.js` | UI |
| `sw.js` | offline app shell |

## License

MIT
