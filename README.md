# Ambient Noiser

Hour-long, seamlessly looping soundscapes for work, study and sleep — generated live in your browser with the Web Audio API. Every piece is built from simple synths (pads, electric piano, bells, plucks, bass, a dusty drum kit) and procedural environment sounds (rain, thunder, wind, ocean, fireplace, birds, crickets, vinyl crackle), and it changes **mood every few minutes**, like movements in a long song. Nothing is downloaded or uploaded; there are no samples and no server.

## Features

- **Five styles**: Ambient Drift, Lo-fi Hip Hop, Deep Focus, Deep Space, Rainy Night.
- **Mood movements**: a seeded composer lays out the hour as 8–20 movements (default: one every ~4 minutes). Each gets its own key, mode, chord progression, tempo, brightness and density — “Still Water” gives way to “Rising Sky”, tension resolves into release, and the arc settles back down so the loop seam is calm.
- **Seamless looping**: 30 / 45 / 60 / 90 / 120-minute loops; the last movement flows back into the first.
- **Environment mixer**: rain, thunder, wind, waves, fire, birds, crickets and vinyl ride along with the mood (heavier rain and thunder in restless movements, birdsong when the music lifts).
- **Save your mixes**: name and save any seed + style + mixer setup to your browser library, copy a share link that recreates it exactly, export/import the library as JSON.
- **Save as audio**: record what you hear in real time (compressed audio via `MediaRecorder`), or export the first 1–10 minutes of the loop as a WAV file, rendered offline faster than real time.
- **Sleep timer**, keyboard shortcuts (`Space` play/pause, `←`/`→` skip 30 s), and everything remembers itself between visits.

## Run it

It is a static site with no build step and no dependencies.

```bash
npm start            # serves http://localhost:5173
# or: python3 -m http.server 5173
```

Opening `index.html` directly from disk also works in most browsers.

### Deploy

A GitHub Pages workflow is included (`.github/workflows/pages.yml`). Enable **Settings → Pages → Source: GitHub Actions** on the repository and every push to `main` publishes the app.

## Tests

```bash
npm test               # node --test: composer, theory, PRNG
npm run test:browser   # Playwright + Chromium: renders every style offline, checks levels,
                       # determinism, the loop seam, live transport, save/load and share links
```

## How it works

```
seed + style ──► composer ──► plan (movements: key, mode, tempo, chords, layer levels, ambience weights)
                                 │
                       transport walks 16th-note steps 2.5 s ahead of the clock
                                 │
        ┌────────────────────────┼──────────────────────────┐
     synths                    drums                     ambience
 pads · drone · bell        kick · snare              rain · thunder · wind · waves
 electric piano · pluck     hat · shaker              fire · birds · crickets · vinyl
        └────────────────────────┼──────────────────────────┘
                     layer gains (mood × mixer) → lo-fi filter/saturation → reverb → compressor
```

Every random decision is drawn from a PRNG keyed on `seed + movement + bar + step`, so the same seed always produces the same hour, each loop is identical, and offline export sounds exactly like playback.

| File | Role |
| --- | --- |
| `js/prng.js` | seeded random numbers |
| `js/theory.js` | modes, diatonic chords, voicings |
| `js/composer.js` | styles, moods, plan generation |
| `js/audio/graph.js` | master chain, buses, reverb, noise buffers |
| `js/audio/synths.js` | pad, drone, bell, electric piano, pluck, bass |
| `js/audio/drums.js` | lo-fi kit and 16-step patterns |
| `js/audio/ambience.js` | environment textures |
| `js/audio/engine.js` | performance logic and the transport / scheduler |
| `js/audio/recorder.js` | live recording and offline WAV export |
| `js/storage.js` | library, autosave, share codes |
| `js/app.js` | UI |

## License

MIT
